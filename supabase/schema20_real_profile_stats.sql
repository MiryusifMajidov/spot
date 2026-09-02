-- ============================================================================
-- SPOT · schema20_real_profile_stats.sql
--
-- `profiles` carries four columns that look like measurements and are not:
-- `reports_count`, `requests_sent`, `requests_answered`, `streak_current`, plus
-- `last_active_at`. Verified on the live database: all five are zero/NULL on
-- every one of the 13 profiles, and a full grep of the app AND the admin panel
-- finds no code anywhere that ever writes them. They were created and forgotten.
--
-- Meanwhile the source tables hold 5 reports, 1 match request and 1 check-in.
--
-- The damage is in the admin panel, which reads those columns:
--   · «yalnız şikayət edilənlər» filters on reports_count > 0 — so it returns an
--     empty list while five reports sit open. A moderator opening a reported
--     user's card is told «0 şikayət».
--   · the flame/streak figure, the response rate and the CSV export all print 0.
--
-- A zero is an absence, not a measurement. This file makes the numbers real by
-- computing them from the rows that actually exist, so they can never drift
-- again, and gives `last_active_at` something that writes it.
--
-- Apply AFTER schema19_checkin_server_side.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Check-in streak, server-side
--
--    NOT the same number the member sees. Their streak also counts logged
--    workouts, and workouts live only on their device — by design: an admin may
--    never read what somebody trained. So this counts check-ins alone, and the
--    panel must label it «check-in seriyası», never «streak».
--
--    The rule mirrors computeStreak() in src/store/db.ts: walk back from today's
--    gym day (04:00 → 04:00, Asia/Baku); if today has nothing yet, start from
--    yesterday, because today is still open.
-- ----------------------------------------------------------------------------
create or replace function public.checkin_streak(pid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select distinct gym_day as d from public.check_ins where profile_id = pid
  ),
  anchor as (
    select case
      when exists (
        select 1 from days
         where d = ((now() at time zone 'Asia/Baku') - interval '4 hours')::date
      )
      then ((now() at time zone 'Asia/Baku') - interval '4 hours')::date
      else ((now() at time zone 'Asia/Baku') - interval '4 hours')::date - 1
    end as a
  ),
  islands as (
    -- Consecutive dates share `d - row_number()`; that value identifies a run.
    select d, d - (row_number() over (order by d))::int as grp from days
  )
  select coalesce((
    select count(*)::int
      from islands
     where d <= (select a from anchor)
       and grp = (select grp from islands where d = (select a from anchor))
  ), 0);
$$;

-- ----------------------------------------------------------------------------
-- 2. The real per-profile numbers, for the admin panel only
--
--    SECURITY DEFINER so it can count rows the caller cannot read directly
--    (`reports` is moderator-only), with the admin check done here rather than
--    relying on the caller to ask nicely.
-- ----------------------------------------------------------------------------
create or replace function public.admin_profile_stats()
returns table (
  profile_id        uuid,
  reports_count     int,
  requests_sent     int,
  requests_answered int,
  checkin_streak    int,
  last_check_in     timestamptz
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
         (select max(c.created_at) from public.check_ins c where c.profile_id = p.id)
    from public.profiles p;
end;
$$;

revoke all on function public.admin_profile_stats() from public;
grant execute on function public.admin_profile_stats() to authenticated;
grant execute on function public.checkin_streak(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Make `last_active_at` mean something
--
--    The app stamps it once per launch. schema18 deliberately withheld the
--    column from the client's UPDATE grant, so it goes through here — which also
--    means a client cannot backdate or inflate it.
-- ----------------------------------------------------------------------------
create or replace function public.touch_last_active()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.profiles set last_active_at = now() where user_id = auth.uid();
$$;

revoke all on function public.touch_last_active() from public;
grant execute on function public.touch_last_active() to authenticated;
