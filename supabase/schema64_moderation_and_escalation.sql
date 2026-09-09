-- ============================================================================
-- SPOT · schema64_moderation_and_escalation.sql
--
-- Six defects, all verified against this database. Four of them are the same
-- shape: a column grant and a policy that disagree about who may write what.
--
-- 1. NOBODY CAN BE SANCTIONED. `profiles.status`, `status_reason` and
--    `status_until` have INSERT and SELECT grants but NO UPDATE grant
--    (schema18 revoked UPDATE and re-granted a column list that deliberately
--    excludes them, «Those belong to moderation»). Moderation, however, runs
--    through the same `authenticated` role — the admin SPA uses the publishable
--    key and an ordinary session — and the only write path is a direct table
--    UPDATE (Users.tsx applyLadder / applyRestore, Moderation.tsx punish). A
--    missing column privilege is checked BEFORE RLS, so every rung of the
--    punishment ladder returns 42501. No account on SPOT can be muted,
--    suspended, banned or restored, which means `is_sanctioned()` is false for
--    everybody and the whole enforcement layer built in schema18/28/30/38/43
--    has never once fired.
--    Granting the columns to `authenticated` would be worse: `profiles_update`
--    matches a user's OWN row, so a banned person could lift their own ban.
--    An admin-gated RPC is the only correct shape.
--
-- 2. THE MODERATOR USER LIST IS EMPTY. schema57 revoked SELECT on
--    `status_reason` on the stated ground that «the client never reads this
--    column at all (grep: zero readers)» — the grep missed web/admin/src.
--    Users.tsx still names it, Postgres refuses a SELECT that touches an
--    ungranted column, and the screen turns the refusal into an empty roster:
--    «0 istifadəçi» over a database full of profiles, with the sanction ladder
--    unreachable because it lives in the row drawer. The note comes back through
--    `admin_profile_stats()`, which is already admin-gated.
--
-- 3. A MODERATOR CAN BECOME ANY USER. `profiles_admin_update` is
--    `using (admin_at_least(auth.uid(),'moderator'))` with no restriction on
--    which row or which column, and `user_id` is UPDATE-granted. `user_id` is
--    the key every private-data policy resolves identity through, so two writes
--    turn a support-rung moderator into a chosen member: their weight history,
--    their workouts, their whole chat archive. schema4 calls that data «the red
--    line». A trigger now refuses to change `user_id` once it is set — the
--    profile upsert keeps working because it writes the same value.
--
-- 4. AN ABUSIVE PROGRAM CANNOT BE TAKEN DOWN. `programs.hidden_at` has SELECT
--    but no UPDATE grant, so the moderator's takedown fails. Giving the column
--    to `authenticated` is not available either: unlike feed_videos and
--    community_posts, `programs` has an OWNER update policy, so the author could
--    simply un-hide their own moderated program. One admin RPC now covers all
--    three tables, and the direct grant is withdrawn from the other two so there
--    is a single audited path.
--
-- 5. ANY USER CAN AWARD THEMSELVES THE VERIFIED BADGE. `tv_insert` lets a person
--    insert their own `trainer_verifications` row, `status` is in the INSERT
--    grant, and an AFTER INSERT trigger (schema27) sets
--    `trainers.verified = true` when the status is 'approved'. So one request
--    with `status:'approved'` buys the blue check that is supposed to mean an ID
--    document and a certificate were reviewed by a human. Same for
--    `reviewer_id`, `gym_confirm` and `reject_reason`.
--
-- 6. A STRANGER CAN FORGE AN ACCEPTED MATCH. `match_requests.status` is in the
--    INSERT grant and has no CHECK constraint, so anyone can insert
--    `{from_profile: me, to_profile: <victim>, status: 'accepted'}`.
--    `has_relationship_with()` then returns true, which unlocks `open_thread()`
--    — direct messages to somebody who never agreed — and opens the
--    `profiles_read` branch that shows a profile the person had hidden.
--
-- Apply AFTER schema63_function_privileges.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. `user_id` is not editable — not by a moderator, not by anybody
--
-- The profile upsert (`upsert({user_id, ...}, {onConflict:'user_id'})`) writes
-- the SAME value on conflict, so it passes. Only a CHANGE is refused.
-- ----------------------------------------------------------------------------
create or replace function public.tg_profiles_user_id_frozen()
returns trigger
language plpgsql
as $$
begin
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'user_id_is_frozen' using errcode = '42501',
      detail = 'A profile cannot be repointed at another account. It is the key every private-data policy resolves identity through.';
  end if;
  return new;
