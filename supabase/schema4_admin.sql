-- ============================================================================
-- SPOT · schema4_admin.sql
-- Real admin platform: admin roles, moderation queue, verifications, claims,
-- payments/day-passes, append-only audit log, and RLS that ENFORCES the privacy
-- red line (admins can NEVER read workouts / weights / messages / progress).
-- Apply AFTER schema.sql, schema2.sql, schema3.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Columns the admin platform needs on existing tables
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists phone            text;      -- E.164, never public
alter table public.profiles add column if not exists status           text not null default 'active'
  check (status in ('active','muted','suspended','banned'));
alter table public.profiles add column if not exists status_reason     text;
alter table public.profiles add column if not exists status_until      timestamptz;
alter table public.profiles add column if not exists reports_count     int  not null default 0;
alter table public.profiles add column if not exists requests_sent     int  not null default 0;
alter table public.profiles add column if not exists requests_answered int  not null default 0;
alter table public.profiles add column if not exists streak_current    int  not null default 0;
alter table public.profiles add column if not exists last_active_at    timestamptz;

alter table public.trainers add column if not exists verify_status text not null default 'unverified'
  check (verify_status in ('unverified','pending','approved','rejected'));

alter table public.gyms add column if not exists claim_status text not null default 'unclaimed'
  check (claim_status in ('unclaimed','pending','claimed'));
alter table public.gyms add column if not exists owner_id uuid references auth.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- 1. Admin accounts + role helpers
-- ----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  name        text,
  email       text,
  role        text not null default 'support' check (role in ('support','moderator','ops','owner')),
  two_factor  boolean not null default false,   -- 2FA enrolled
  created_at  timestamptz not null default now(),
  disabled_at timestamptz
);

-- SECURITY DEFINER so RLS policies can call it without recursion.
create or replace function public.is_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = uid and a.disabled_at is null);
$$;

