-- ============================================================================
-- SPOT · schema29_author_required.sql
--
-- IMPERSONATION. The insert policies on `community_posts` and `feed_videos` read
--
--   (author_id is null or author_id in (select id from profiles where user_id = auth.uid()))
--
-- The first half is an open door: passing no `author_id` satisfies it, and the
-- displayed name is a plain text column the client chooses. `reviews_insert` had
-- no author condition at all. Verified live as an ordinary signed-in account:
--
--   post as «Iron Bay», no author_id            -> ACCEPTED
--   post as «Elvin Qasımov», no author_id       -> ACCEPTED
--   feed video with no author_id                -> ACCEPTED
--   review on iron-bay with no author_id        -> ACCEPTED
--
-- The review one is the worst: `reviews_sync_gym_rating` turns those rows into
-- the gym's public star rating, so anyone could move any gym's score up or down
-- under any name they liked.
--
-- Every piece of content now carries the profile that wrote it. That is also
-- what makes the rest of the system work: `hidden_at` takedowns, sanctions,
-- «bu mənim postumdur» and the report queue all need to know whose it is.
--
-- The `author` / `name` text columns stay — a gym announcement wants to read
-- «Iron Bay» — but they are a LABEL beside a real author id, not a substitute
-- for one.
--
-- Existing rows with a NULL author are left alone: they predate this and the app
-- already renders them as «SPOT istifadəçisi» rather than guessing.
--
-- Apply AFTER schema28_request_decisions.sql, together with the client change
-- that stamps `author_id` on gym announcements.
-- ============================================================================

drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists feed_videos_insert on public.feed_videos;
create policy feed_videos_insert on public.feed_videos
  for insert to authenticated
  with check (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
  );
