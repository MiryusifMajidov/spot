-- ============================================================================
-- SPOT · schema45_counts.sql
--
-- Two more counters that were written once and never moved:
--
--   feed_videos.comments      · 0 on a video with EIGHT real comments
--   community_posts.comments  · same shape
--
-- and one signal with no table at all: saving a video lived in
-- `useAppStore.savedVideos`, so nobody — not even the author — could know a
-- video had been saved.
--
-- WHO SEES WHAT. Likes and comments are public counts, the way they are
-- everywhere. Saves are NOT: on Instagram the save count is visible only to the
-- author, in their own insights, and that is the right shape here too — a public
-- save count turns a private bookmark into a broadcast. So `saves` is readable
-- only by the video's author (and an admin), through a function rather than a
-- column anyone can select.
--
-- All three counters are withheld from clients and maintained by triggers, the
-- same rule as everywhere else in this schema: a number nobody can type is a
-- number nobody can inflate.
--
-- Apply AFTER schema44_counter_grants.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Saves
-- ----------------------------------------------------------------------------
create table if not exists public.video_saves (
  video_id   text not null references public.feed_videos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, profile_id)
);
create index if not exists video_saves_by_profile on public.video_saves (profile_id);

alter table public.video_saves enable row level security;
revoke all on public.video_saves from anon, authenticated;
grant select, insert, delete on public.video_saves to authenticated;

-- You can read your OWN saves. Whose bookmark shelf a video sits on is nobody
-- else's business — the author gets the COUNT, not the names.
drop policy if exists video_saves_own on public.video_saves;
create policy video_saves_own on public.video_saves
  for all to authenticated
  using (profile_id = public.my_profile_id())
  with check (profile_id = public.my_profile_id() and not public.is_sanctioned(auth.uid()));

alter table public.feed_videos add column if not exists saves integer not null default 0;

create or replace function public.tg_video_saves()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := case when tg_op = 'DELETE' then old.video_id else new.video_id end;
  update public.feed_videos
     set saves = (select count(*) from public.video_saves s where s.video_id = v)
   where id = v;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists video_saves_sync on public.video_saves;
create trigger video_saves_sync after insert or delete on public.video_saves
  for each row execute function public.tg_video_saves();

/** The save count, for the author only. A function rather than a column so the
 *  number cannot be read off the feed by everybody. */
create or replace function public.video_save_count(v text)
returns integer
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare owner_profile uuid; n int;
begin
  select author_id into owner_profile from public.feed_videos where id = v;
  if owner_profile is null then return null; end if;
  if owner_profile <> public.my_profile_id() and not public.is_admin(auth.uid()) then
    return null;   -- not yours to see
  end if;
  select count(*) into n from public.video_saves s where s.video_id = v;
  return n;
end $$;

grant execute on function public.video_save_count(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Comment counts become counts
--
--    Comments are addressed by `target_key` («video:<id>», «post:<id>»), the
--    same key the comment sheet uses, so the trigger derives the id from it.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_comment_count(key text)
returns void language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.comments c where c.target_key = key;
  if key like 'video:%' then
    update public.feed_videos set comments = n where id = substring(key from 7);
  elsif key like 'post:%' then
    update public.community_posts set comments = n where id::text = substring(key from 6);
  end if;
end $$;

create or replace function public.tg_comment_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_comment_count(case when tg_op = 'DELETE' then old.target_key else new.target_key end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists comments_sync_count on public.comments;
create trigger comments_sync_count after insert or delete on public.comments
  for each row execute function public.tg_comment_count();

-- ----------------------------------------------------------------------------
-- 3. Nobody types these numbers
--
--    `hidden_at` stays writable (a moderator takedown); everything else on these
--    two tables is derived or set at insert.
-- ----------------------------------------------------------------------------
revoke update on public.feed_videos     from anon, authenticated;
revoke update on public.community_posts from anon, authenticated;
grant update (hidden_at) on public.feed_videos     to authenticated;
grant update (hidden_at) on public.community_posts to authenticated;
revoke insert (likes, comments, saves) on public.feed_videos     from anon, authenticated;
revoke insert (likes, comments)        on public.community_posts from anon, authenticated;

-- One-time correction: the columns held seeded values, never counts.
update public.feed_videos v set
  likes    = (select count(*) from public.video_likes l where l.video_id = v.id),
  saves    = (select count(*) from public.video_saves s where s.video_id = v.id),
  comments = (select count(*) from public.comments c where c.target_key = 'video:' || v.id);

update public.community_posts p set
  likes    = (select count(*) from public.post_likes l where l.post_id = p.id),
  comments = (select count(*) from public.comments c where c.target_key = 'post:' || p.id::text);
