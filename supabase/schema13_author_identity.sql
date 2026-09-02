-- ============================================================================
-- SPOT · schema13_author_identity.sql
--
-- Feed videos and community posts record their author as a DISPLAY NAME string
-- and nothing else. That is why the app could not tell that a video was your
-- own: it compared «Sən» against your profile name and, for a guest or a
-- half-filled profile, got it wrong — so the app offered you an «İzlə» button
-- on your own post.
--
-- Comparing names is wrong in principle too: two people may share a name, and a
-- person may rename themselves. Identity has to be an id.
--
-- Apply AFTER schema12_username.sql. Additive only.
-- ============================================================================

alter table public.feed_videos     add column if not exists author_id uuid references public.profiles(id) on delete set null;
alter table public.community_posts add column if not exists author_id uuid references public.profiles(id) on delete set null;

create index if not exists feed_videos_author_id_idx     on public.feed_videos (author_id);
create index if not exists community_posts_author_id_idx on public.community_posts (author_id);

-- Readable by clients: the app needs it to answer "is this mine?".
-- (No column-level grants are in force on these two tables — only `profiles`
--  has them, from schema9 — so the new columns are already selectable.)

-- Rows written before this migration keep author_id NULL. They are NOT
-- back-filled by guessing from the name: a guess is exactly the kind of
-- fabrication this codebase is being cleaned of. The client treats NULL as
-- "unknown author" and simply does not claim the post is yours.

-- ----------------------------------------------------------------------------
-- Ownership can now be enforced instead of trusted.
--
-- Both tables had insert-only-and-read-all policies, so anyone could post under
-- anyone's name. With an author_id we can require that a new row is stamped with
-- the poster's OWN profile, and let a person delete what they posted.
-- ----------------------------------------------------------------------------
-- The existing insert policies are named `feedvideos_insert` / `posts_insert`
-- (verified against pg_policies). They MUST be dropped by those exact names —
-- RLS ORs permissive policies together, so leaving the old allow-anything rule
-- in place would make the ownership check below decorative.
drop policy if exists feedvideos_insert on public.feed_videos;
drop policy if exists feed_videos_insert on public.feed_videos;
create policy feed_videos_insert on public.feed_videos
  for insert to authenticated
  with check (
    author_id is null
    or author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
  );

drop policy if exists feed_videos_owner_delete on public.feed_videos;
create policy feed_videos_owner_delete on public.feed_videos
  for delete to authenticated
  using (author_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

drop policy if exists posts_insert on public.community_posts;
drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    author_id is null
    or author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
  );

drop policy if exists community_posts_owner_delete on public.community_posts;
create policy community_posts_owner_delete on public.community_posts
  for delete to authenticated
  using (author_id in (select p.id from public.profiles p where p.user_id = auth.uid()));
