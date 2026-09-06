-- ============================================================================
-- SPOT · schema47_insert_grants.sql
--
-- schema45 ended with
--
--   revoke insert (likes, comments, saves) on public.feed_videos from anon, authenticated;
--
-- and the test proved it did nothing: a normal account could still insert a
-- video row carrying its own `likes`. It is the SAME trap schema44 fixed for
-- UPDATE — a table-level grant covers every column, and revoking one column
-- from underneath it is a no-op. Revoking the table and granting the columns
-- back is the only shape that works, and it has to be spelled out for INSERT
-- too.
--
-- Three kinds of column come out of the insert list:
--
--   likes, comments, saves   · counts. Triggers own them.
--   verified, is_trainer     · BADGES. Nothing stopped an upload from arriving
--                              with `verified: true` — a blue check anyone
--                              could type. They are now stamped from the
--                              author's own profile.
--   author                   · the display name shown on the card. Also stamped
--                              from the profile, so a row cannot say «Coach
--                              Tural» over somebody else's account, and so a
--                              later rename is not left contradicting the feed.
--
-- created_at is granted deliberately: `hidden_at` and `created_at` are the two
-- honest client-set timestamps here, and the column defaults to now() anyway.
--
-- Apply AFTER schema46_feed_ordering.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Identity and badges come from the profile, not from the request
-- ----------------------------------------------------------------------------
create or replace function public.tg_stamp_feed_author()
returns trigger language plpgsql security definer set search_path = public
set row_security = off as $$
declare p record; t record;
begin
  select name, role into p from public.profiles where id = new.author_id;
  if p is null then
    raise exception 'author_id must be a real profile';
  end if;
  -- The badge lives on `trainers`, and a trainer row's id IS its owner's profile
  -- id (`becomeTrainer` upserts `{id: me.id}`) — so this is the same person, not
  -- a lookup by name.
  select verified into t from public.trainers where id = new.author_id::text;
  new.author     := coalesce(nullif(btrim(p.name), ''), 'SPOT istifadəçisi');
  new.is_trainer := (p.role = 'trainer');
  new.verified   := coalesce(t.verified, false);
  return new;
end $$;

drop trigger if exists feed_videos_stamp_author on public.feed_videos;
create trigger feed_videos_stamp_author before insert on public.feed_videos
  for each row execute function public.tg_stamp_feed_author();

create or replace function public.tg_stamp_post_author()
returns trigger language plpgsql security definer set search_path = public
set row_security = off as $$
declare p record;
begin
  select name into p from public.profiles where id = new.author_id;
  if p is null then
    raise exception 'author_id must be a real profile';
  end if;
  new.author := coalesce(nullif(btrim(p.name), ''), 'SPOT istifadəçisi');
  return new;
end $$;

drop trigger if exists community_posts_stamp_author on public.community_posts;
create trigger community_posts_stamp_author before insert on public.community_posts
  for each row execute function public.tg_stamp_post_author();

-- ----------------------------------------------------------------------------
-- 2. The insert lists, spelled out
--
--    `author` stays in the list only because the client still sends it and the
--    trigger overwrites it; leaving it out would make every upload fail on a
--    column the request names. What it sends no longer decides anything.
-- ----------------------------------------------------------------------------
revoke insert on public.feed_videos     from anon, authenticated;
revoke insert on public.community_posts from anon, authenticated;

grant insert (
  id, author, author_id, caption, hashtags,
  linked_program_title, linked_program_id, video_url, gradient, ord,
  created_at, duration_sec, size_bytes, poster_url
) on public.feed_videos to authenticated;

grant insert (
  id, author, author_id, gym, time_ago, type, body, stats, trainer_comment, created_at
) on public.community_posts to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Correct what the open door already let through
--
--    Any row whose badge or name disagrees with its author's profile is
--    realigned. A row with no author_id predates identity (schema13) and is
--    left alone rather than guessed at.
-- ----------------------------------------------------------------------------
update public.feed_videos v
   set author     = coalesce(nullif(btrim(p.name), ''), v.author),
       is_trainer = (p.role = 'trainer'),
       verified   = coalesce((select t.verified from public.trainers t where t.id = v.author_id::text), false)
  from public.profiles p
 where p.id = v.author_id
   and (v.author <> p.name
        or v.verified <> coalesce((select t.verified from public.trainers t where t.id = v.author_id::text), false)
        or v.is_trainer <> (p.role = 'trainer'));

update public.community_posts c
   set author = coalesce(nullif(btrim(p.name), ''), c.author)
  from public.profiles p
 where p.id = c.author_id and c.author <> p.name;
