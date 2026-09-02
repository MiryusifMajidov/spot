-- ============================================================================
-- SPOT · schema43_social_graph.sql  (F-19)
--
-- Every social signal lived on the device: `likedPosts`, `savedVideos`,
-- `following` and `joinedChallenges` in `useAppStore`. So:
--   · an author never learned that anybody liked their video — the counters on
--     `feed_videos.likes` / `community_posts.likes` were written once and never
--     moved;
--   · «İzlənir» changed nothing for anyone;
--   · a challenge could not have a participant count or a ranking;
--   · and `following` was keyed by the author's NAME, so two people with the
--     same name followed each other's posts and a rename broke the link.
--
-- Same reason the notification for a video like could not be built in schema35:
-- the server did not know who liked what. It can now, so that notification is
-- added here.
--
-- `profile/index.tsx` also selected «my videos» with `v.author === profile.name`
-- while `author_id` sat right there — two people called «Yusif» each saw the
-- other's videos as their own. Fixed in the client.
--
-- Apply AFTER schema42_real_messaging.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Likes on feed videos
-- ----------------------------------------------------------------------------
create table if not exists public.video_likes (
  video_id   text not null references public.feed_videos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)    on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, profile_id)
);
create index if not exists video_likes_by_profile on public.video_likes (profile_id);

alter table public.video_likes enable row level security;
revoke all on public.video_likes from anon, authenticated;
grant select, insert, delete on public.video_likes to authenticated;

drop policy if exists video_likes_read on public.video_likes;
create policy video_likes_read on public.video_likes for select to authenticated using (true);

drop policy if exists video_likes_own on public.video_likes;
create policy video_likes_own on public.video_likes
  for all to authenticated
  using (profile_id = public.my_profile_id())
  with check (profile_id = public.my_profile_id() and not public.is_sanctioned(auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Likes on community posts
-- ----------------------------------------------------------------------------
create table if not exists public.post_likes (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)        on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);
create index if not exists post_likes_by_profile on public.post_likes (profile_id);

alter table public.post_likes enable row level security;
revoke all on public.post_likes from anon, authenticated;
grant select, insert, delete on public.post_likes to authenticated;

drop policy if exists post_likes_read on public.post_likes;
create policy post_likes_read on public.post_likes for select to authenticated using (true);

drop policy if exists post_likes_own on public.post_likes;
create policy post_likes_own on public.post_likes
  for all to authenticated
  using (profile_id = public.my_profile_id())
  with check (profile_id = public.my_profile_id() and not public.is_sanctioned(auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. Follows — by profile id, never by name
-- ----------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_by_followee on public.follows (followee_id);

alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select to authenticated using (true);

drop policy if exists follows_own on public.follows;
create policy follows_own on public.follows
  for all to authenticated
  using (follower_id = public.my_profile_id())
  with check (
    follower_id = public.my_profile_id()
    and not public.is_sanctioned(auth.uid())
    -- Following somebody who blocked you would put your name in their followers.
    and not public.blocked_between(follower_id, followee_id)
  );

-- ----------------------------------------------------------------------------
-- 4. Challenge participation
-- ----------------------------------------------------------------------------
create table if not exists public.challenge_members (
  challenge_id text not null references public.challenges(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id)   on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (challenge_id, profile_id)
);

alter table public.challenge_members enable row level security;
revoke all on public.challenge_members from anon, authenticated;
grant select, insert, delete on public.challenge_members to authenticated;

drop policy if exists challenge_members_read on public.challenge_members;
create policy challenge_members_read on public.challenge_members for select to authenticated using (true);

drop policy if exists challenge_members_own on public.challenge_members;
create policy challenge_members_own on public.challenge_members
  for all to authenticated
  using (profile_id = public.my_profile_id())
  with check (profile_id = public.my_profile_id() and not public.is_sanctioned(auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. The counters become counts
--
--    `feed_videos.likes`, `community_posts.likes` and `challenges.participants`
--    are withheld from clients — a number nobody can type is a number nobody can
--    inflate — and maintained by these triggers, the same pattern as
--    `gyms.trainers` (schema23) and `trainers.clients` (schema27).
-- ----------------------------------------------------------------------------
revoke update (likes) on public.feed_videos from anon, authenticated;
revoke update (likes) on public.community_posts from anon, authenticated;
revoke insert (participants), update (participants) on public.challenges from anon, authenticated;

create or replace function public.refresh_video_likes(v text)
returns void language sql security definer set search_path = public as $$
  update public.feed_videos
     set likes = (select count(*) from public.video_likes l where l.video_id = v)
   where id = v;
$$;

create or replace function public.tg_video_likes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.refresh_video_likes(old.video_id); return old; end if;
  perform public.refresh_video_likes(new.video_id);
  -- Now that the server knows WHO liked WHAT, the notification schema35 could
  -- not honestly build becomes possible.
  perform public.notify(
    (select v.author_id from public.feed_videos v where v.id = new.video_id),
    new.profile_id, 'video_like', 'video:' || new.video_id, new.video_id);
  return new;
end $$;

drop trigger if exists video_likes_sync on public.video_likes;
create trigger video_likes_sync after insert or delete on public.video_likes
  for each row execute function public.tg_video_likes();

create or replace function public.tg_post_likes()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  pid := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  update public.community_posts
     set likes = (select count(*) from public.post_likes l where l.post_id = pid)
   where id = pid;
  if tg_op = 'INSERT' then
    perform public.notify(
      (select c.author_id from public.community_posts c where c.id = new.post_id),
      new.profile_id, 'post_like', null, new.post_id::text);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists post_likes_sync on public.post_likes;
create trigger post_likes_sync after insert or delete on public.post_likes
  for each row execute function public.tg_post_likes();

create or replace function public.tg_challenge_members()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid text;
begin
  cid := case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end;
  update public.challenges
     set participants = (select count(*) from public.challenge_members m where m.challenge_id = cid)
   where id = cid;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists challenge_members_sync on public.challenge_members;
create trigger challenge_members_sync after insert or delete on public.challenge_members
  for each row execute function public.tg_challenge_members();

-- ----------------------------------------------------------------------------
-- 6. Two more notification types, and a follow notification
-- ----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment_like','comment_reply','mention','match_request',
                  'match_accepted','trainer_request','trainer_decided',
                  'review_reply','message','video_like','post_like','follow'));

create or replace function public.tg_follows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.followee_id, new.follower_id, 'follow', null, null);
  return new;
end $$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows
  for each row execute function public.tg_follows();

-- The existing counters were seeded, never counted. Bring them to the truth.
update public.feed_videos v
   set likes = (select count(*) from public.video_likes l where l.video_id = v.id);
update public.community_posts c
   set likes = (select count(*) from public.post_likes l where l.post_id = c.id);
update public.challenges ch
   set participants = (select count(*) from public.challenge_members m where m.challenge_id = ch.id);
