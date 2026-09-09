-- ============================================================================
-- SPOT · schema65_admin_metrics.sql
--
-- The admin panel's «Əsas hipotez» card — the one number the whole product is
-- judged on — is wrong twice over.
--
-- 1. IT COUNTS ROWS AND CALLS THEM PEOPLE. `withPartner` is
--    `count(match_requests where status='accepted')`, labelled «Yoldaşı olan»,
--    divided by the profile count to make «Yoldaşı olan %», and subtracted from
--    it to make «Tək». One accepted row involves TWO people, and one person can
--    have many accepted rows, so the figure is neither a headcount nor bounded
--    by the user total: 40 users and 48 accepted rows reads as «120%», and the
--    `Math.max(0, …)` clamp then hides the contradiction by printing «Tək 0».
--
-- 2. IT CAN NEVER SEE ANYTHING ANYWAY. `match_read` is
--    `from_profile is mine OR to_profile is mine` with no admin branch, so an
--    administrator's count returns 0 no matter what the table holds. The card
--    has therefore always said «Hipotezi yoxlamaq üçün hələ kifayət data
--    yoxdur», whatever the truth was.
--
-- The fix is an aggregate-only RPC rather than an admin read policy on the
-- table. A match request carries a personal note written to one other person;
-- counting them does not require reading them, and SPOT's rule is that an admin
-- does not read what one member wrote to another. This returns numbers only.
--
-- Apply AFTER schema64_moderation_and_escalation.sql.
-- ============================================================================

create or replace function public.admin_match_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public.admin_at_least(auth.uid(), 'support') then
    raise exception 'not_an_admin' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'requests_total',   (select count(*) from public.match_requests),
    'requests_pending', (select count(*) from public.match_requests where coalesce(status,'pending') = 'pending'),
    'requests_accepted',(select count(*) from public.match_requests where status = 'accepted'),
    -- The headcount the card actually wants: DISTINCT people who appear on at
    -- least one accepted request, from either side.
    'matched_profiles', (select count(*) from (
        select from_profile as p from public.match_requests where status = 'accepted'
        union
        select to_profile   from public.match_requests where status = 'accepted') u
        where u.p is not null)
  );
end $$;

revoke execute on function public.admin_match_stats() from public, anon, authenticated;
grant execute on function public.admin_match_stats() to authenticated;

comment on function public.admin_match_stats is
  'Counts only — never rows. A match request carries a note one member wrote to another; the panel needs the number, not the words. `matched_profiles` is DISTINCT people on accepted requests, which is what «Yoldaşı olan» claims to be.';
