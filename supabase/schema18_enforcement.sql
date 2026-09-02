-- ============================================================================
-- SPOT · schema18_enforcement.sql
--
-- The moderation system was theatre. An admin could write `banned` into
-- profiles.status, and nothing anywhere read it — so a banned person kept using
-- the app normally. Worse, the sanctioned user could simply write `active` back
-- over it themselves.
--
-- Verified on the live database before writing this file: `anon` and
-- `authenticated` hold UPDATE on EVERY column of public.profiles, including
-- `status`, `status_reason`, `status_until`, `reports_count`, `id`, `phone` and
-- `created_at`. (`user_id` is already safe: the `profiles_update` policy has no
-- WITH CHECK, so Postgres reuses its USING clause and the new row must still
-- satisfy `user_id = auth.uid()`.)
--
-- This file makes the sanction real, makes a content takedown real, and closes
-- the privilege hole. Apply AFTER schema17_spot_programs_free.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A user may edit their profile — not their moderation record
--
--    Exactly the columns the client actually writes stay updatable:
--      · saveProfile (src/store/appStore.ts toDbPatch + the privacy flags)
--      · becomeTrainer  → role, specialty, price_from
--      · setMyAvatar    → avatar_url
--    `user_id` stays because the upsert's ON CONFLICT path sets it, and RLS
--    already prevents pointing it at somebody else.
-- ----------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;

grant update (
  user_id, name, username, gender, age, home_gym_id, level, goals, types,
  time_slot, bio, visibility, show_in_gym_list, avatar_url,
  role, specialty, price_from
) on public.profiles to anon, authenticated;

-- Deliberately NOT granted: id, created_at, phone, status, status_reason,
-- status_until, reports_count, requests_sent, requests_answered,
-- streak_current, last_active_at. Those belong to moderation or are derived.

-- ----------------------------------------------------------------------------
-- 2. Is this account under a live sanction?
--
--    A sanction is live when the status is not 'active' AND it has not lapsed.
--    `status_until` is set for the 7-day mute and NULL for the indefinite rungs,
--    so NULL means "still in force" — the same rule the admin panel displays.
-- ----------------------------------------------------------------------------
create or replace function public.is_sanctioned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = uid
       and coalesce(p.status, 'active') <> 'active'
       and (p.status_until is null or p.status_until > now())
  );
$$;

grant execute on function public.is_sanctioned(uuid) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A sanctioned account cannot write
--
--    Each policy keeps its existing ownership check verbatim and gains the
--    sanction gate. Muting, suspending and banning all stop new content; the
--    difference between the rungs is duration and what the client hides.
-- ----------------------------------------------------------------------------
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists community_posts_insert on public.community_posts;
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    (author_id is null or author_id in (select p.id from public.profiles p where p.user_id = auth.uid()))
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists feed_videos_insert on public.feed_videos;
create policy feed_videos_insert on public.feed_videos
  for insert to authenticated
  with check (
    (author_id is null or author_id in (select p.id from public.profiles p where p.user_id = auth.uid()))
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    (author_id is null or author_id in (select p.id from public.profiles p where p.user_id = auth.uid()))
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists match_insert on public.match_requests;
create policy match_insert on public.match_requests
  for insert to authenticated
  with check (
    from_profile in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
  );

-- `messages_insert` was `with check (true)` — anyone could write into any thread.
-- Tighten it to a signed-in, unsanctioned account. (Thread membership is not
-- modelled on this table, so that is as far as it can be taken here.)
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (not public.is_sanctioned(auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. A takedown must actually take the content down
--
--    The panel logged a `content_remove` action and left the row live. Give the
--    three content tables a `hidden_at` stamp and let a moderator set it; the
--    app filters on it. Hiding, not deleting: a removed row must stay available
--    for appeal and for the audit trail.
-- ----------------------------------------------------------------------------
alter table public.programs        add column if not exists hidden_at timestamptz;
alter table public.feed_videos     add column if not exists hidden_at timestamptz;
alter table public.community_posts add column if not exists hidden_at timestamptz;

create index if not exists programs_visible_idx        on public.programs (hidden_at) where hidden_at is null;
create index if not exists feed_videos_visible_idx     on public.feed_videos (hidden_at) where hidden_at is null;
create index if not exists community_posts_visible_idx on public.community_posts (hidden_at) where hidden_at is null;

drop policy if exists programs_admin_hide on public.programs;
create policy programs_admin_hide on public.programs
  for update to authenticated
  using (public.admin_at_least(auth.uid(), 'moderator'))
  with check (public.admin_at_least(auth.uid(), 'moderator'));

drop policy if exists feed_videos_admin_hide on public.feed_videos;
create policy feed_videos_admin_hide on public.feed_videos
  for update to authenticated
  using (public.admin_at_least(auth.uid(), 'moderator'))
  with check (public.admin_at_least(auth.uid(), 'moderator'));

drop policy if exists community_posts_admin_hide on public.community_posts;
create policy community_posts_admin_hide on public.community_posts
  for update to authenticated
  using (public.admin_at_least(auth.uid(), 'moderator'))
  with check (public.admin_at_least(auth.uid(), 'moderator'));
