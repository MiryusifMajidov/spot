-- ============================================================================
-- SPOT · schema26_checkin_visibility.sql
--
-- `check_ins_read` was `SELECT USING (true)` to PUBLIC, so every check-in of
-- every member — the whole history, not just who is there now — was readable
-- with the key that ships in the APK.
--
-- The app has a switch for exactly this, «Zalda göründüyümü göstər»
-- (`profiles.show_in_gym_list`), and `isListable()` in src/lib/api.ts filters on
-- it. But the filtering was only in the client: the rows themselves came back
-- regardless, so the setting changed what the app drew and nothing about what
-- the data actually exposed. A switch that only persuades the UI is not a
-- privacy setting.
--
-- The new rule, in order of what it allows:
--   · my own check-ins — always;
--   · anyone who has not turned the switch off — that is what makes «indi zalda»
--     and the live count work, and it is what those members opted into;
--   · the gym's owner, for their own gym (the existing `checkins_gym_owner_read`
--     policy, kept as-is — an owner seeing who is in their gym right now is the
--     point of the owner panel);
--   · an admin.
--
-- CONSEQUENCE, deliberate: a member who hides themselves no longer counts toward
-- the gym's live «indi zalda» number either. Hiding from the list while still
-- being counted would leak the same fact in aggregate, and the switch's wording
-- promises more than that. Nobody currently has it off, so no number moves today.
--
-- NULL still means visible: the column is nullable and older rows predate it, so
-- only an explicit `false` hides — the same reading `isListable()` already uses.
--
-- Apply AFTER schema25_lock_chats.sql.
-- ============================================================================

drop policy if exists check_ins_read on public.check_ins;

create policy check_ins_read on public.check_ins
  for select
  using (
    -- my own
    profile_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    -- or someone who has not hidden themselves
    or profile_id in (select p.id from public.profiles p where coalesce(p.show_in_gym_list, true))
    or public.is_admin(auth.uid())
  );

-- `checkins_gym_owner_read` (using owns_gym(gym_id)) stays untouched: policies
-- are OR'd, so an owner keeps full sight of their own gym.