end $$;

drop trigger if exists profiles_user_id_frozen on public.profiles;
create trigger profiles_user_id_frozen
  before update on public.profiles
  for each row execute function public.tg_profiles_user_id_frozen();

-- ----------------------------------------------------------------------------
-- 2. The sanction ladder, as an audited admin action
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_profile_status(
  p_profile uuid, p_status text, p_reason text, p_until timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare n int;
begin
  if not public.admin_at_least(auth.uid(), 'moderator') then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_status not in ('active','muted','suspended','banned') then
    raise exception 'bad_status' using errcode = '22023';
  end if;
  -- A sanction without a written reason is not reviewable later, and the audit
  -- log exists to be reviewed.
  if p_status <> 'active' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  update public.profiles
     set status = p_status,
         status_reason = nullif(btrim(coalesce(p_reason,'')), ''),
         status_until = case when p_status = 'active' then null else p_until end
   where id = p_profile;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no_such_profile' using errcode = '22023';
  end if;

  perform public.admin_log(
    case when p_status = 'active' then 'user_restore' else 'user_' || p_status end,
    'profile', p_profile::text, p_reason,
    jsonb_build_object('status', p_status, 'until', p_until));

  return jsonb_build_object('status', p_status, 'until', p_until);
end $$;

revoke execute on function public.admin_set_profile_status(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_set_profile_status(uuid, text, text, timestamptz)
  to authenticated;

comment on function public.admin_set_profile_status is
  'The only way an account is muted, suspended, banned or restored. The three columns stay ungranted to `authenticated` on purpose — with a column grant, profiles_update would let a banned user lift their own ban.';

-- ----------------------------------------------------------------------------
-- 3. Content takedown, one audited path for all three tables
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_content_hidden(
  p_table text, p_id text, p_hidden boolean, p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare n int;
begin
  if not public.admin_at_least(auth.uid(), 'moderator') then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_table not in ('programs','feed_videos','community_posts') then
    raise exception 'bad_table' using errcode = '22023';
  end if;
  if p_hidden and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  execute format('update public.%I set hidden_at = $1 where id = $2', p_table)
    using (case when p_hidden then now() end), p_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no_such_row' using errcode = '22023';
  end if;

  perform public.admin_log(case when p_hidden then 'content_remove' else 'content_restore' end,
                           p_table, p_id, p_reason, jsonb_build_object('hidden', p_hidden));
  return jsonb_build_object('table', p_table, 'id', p_id, 'hidden', p_hidden);
end $$;

revoke execute on function public.admin_set_content_hidden(text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_content_hidden(text, text, boolean, text)
  to authenticated;

-- One path only. feed_videos and community_posts had a direct UPDATE grant on
-- `hidden_at`; it is not needed now and a grant nothing uses is a grant waiting
-- for a policy that lets the wrong person through.
revoke update (hidden_at) on public.feed_videos from anon, authenticated;
revoke update (hidden_at) on public.community_posts from anon, authenticated;

comment on function public.admin_set_content_hidden is
  'Hide or restore a program, feed video or community post. Covers programs, whose owner UPDATE policy makes a plain column grant unsafe — the author could un-hide their own moderated content.';

-- ----------------------------------------------------------------------------
-- 4. The moderator's note travels with the stats, not as a column grant
-- ----------------------------------------------------------------------------
-- The return type gains a column, so the old signature has to go first.
drop function if exists public.admin_profile_stats();
create function public.admin_profile_stats()
returns table (
  profile_id        uuid,
  reports_count     int,
  requests_sent     int,
  requests_answered int,
  checkin_streak    int,
  last_check_in     timestamptz,
  status_reason     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.admin_at_least(auth.uid(), 'support') then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  return query
  select p.id,
         (select count(*)::int from public.reports r
           where r.target_type = 'user' and r.target_id = p.id::text),
         (select count(*)::int from public.match_requests m
           where m.from_profile = p.id),
         -- "Answered" is about THIS person's responsiveness: requests sent TO
         -- them that they acted on. A pending one is not an answer.
         (select count(*)::int from public.match_requests m
           where m.to_profile = p.id and coalesce(m.status,'pending') <> 'pending'),
         public.checkin_streak(p.id),
         (select max(c.created_at) from public.check_ins c where c.profile_id = p.id),
         -- schema57 revoked SELECT on this column from every role, because a
         -- moderator's private note about a person is not public reading. It
         -- comes back here instead, behind the admin check above.
         p.status_reason
    from public.profiles p;
end;
$$;

revoke execute on function public.admin_profile_stats() from public, anon;
grant execute on function public.admin_profile_stats() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. A verification request is a REQUEST
--
-- Stamped rather than revoked from the grant: the app's own submit sends
-- `status:'pending'` and `gym_confirm:false`, so a stamping trigger keeps that
-- call working while making the value impossible to choose. Mirrors
-- `tg_stamp_feed_author` (schema47).
-- ----------------------------------------------------------------------------
create or replace function public.tg_stamp_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An admin acting through admin_decide_verification is a definer call and
  -- does not pass through here; anything a client inserts starts at the bottom.
  new.status        := 'pending';
  new.gym_confirm   := false;
  new.reviewer_id   := null;
  new.reject_reason := null;
  new.internal_note := null;
  new.sla_due_at    := now() + interval '2 days';
  return new;
end $$;

drop trigger if exists trainer_verifications_stamp on public.trainer_verifications;
create trigger trainer_verifications_stamp
  before insert on public.trainer_verifications
  for each row execute function public.tg_stamp_verification();

comment on function public.tg_stamp_verification is
  'A person applying for verification cannot choose the outcome. Without this, inserting status=''approved'' handed out the verified badge that is supposed to mean a human read an ID document.';

-- ----------------------------------------------------------------------------
-- 6. A match starts pending, and only the recipient moves it
-- ----------------------------------------------------------------------------
alter table public.match_requests drop constraint if exists match_requests_status_check;
alter table public.match_requests add constraint match_requests_status_check
  check (status is null or status in ('pending','accepted','declined'));

-- `sendMatchRequest` writes exactly from_profile, to_profile and note.
revoke insert on public.match_requests from anon, authenticated;
grant insert (from_profile, to_profile, note) on public.match_requests to authenticated;

-- The accept/decline path writes only `status`; the recipient had no business
-- being able to rewrite who the request was from.
revoke update on public.match_requests from anon, authenticated;
grant update (status) on public.match_requests to authenticated;

comment on column public.match_requests.status is
  'pending → accepted | declined, and only by the recipient (match_update). It used to be insertable: a stranger could write an already-accepted row, which unlocked open_thread() and the has_relationship_with branch of profiles_read.';

-- ----------------------------------------------------------------------------
-- 7. The safety SLA the moderator panel promises
--
-- Moderation.tsx states «Təhlükəsizlik: 2 saat», and `sla_due_at` defaulted to
-- now() + 24 hours for every category with nothing to override it. A safety
-- report and a spam report had the same deadline, so the queue's own «SLA
-- keçib» marker was measuring the wrong promise.
-- ----------------------------------------------------------------------------
create or replace function public.tg_report_sla()
returns trigger
language plpgsql
as $$
begin
  new.sla_due_at := now() + case
    when new.category = 'safety'     then interval '2 hours'
    when new.category = 'harassment' then interval '6 hours'
    else interval '24 hours' end;
  return new;
end $$;

drop trigger if exists reports_sla on public.reports;
create trigger reports_sla
  before insert on public.reports
  for each row execute function public.tg_report_sla();
