-- ============================================================================
-- SPOT · schema48_checkin_privacy.sql
--
-- The app makes this promise, in two places (onboarding/privacy.tsx and
-- profile/privacy.tsx), in these words:
--
--   «Yalnız check-in etdiyin müddətdə 'indi zalda' siyahısında görünürsən —
--    daimi lokasiya izləmə yoxdur.»
--
-- It was not true. `check_ins_read` said:
--
--   profile_id in (select p.id from profiles p where p.user_id = auth.uid())
--   OR profile_id in (select p.id from profiles p where coalesce(p.show_in_gym_list, true))
--   OR is_admin(auth.uid())
--
-- The middle branch has NO TIME BOUND and `show_in_gym_list` defaults to true.
-- So any signed-in account could read every check-in row of almost every user,
-- for all time — which gym, which day, what hour. That is not a «now» list, it
-- is a location history, and it is exactly the thing the screen says does not
-- exist.
--
-- Proved on the live database before this was written: a freshly created
-- stranger account read a 40-day-old expired check-in belonging to another user.
--
-- WHO SHOULD SEE WHAT
--   yourself      · everything, forever. It is your history.
--   the gym owner · their own gym's rows (owns_gym). The members screen is built
--                   on this and it is the gym's own door — kept as it was.
--   an admin      · kept, for moderation.
--   everyone else · ONLY a check-in that is still active (expires_at > now()),
--                   only from someone who left `show_in_gym_list` on, and never
--                   across a block in either direction.
--
-- That is precisely the «indi zalda» feature and nothing more: the moment the
-- check-in expires the row goes dark to strangers.
--
-- Nothing in the app loses a capability:
--   activeCountsByGym()   selects gym_id where expires_at > now  → still works
--   getPartnersAtGym()    the `hereNow` flag                     → still works
--   the streak and history are the user's own rows               → still works
--   gym/members.tsx       reads through owns_gym                 → still works
--
-- Apply AFTER schema47_insert_grants.sql.
-- ============================================================================

drop policy if exists check_ins_read on public.check_ins;

create policy check_ins_read on public.check_ins
  for select to authenticated
  using (
    -- your own rows
    profile_id = public.my_profile_id()

    -- the gym's own door, for whoever owns that gym
    or public.owns_gym(gym_id)

    or public.is_admin(auth.uid())

    -- everyone else: the live «indi zalda» signal, and only that
    or (
      expires_at is not null
      and expires_at > now()
      and exists (
        select 1 from public.profiles p
         where p.id = check_ins.profile_id
           and coalesce(p.show_in_gym_list, true)
      )
      and not public.blocked_between(check_ins.profile_id, public.my_profile_id())
    )
  );

-- A row whose `expires_at` was never set would be invisible to strangers under
-- the clause above, and permanently visible under the old one. Neither is what
-- the feature means, so make the column's absence impossible going forward.
update public.check_ins
   set expires_at = created_at + interval '2 hours'
 where expires_at is null and created_at is not null;
