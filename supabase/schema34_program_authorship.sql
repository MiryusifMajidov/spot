-- ============================================================================
-- SPOT · schema34_program_authorship.sql
--
-- 1. `programs_insert` was `WITH CHECK (true)`.
--
--    So any signed-in account could publish a program with `owner_id` pointing
--    anywhere, `creator_type = 'spot'` (attributing it to SPOT itself),
--    `creator_verified = true`, and a `rating`, `saves` and `done_by` of its own
--    choosing. The library sorts by `saves`, so a fabricated number also buys the
--    top of the list. `programs_update` was already owner-scoped; only the door
--    in was open.
--
--    Same treatment as schema27/29: the author is required, the trust and
--    derived columns are withheld by GRANT, and `creator_type` is restricted to
--    what a client legitimately is. Only a migration can mark a program as
--    SPOT's own.
--
-- 2. `challenges.participants` held 84, 214 and 340, with non-empty
--    `leaderboard` arrays.
--
--    There is no participant table. Joining a challenge is recorded in
--    `useAppStore.joinedChallenges`, on the device. So those counts were never
--    measured and those leaderboards were never earned — the client seed in
--    src/data/challenges.ts already says so in a comment («never counted
--    anywhere»), and the detail screen refuses to draw a board at all:
--    «Reytinq cədvəli iştirakçı datası toplananda açılacaq. Uydurma sıralama
--    göstərmirik.» The server rows were the half nobody corrected, and
--    `useChallenges` maps them straight through.
--
--    Zeroed. When a real join is recorded somewhere, the count can come from it.
--
-- Apply AFTER schema33_storage_ownership.sql, together with the create.tsx
-- change that stops writing the withheld columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Programs: an author may write a program, not its reputation
-- ----------------------------------------------------------------------------
alter table public.programs alter column done_by set default 0;

revoke insert, update on public.programs from anon, authenticated;

grant insert (
  id, title, creator_name, creator_type, weeks, days_per_week, level, goal,
  paid, price, minutes, video_count, has_meal_plan, tags, days, owner_id, description
) on public.programs to anon, authenticated;

grant update (
  title, creator_name, weeks, days_per_week, level, goal,
  paid, price, minutes, video_count, has_meal_plan, tags, days, description
) on public.programs to anon, authenticated;

-- Withheld: creator_verified, rating, done_by, saves, hidden_at. `creator_type`
-- and `owner_id` are settable on INSERT only, and the policy below constrains both.

drop policy if exists programs_insert on public.programs;
create policy programs_insert on public.programs
  for insert to authenticated
  with check (
    owner_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    -- 'spot' is not a value a client may claim. schema17 already forces a SPOT
    -- program to be free; this stops one being attributed to SPOT at all.
    and coalesce(creator_type, 'user') in ('trainer', 'user')
    and not public.is_sanctioned(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 2. Challenges: no invented crowd
-- ----------------------------------------------------------------------------
update public.challenges
   set participants = 0,
       leaderboard = '[]'::jsonb
 where coalesce(participants, 0) <> 0
    or leaderboard is distinct from '[]'::jsonb;

comment on column public.challenges.participants is
  'Must stay 0 until a real join is recorded server-side. Joining is currently device-local (useAppStore.joinedChallenges), so any non-zero value here is invented.';
