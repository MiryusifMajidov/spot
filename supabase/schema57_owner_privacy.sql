-- ============================================================================
-- SPOT · schema57_owner_privacy.sql
--
-- Two holes in the profile-privacy line, both live today.
--
-- 1. `profiles_gym_owner_read` is
--
--      (home_gym_id is not null) and owns_gym(home_gym_id)
--
--    and nothing else. Permissive policies are OR'd, so this branch hands a gym
--    owner every row of every member of their gym — bypassing BOTH guards the
--    main `profiles_read` policy applies:
--
--      · `show_in_gym_list` — the switch the app calls «Zalda göründüyümü
--        göstər». The owner panel does mask a member as «Anonim üzv», but it
--        masks them in JavaScript, after the server has already sent the name.
--        A costume, not a wall: the same row is one REST call away.
--      · `blocked_between` — so blocking the gym owner does not hide you from
--        the gym owner, which is the one person a member might most want to
--        hide from.
--
--    There are ZERO owned gyms on this database right now, so this costs
--    nothing to fix today and cannot be fixed retroactively once a real gym has
--    a real roster.
--
-- 2. `status_reason` — the moderator's free-text note explaining why an account
--    was suspended — is SELECT-granted to `anon` and `authenticated`. Every
--    signed-in user, and every guest, can read the sanction notes written about
--    everybody else. The client never reads this column at all (grep: zero
--    readers), so taking it away breaks nothing.
--
--    `status` and `status_until` stay: `sanctionOf()` reads them for the CURRENT
--    user to draw the «hesabın dayandırılıb» banner, and a column grant is
--    role-wide, so revoking them would break that self-read. They carry a state,
--    not a moderator's words.
--
-- Apply AFTER schema56_verification_decision.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The gym owner sees their members under the SAME rules as everybody else
-- ----------------------------------------------------------------------------
drop policy if exists profiles_gym_owner_read on public.profiles;
create policy profiles_gym_owner_read on public.profiles
  for select to authenticated
  using (
    home_gym_id is not null
    and public.owns_gym(home_gym_id)
    -- A member who turned visibility off is not on the owner's list either. The
    -- app already promises this in two places; now the database enforces it.
    and coalesce(show_in_gym_list, true)
    -- A block is a block, including against the person who owns the building.
    and not public.blocked_between(id, public.my_profile_id())
  );

comment on policy profiles_gym_owner_read on public.profiles is
  'A gym owner may read the profiles of members whose home gym is theirs — but only members who left «Zalda göründüyümü göstər» on, and never across a block. Mirrors profiles_read rather than overriding it.';

-- ----------------------------------------------------------------------------
-- 2. A moderator's note is not public reading
-- ----------------------------------------------------------------------------
revoke select (status_reason) on public.profiles from anon, authenticated;
