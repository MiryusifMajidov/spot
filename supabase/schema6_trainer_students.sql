-- ============================================================================
-- SPOT · schema6_trainer_students.sql
-- The REAL trainer↔student relationship. There are no payments in SPOT, so a
-- "student" is not a purchase — it is an accepted training request, and the one
-- thing a trainer can do here that Instagram cannot: assign a program to a real
-- person and see the results they choose to share.
-- Apply AFTER schema4_admin.sql and schema5_app_writes.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A user asks a trainer to train them
-- ----------------------------------------------------------------------------
create table if not exists public.trainer_requests (
  id            uuid primary key default gen_random_uuid(),
  trainer_id    text not null references public.trainers(id) on delete cascade,
  from_profile  uuid not null references public.profiles(id) on delete cascade,
  note          text,
  preferred_time text,
  status        text not null default 'pending' check (status in ('pending','accepted','declined','ended')),
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (trainer_id, from_profile)
);
create index if not exists trainer_requests_trainer_idx on public.trainer_requests (trainer_id, status);
create index if not exists trainer_requests_profile_idx on public.trainer_requests (from_profile);

-- ----------------------------------------------------------------------------
-- 2. What the trainer assigned to that student (the real value they add)
-- ----------------------------------------------------------------------------
create table if not exists public.student_programs (
  id           uuid primary key default gen_random_uuid(),
  trainer_id   text not null references public.trainers(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  program_id   text,                 -- references a program in the catalog
  title        text,
  note         text,                 -- trainer's guidance for this person
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (trainer_id, student_id)
);

-- ----------------------------------------------------------------------------
-- 3. RLS — the trainer sees their own requests/students; the user sees their own.
--    Neither side gains access to anything the privacy rules forbid.
-- ----------------------------------------------------------------------------
alter table public.trainer_requests enable row level security;
alter table public.student_programs enable row level security;

-- Is the current user the owner of this trainer profile?
create or replace function public.owns_trainer(t_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trainers t
    join public.profiles p on p.id = t.owner_id
    where t.id = t_id and p.user_id = auth.uid()
  );
$$;

-- Is this profile row mine?
create or replace function public.owns_profile(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = p_id and p.user_id = auth.uid());
$$;

drop policy if exists tr_insert on public.trainer_requests;
create policy tr_insert on public.trainer_requests for insert
  with check (public.owns_profile(from_profile));

drop policy if exists tr_read on public.trainer_requests;
create policy tr_read on public.trainer_requests for select
  using (public.owns_profile(from_profile) or public.owns_trainer(trainer_id) or public.is_admin(auth.uid()));

-- Only the trainer decides; the student may withdraw (set 'ended').
drop policy if exists tr_update on public.trainer_requests;
create policy tr_update on public.trainer_requests for update
  using (public.owns_trainer(trainer_id) or public.owns_profile(from_profile))
  with check (public.owns_trainer(trainer_id) or public.owns_profile(from_profile));

drop policy if exists sp_read on public.student_programs;
create policy sp_read on public.student_programs for select
  using (public.owns_trainer(trainer_id) or public.owns_profile(student_id) or public.is_admin(auth.uid()));

drop policy if exists sp_write on public.student_programs;
create policy sp_write on public.student_programs for all
  using (public.owns_trainer(trainer_id))
  with check (public.owns_trainer(trainer_id));

-- ----------------------------------------------------------------------------
-- 4. Gym membership needs NO new table: a member is a profile whose
--    home_gym_id is the gym, and "here now" comes from check_ins.
--    Give the gym owner read access to their own members' PUBLIC profile fields.
--    (The privacy red line still holds: no workouts, no weight, no messages.)
-- ----------------------------------------------------------------------------
create or replace function public.owns_gym(g_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gyms g
    join public.profiles p on p.id = g.owner_id
    where g.id = g_id and p.user_id = auth.uid()
  );
$$;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='profiles' and policyname='profiles_gym_owner_read') then
    create policy profiles_gym_owner_read on public.profiles for select
      using (home_gym_id is not null and public.owns_gym(home_gym_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='check_ins' and policyname='checkins_gym_owner_read') then
    create policy checkins_gym_owner_read on public.check_ins for select
      using (public.owns_gym(gym_id));
  end if;
end $$;
