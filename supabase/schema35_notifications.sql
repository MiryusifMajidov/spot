-- ============================================================================
-- SPOT · schema35_notifications.sql
--
-- Notifications, built so that a notification can only exist because the thing
-- it describes really happened.
--
-- The client CANNOT insert into this table at all. Every row is written by a
-- trigger on the source row — the comment like, the request, the reply — so
-- there is no way to send somebody a notification about an event that did not
-- occur, and no way to forge who it came from. The same reason the check-in
-- moved server-side in schema19.
--
-- WHAT IS COVERED, and why exactly these eight:
--   comment_like     · comment_likes INSERT      → the comment's author
--   comment_reply    · comments INSERT (parent)  → the parent comment's author
--   mention          · comments INSERT (@handle) → each mentioned profile
--   match_request    · match_requests INSERT     → to_profile
--   match_accepted   · match_requests → accepted → from_profile
--   trainer_request  · trainer_requests INSERT   → the trainer's owner
--   trainer_decided  · trainer_requests decided  → from_profile
--   review_reply     · reviews.reply set         → the review's author
--
-- WHAT IS NOT COVERED, and why: a like on a video or a community post. There is
-- no per-user like row for either — `feed_videos.likes` is a counter and the
-- like itself lives in `useAppStore.likedPosts`, on the device. So the server
-- cannot know WHO liked WHAT, and a notification saying «X sənin videonu
-- bəyəndi» would be invented. It needs a `video_likes` table first, exactly like
-- `comment_likes`.
--
-- Apply AFTER schema34_program_authorship.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-person settings
--
--    Checked INSIDE the triggers: a type that is switched off is never written,
--    rather than written and hidden. «Off» should mean the app stopped keeping
--    the record, not that it kept it out of sight.
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

grant update (notif_prefs) on public.profiles to anon, authenticated;

comment on column public.profiles.notif_prefs is
  'Per-type switches, e.g. {"mention": false}. A MISSING key means ON — a new notification type must not be silently off for everyone who registered before it existed.';

create or replace function public.notif_enabled(p_profile uuid, p_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (p.notif_prefs ->> p_type)::boolean
                     from public.profiles p where p.id = p_profile), true);
$$;

-- ----------------------------------------------------------------------------
-- 2. The table
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  type        text not null check (type in (
                'comment_like','comment_reply','mention','match_request',
                'match_accepted','trainer_request','trainer_decided','review_reply')),
  -- What to open. Comments use the same `target_key` the sheet does («v:<id>»),
  -- so tapping a notification lands on the exact thread.
  target_key  text,
  entity_id   text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_inbox
  on public.notifications (profile_id, created_at desc);
create index if not exists notifications_unread
  on public.notifications (profile_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read and mark-as-read are yours alone. There is deliberately no INSERT policy
-- and no INSERT grant: rows come from the triggers below, which run as definer.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications
  for select to authenticated
  using (profile_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications
  for update to authenticated
  using (profile_id in (select p.id from public.profiles p where p.user_id = auth.uid()))
  with check (profile_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

drop policy if exists notifications_own_delete on public.notifications;
create policy notifications_own_delete on public.notifications
  for delete to authenticated
  using (profile_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. One place that decides whether a row is written
--
--    Never notify somebody about their own action, never notify a profile that
--    switched the type off, never write a row with no recipient.
-- ----------------------------------------------------------------------------
create or replace function public.notify(
  p_profile uuid, p_actor uuid, p_type text, p_target text, p_entity text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile is null then return; end if;
  if p_actor is not null and p_actor = p_profile then return; end if;
  if not public.notif_enabled(p_profile, p_type) then return; end if;
  insert into public.notifications (profile_id, actor_id, type, target_key, entity_id)
  values (p_profile, p_actor, p_type, p_target, p_entity);
end $$;

-- ----------------------------------------------------------------------------
-- 4. Triggers, one per real event
-- ----------------------------------------------------------------------------

-- 4a. someone liked my comment
create or replace function public.tg_notify_comment_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select id, author_id, target_key into c from public.comments where id = new.comment_id;
  if not found then return new; end if;
  perform public.notify(c.author_id, new.profile_id, 'comment_like', c.target_key, c.id::text);
  return new;
end $$;

drop trigger if exists comment_likes_notify on public.comment_likes;
create trigger comment_likes_notify after insert on public.comment_likes
  for each row execute function public.tg_notify_comment_like();

-- 4b. someone replied to my comment, and 4c. someone mentioned me
create or replace function public.tg_notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent_author uuid; handle text; mentioned uuid;
begin
  if new.parent_id is not null then
    select author_id into parent_author from public.comments where id = new.parent_id;
    perform public.notify(parent_author, new.author_id, 'comment_reply', new.target_key, new.id::text);
  end if;

  -- The same shape as MENTION_RE in src/lib/comments.ts.
  for handle in
    select distinct m[1] from regexp_matches(coalesce(new.body,''), '@([A-Za-z0-9_]{3,20})', 'g') m
  loop
    select p.id into mentioned from public.profiles p where lower(p.username) = lower(handle);
    if mentioned is not null and mentioned is distinct from parent_author then
      perform public.notify(mentioned, new.author_id, 'mention', new.target_key, new.id::text);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.tg_notify_comment();

-- 4d/4e. partner request sent to me / my request was accepted
create or replace function public.tg_notify_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(new.to_profile, new.from_profile, 'match_request', null, new.id::text);
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform public.notify(new.from_profile, new.to_profile, 'match_accepted', null, new.id::text);
  end if;
  return new;
end $$;

drop trigger if exists match_requests_notify on public.match_requests;
create trigger match_requests_notify after insert or update on public.match_requests
  for each row execute function public.tg_notify_match();

-- 4f/4g. someone asked to train with me / my trainer answered
create or replace function public.tg_notify_trainer_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare coach uuid;
begin
  select t.owner_id into coach from public.trainers t where t.id = new.trainer_id;
  if tg_op = 'INSERT' then
    perform public.notify(coach, new.from_profile, 'trainer_request', null, new.id::text);
  elsif new.status is distinct from old.status
        and new.status in ('accepted','declined') then
    perform public.notify(new.from_profile, coach, 'trainer_decided', null, new.id::text);
  end if;
  return new;
end $$;

drop trigger if exists trainer_requests_notify on public.trainer_requests;
create trigger trainer_requests_notify after insert or update on public.trainer_requests
  for each row execute function public.tg_notify_trainer_request();

-- 4h. the gym answered my review
create or replace function public.tg_notify_review_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner_profile uuid;
begin
  if new.reply is not null and new.reply is distinct from old.reply then
    select g.owner_id into owner_profile from public.gyms g where g.id = new.gym_id;
    perform public.notify(new.author_id, owner_profile, 'review_reply', null, new.id::text);
  end if;
  return new;
end $$;

drop trigger if exists reviews_notify_reply on public.reviews;
create trigger reviews_notify_reply after update on public.reviews
  for each row execute function public.tg_notify_review_reply();
