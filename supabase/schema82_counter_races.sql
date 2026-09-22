-- APPLIED 2026-09-22 with the owner's approval. After it: all 8 functions lock first
-- (plpgsql), 0 counter drift, verify_schema 532/532.
-- schema82: denormalised counters could lose an update under concurrency.
--
-- Found by the live multi-user run cmw5xa (2026-09-22): a trainer accepted three
-- students at the same instant and the public listing said «2 şagird».
--
-- Every counter was recomputed as
--   update T set n = (select count(*) from ...) where id = X;
-- The sub-select reads the snapshot taken when the statement STARTS. Two
-- transactions that both change the counted rows both reach this update; the
-- second waits for the first's row lock, and when it gets it Postgres re-checks
-- the WHERE on the new row version — but not the sub-select, which still counts
-- without the first transaction's row. The last writer stores a stale number.
--
-- Now each function takes the row lock in its OWN statement first, then counts
-- in a new statement. Under READ COMMITTED every statement gets a fresh snapshot,
-- so the count runs after the other transaction has committed and includes it.
--
-- Same pattern, same fix, in all eight places:
--   trainers.clients, gyms.trainers, gyms.members, gyms.rating + review_count,
--   feed_videos.likes, feed_videos.saves, community_posts.likes,
--   challenges.participants.
-- Checked before this change: all eight counters matched their rows (0 drift).
-- CREATE OR REPLACE keeps each function's existing EXECUTE grants (schema63).

create or replace function public.refresh_trainer_clients(t text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  perform 1 from public.trainers where id = t for update;
  select count(*) into n from public.trainer_requests r where r.trainer_id = t and r.status = 'accepted';
  update public.trainers set clients = n where id = t;
end $function$;

create or replace function public.refresh_gym_trainers(g text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  perform 1 from public.gyms where id = g for update;
  select count(*) into n from public.trainers t where t.gym_id = g and coalesce(t.listed, false);
  update public.gyms set trainers = n where id = g;
end $function$;

create or replace function public.refresh_gym_members(g_id text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  perform 1 from public.gyms where id = g_id for update;
  select count(*) into n from public.profiles p where p.home_gym_id = g_id;
  update public.gyms set members = n where id = g_id;
end $function$;

create or replace function public.refresh_gym_rating(g_id text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare avg_r numeric; n int;
begin
  perform 1 from public.gyms where id = g_id for update;
  select round(avg(r.rating)::numeric, 1), count(*) into avg_r, n from public.reviews r where r.gym_id = g_id;
  update public.gyms set rating = coalesce(avg_r, 0), review_count = n where id = g_id;
end $function$;

create or replace function public.refresh_video_likes(v text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  perform 1 from public.feed_videos where id = v for update;
  select count(*) into n from public.video_likes l where l.video_id = v;
  update public.feed_videos set likes = n where id = v;
end $function$;

create or replace function public.tg_challenge_members()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare cid text; n int;
begin
  cid := case when tg_op = 'DELETE' then old.challenge_id else new.challenge_id end;
  perform 1 from public.challenges where id = cid for update;
  select count(*) into n from public.challenge_members m where m.challenge_id = cid;
  update public.challenges set participants = n where id = cid;
  return case when tg_op = 'DELETE' then old else new end;
end $function$;

create or replace function public.tg_post_likes()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare pid uuid; n int;
begin
  pid := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  perform 1 from public.community_posts where id = pid for update;
  select count(*) into n from public.post_likes l where l.post_id = pid;
  update public.community_posts set likes = n where id = pid;
  if tg_op = 'INSERT' then
    perform public.notify(
      (select c.author_id from public.community_posts c where c.id = new.post_id),
      new.profile_id, 'post_like', null, new.post_id::text);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $function$;

create or replace function public.tg_video_saves()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v text; n int;
begin
  v := case when tg_op = 'DELETE' then old.video_id else new.video_id end;
  perform 1 from public.feed_videos where id = v for update;
  select count(*) into n from public.video_saves s where s.video_id = v;
  update public.feed_videos set saves = n where id = v;
  return case when tg_op = 'DELETE' then old else new end;
end $function$;
