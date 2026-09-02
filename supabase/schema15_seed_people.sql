-- ============================================================================
-- SPOT · schema15_seed_people.sql
--
-- Found by opening «Kəşf → Yoldaşlar» with a real account: the partner list was
-- still offering invented people. schema10 removed the fabricated trainers, feed
-- videos and community posts, but not the fabricated PROFILES behind them.
--
-- Verified on the live database before writing this:
--   · 5 profiles have `user_id IS NULL` — Orxan, Nigar, Tural, Kamran, Aysel.
--     A profile is created for a real person by the `handle_new_user` trigger on
--     auth signup, so a NULL `user_id` can only be a seed. Nobody can sign in as
--     them, which means a match request sent to one can never be answered.
--   · 3 seeded `check_ins` rows make three of them show a live «indi zalda»
--     badge — a presence claim about a person who does not exist.
--   · public.reviews holds the same two seeded reviews three times over
--     («Elçin» 5★, «Günel» 4★ — schema2 re-run, uuid default so ON CONFLICT
--     never matched). That is where Iron Bay's «★4.5 · 6 rəy» came from: the
--     schema11 trigger derives the rating honestly, but from invented rows.
--
-- Apply AFTER schema14_comments.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The invented people
--
--    Every FK to profiles is ON DELETE CASCADE (verified), so their check-ins,
--    workouts, PRs, progress, match requests and trainer requests go with them.
--    The schema11 triggers then recompute gyms.members by themselves.
-- ----------------------------------------------------------------------------
delete from public.profiles where user_id is null;

-- ----------------------------------------------------------------------------
-- 2. The invented reviews
--
--    A real review is written by src/app/(tabs)/discover/gym/[id].tsx with
--    `tenure = '<N> check-in edib'`. The seeded ones say «8 aydır check-in edir»
--    / «3 aydır check-in edir» — a different wording the app never produces, so
--    this predicate cannot reach a review a person actually wrote.
--
--    The schema11 trigger recomputes gyms.rating and review_count on delete, so
--    a gym with no real reviews correctly falls back to no rating at all.
-- ----------------------------------------------------------------------------
delete from public.reviews where tenure like '%aydır%';

-- ----------------------------------------------------------------------------
-- 3. Give reviews an author, so this cannot recur
--
--    `reviews` identifies its writer by a NAME string and nothing else — the
--    same weakness that made feed videos unable to tell whose they were until
--    schema13 added author_id. Without it a review cannot be attributed,
--    moderated, or deleted by the person who wrote it.
--
--    Nullable: rows written before this exist, and a null author is honest
--    ("we do not know") rather than a guess.
-- ----------------------------------------------------------------------------
alter table public.reviews add column if not exists author_id uuid references public.profiles(id) on delete set null;
create index if not exists reviews_author_idx on public.reviews (author_id);

-- The insert policy is currently `with check (true)` — anyone could write a
-- review under anyone's name. Tie it to the writer, the way comments are.
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    author_id is null
    or author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
  );

-- You may remove your own review. The gym owner may NOT: schema7 states reviews
-- stay the members' property, and schema9 already restricted owners to writing
-- the `reply` column only.
drop policy if exists reviews_author_delete on public.reviews;
create policy reviews_author_delete on public.reviews
  for delete to authenticated
  using (author_id in (select p.id from public.profiles p where p.user_id = auth.uid()));