create or replace function public.admin_role(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.role from public.admins a where a.user_id = uid and a.disabled_at is null;
$$;

-- Role >= level check (support < moderator < ops < owner)
create or replace function public.admin_at_least(uid uuid, min_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select case admin_role(uid)
    when 'owner' then true
    when 'ops' then min_role in ('support','moderator','ops')
    when 'moderator' then min_role in ('support','moderator')
    when 'support' then min_role = 'support'
    else false end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Moderation: reports queue (with SLA + 15-min row lock)
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references auth.users(id) on delete set null,
  target_type  text not null check (target_type in ('user','content','gym','trainer','message')),
  target_id    text not null,
  category     text not null check (category in ('safety','harassment','spam','fake','payment','other')),
  note         text,
  status       text not null default 'open' check (status in ('open','resolved','dismissed')),
  sla_due_at   timestamptz not null default (now() + interval '24 hours'),
  locked_by    uuid references auth.users(id) on delete set null,
  locked_until timestamptz,
  resolution   text,
  resolved_by  uuid references auth.users(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists reports_status_sla_idx on public.reports (status, sla_due_at);

-- Chat evidence: ONLY messages attached to a specific report (max 20). This is
-- the sole path by which any message text is ever visible to an admin.
create table if not exists public.report_messages (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  sender_name text,
  body        text not null,
  sent_at     timestamptz,
  ord         int not null default 0
);

-- ----------------------------------------------------------------------------
-- 3. Punishment ladder (moderation actions) — reason is mandatory
-- ----------------------------------------------------------------------------
create table if not exists public.moderation_actions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references auth.users(id) on delete set null,
  target_type text not null check (target_type in ('user','content','gym','trainer')),
  target_id   text not null,
  action      text not null check (action in ('warn','mute','suspend','ban','content_remove','restore')),
  reason      text not null,                    -- enforced NOT NULL by the schema
  report_id   uuid references public.reports(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. Trainer verification queue
-- ----------------------------------------------------------------------------
create table if not exists public.trainer_verifications (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   text references public.trainers(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  doc_id_url   text,   -- gov id
  doc_cert_url text,   -- certificate
  gym_confirm  boolean not null default false,
  intro_video_url text,
  reviewer_id  uuid references auth.users(id) on delete set null,
  internal_note text,
  reject_reason text,
  sla_due_at   timestamptz not null default (now() + interval '2 days'),
  created_at   timestamptz not null default now()
);
create index if not exists trainer_verif_status_idx on public.trainer_verifications (status, sla_due_at);

-- ----------------------------------------------------------------------------
-- 5. Gym claims (VÖEN + call-code + selfie)
-- ----------------------------------------------------------------------------
create table if not exists public.gym_claims (
  id          uuid primary key default gen_random_uuid(),
  gym_id      text references public.gyms(id) on delete cascade,
  claimant_id uuid references auth.users(id) on delete set null,
  voen        text,       -- tax id
  call_code   text,       -- phone verification code
  selfie_url  text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid references auth.users(id) on delete set null,
  reject_reason text,
  sla_due_at  timestamptz not null default (now() + interval '2 days'),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. Payments / day-passes (commission transparent per row)
-- ----------------------------------------------------------------------------
create table if not exists public.day_passes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  gym_id       text references public.gyms(id) on delete set null,
  code         text,
  price        numeric(10,2) not null default 0,
  commission   numeric(10,2) not null default 0,
  status       text not null default 'active' check (status in ('active','used','refunded','expired')),
  purchased_at timestamptz not null default now(),
  expires_at   timestamptz,
  refunded_at  timestamptz,
  refund_reason text
);
create index if not exists day_passes_status_idx on public.day_passes (status, purchased_at desc);

-- ----------------------------------------------------------------------------
-- 7. Append-only audit log (24 months; no UPDATE/DELETE policy exists)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users(id) on delete set null,
  admin_name text,
  action     text not null,
  entity     text,
  entity_id  text,
  reason     text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

-- ============================================================================
-- 8. ROW LEVEL SECURITY
--    Admins read/act via their own authenticated session (no service key in the
--    browser). The privacy red line is enforced by the ABSENCE of admin policies
--    on workouts / weights / progress / messages.
-- ============================================================================
alter table public.admins                enable row level security;
alter table public.reports               enable row level security;
alter table public.report_messages       enable row level security;
alter table public.moderation_actions    enable row level security;
alter table public.trainer_verifications enable row level security;
alter table public.gym_claims            enable row level security;
alter table public.day_passes            enable row level security;
alter table public.audit_log             enable row level security;

-- admins: an admin can read the admin roster; only owner manages it.
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select using (public.is_admin(auth.uid()));
drop policy if exists admins_owner_write on public.admins;
create policy admins_owner_write on public.admins for all
  using (public.admin_role(auth.uid()) = 'owner')
  with check (public.admin_role(auth.uid()) = 'owner');

-- reports: reporters can insert; admins read; moderators+ resolve.
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (auth.uid() = reporter_id);
drop policy if exists reports_admin_read on public.reports;
create policy reports_admin_read on public.reports for select using (public.is_admin(auth.uid()));
drop policy if exists reports_admin_update on public.reports;
create policy reports_admin_update on public.reports for update
  using (public.admin_at_least(auth.uid(),'moderator'))
  with check (public.admin_at_least(auth.uid(),'moderator'));

drop policy if exists report_msgs_admin_read on public.report_messages;
create policy report_msgs_admin_read on public.report_messages for select using (public.is_admin(auth.uid()));

-- moderation actions: moderators+ ; reason NOT NULL enforced by column.
drop policy if exists modact_admin on public.moderation_actions;
create policy modact_admin on public.moderation_actions for all
  using (public.admin_at_least(auth.uid(),'moderator'))
  with check (public.admin_at_least(auth.uid(),'moderator') and admin_id = auth.uid());

-- trainer verification: ops+ decide; anyone authenticated can insert their own.
drop policy if exists tv_insert on public.trainer_verifications;
create policy tv_insert on public.trainer_verifications for insert with check (auth.uid() = user_id);
drop policy if exists tv_admin_read on public.trainer_verifications;
create policy tv_admin_read on public.trainer_verifications for select using (public.is_admin(auth.uid()) or auth.uid() = user_id);
drop policy if exists tv_admin_update on public.trainer_verifications;
create policy tv_admin_update on public.trainer_verifications for update
  using (public.admin_at_least(auth.uid(),'ops')) with check (public.admin_at_least(auth.uid(),'ops'));

-- gym claims: ops+ decide.
drop policy if exists gc_insert on public.gym_claims;
create policy gc_insert on public.gym_claims for insert with check (auth.uid() = claimant_id);
drop policy if exists gc_admin_read on public.gym_claims;
create policy gc_admin_read on public.gym_claims for select using (public.is_admin(auth.uid()) or auth.uid() = claimant_id);
drop policy if exists gc_admin_update on public.gym_claims;
create policy gc_admin_update on public.gym_claims for update
  using (public.admin_at_least(auth.uid(),'ops')) with check (public.admin_at_least(auth.uid(),'ops'));

-- day passes: user reads own; admins read all; ops+ refund.
drop policy if exists dp_user_read on public.day_passes;
create policy dp_user_read on public.day_passes for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
drop policy if exists dp_admin_update on public.day_passes;
create policy dp_admin_update on public.day_passes for update
  using (public.admin_at_least(auth.uid(),'ops')) with check (public.admin_at_least(auth.uid(),'ops'));

-- audit log: admins read; anyone-admin inserts; NO update/delete policy → append-only.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select using (public.is_admin(auth.uid()));
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert with check (public.is_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- 9. Admin read access to the core catalog/user tables (cross-user)
--    profiles / gyms / trainers / reviews / community_posts / feed_videos /
--    challenges: admins may SELECT all; ops+ may UPDATE moderation-relevant cols.
--    NOTE: NO admin policy is added for public.workouts, public.progress,
--    public.messages (and weights live in workouts/progress) — the red line.
-- ----------------------------------------------------------------------------
do $$ begin
  -- profiles: admins can read everyone (existing user-scoped policies stay).
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='profiles_admin_read') then
    create policy profiles_admin_read on public.profiles for select using (public.is_admin(auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='profiles_admin_update') then
    create policy profiles_admin_update on public.profiles for update
      using (public.admin_at_least(auth.uid(),'moderator')) with check (public.admin_at_least(auth.uid(),'moderator'));
  end if;
  if not exists (select 1 from pg_policies where tablename='trainers' and policyname='trainers_admin_update') then
    create policy trainers_admin_update on public.trainers for update
      using (public.admin_at_least(auth.uid(),'ops')) with check (public.admin_at_least(auth.uid(),'ops'));
  end if;
  if not exists (select 1 from pg_policies where tablename='gyms' and policyname='gyms_admin_update') then
    create policy gyms_admin_update on public.gyms for update
      using (public.admin_at_least(auth.uid(),'ops')) with check (public.admin_at_least(auth.uid(),'ops'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 10. Phone unmask RPC (ops+ only; every call is written to the audit log)
--     The admin UI shows masked phones; unmasking is a deliberate, logged action.
-- ----------------------------------------------------------------------------
create or replace function public.admin_unmask_phone(target_profile uuid, why text)
returns text language plpgsql security definer set search_path = public as $$
declare ph text; begin
  if not public.admin_at_least(auth.uid(),'ops') then raise exception 'forbidden'; end if;
  select phone into ph from public.profiles where id = target_profile;
  insert into public.audit_log(admin_id, admin_name, action, entity, entity_id, reason)
    values (auth.uid(), admin_role(auth.uid()), 'phone_unmask', 'profile', target_profile::text, why);
  return ph;
end $$;

-- ----------------------------------------------------------------------------
-- 11. Dashboard KPI helper (single round-trip for the admin home)
-- ----------------------------------------------------------------------------
create or replace function public.admin_dashboard()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin(auth.uid()) then jsonb_build_object(
    'users_total',        (select count(*) from public.profiles),
    'trainers_pending',   (select count(*) from public.trainer_verifications where status='pending'),
    'reports_open',       (select count(*) from public.reports where status='open'),
    'reports_overdue',    (select count(*) from public.reports where status='open' and sla_due_at < now()),
    'claims_pending',     (select count(*) from public.gym_claims where status='pending'),
    'gyms_total',         (select count(*) from public.gyms),
    'daypass_active',     (select count(*) from public.day_passes where status='active'),
    'revenue_commission', (select coalesce(sum(commission),0) from public.day_passes where status in ('used','active'))
  ) else '{}'::jsonb end;
$$;

-- Seat the first owner from an env-provided email after signup (see SETUP-ADMIN.md):
--   insert into public.admins(user_id,name,email,role,two_factor)
--   select id, 'Owner', email, 'owner', true from auth.users where email = 'YOU@example.com'
--   on conflict (user_id) do update set role='owner';
