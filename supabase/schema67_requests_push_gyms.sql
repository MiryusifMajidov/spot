-- ============================================================================
-- SPOT · schema67_requests_push_gyms.sql
--
-- Four defects that all live at the boundary between a client write and what the
-- database lets it mean.
--
-- 1. A RE-SENT PARTNER REQUEST BECOMES TWO ROWS, AND THE STATUS THEN FLIPS AT
--    RANDOM. `sendMatchRequest` does a bare INSERT and `match_requests` has no
--    unique constraint on the pair — unlike `trainer_requests`, which carries
--    `unique (trainer_id, from_profile)` precisely so a re-send can upsert. Once
--    a request is declined the app re-enables «Təklif göndər», so a second row
--    appears while the declined one survives. `reconcileMatches` then keys a Map
--    by the other person's id, so whichever duplicate Postgres happens to return
--    LAST wins — and the query has no ORDER BY. The same pair therefore reads
--    «Gözləyir» on one launch and «rədd edildi» on the next, with nobody having
--    touched it. The recipient sees two identical incoming cards; answering one
--    leaves the other pending for ever.
--
-- 2. THE TABLE HAS NO INDEX ON EITHER SIDE. Every read filters on `to_profile`
--    or `from_profile`, including a PostgREST `.or()` that Postgres can only
--    satisfy with a sequential scan — and it runs on app open, before the chat
--    and discover screens can render, on a connection with a 509 ms round trip.
--    `trainer_requests` was given both indexes; this table, read on more
--    screens and growing faster, never got them.
--
-- 3. A HANDED-OVER PHONE KEEPS DELIVERING TO ITS OLD OWNER. `push_tokens.token`
--    is the primary key and `push_tokens_own` is `using (profile_id =
--    my_profile_id())`, so an upsert on an existing token is evaluated against
--    the OLD row — whose owner is somebody else — and is refused. schema61
--    documents the opposite as a requirement («Re-registering an existing token
--    under a new profile moves it, so the previous owner of a borrowed phone
--    stops receiving notifications on it»). The client discards the failure, so
--    the new owner sees a page of notification switches, all on, and never
--    receives a push — while the previous owner's messages keep arriving on a
--    phone they no longer hold.
--
-- 4. A DELETED OWNER'S GYM KEEPS CLAIMING PHOTOS THAT WERE JUST DELETED.
--    Account deletion removes every storage object owned by that uid, including
--    the `gyms` bucket files, while schema52 deliberately KEEPS the gym row with
--    the owner detached — and never clears `image_url` or `photos`. The row then
--    points at objects that no longer exist, and because `image_url` is non-null
--    the app skips its branded placeholder and draws a blank grey rectangle
--    nobody can fix: the next owner cannot clear a column the app never exposes.
--    schema52 identified exactly this hazard for `feed_videos` and solved it by
--    deleting those rows; gyms got the opposite treatment and no cleanup.
--
-- Apply AFTER schema66_remove_seed_gyms.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One live request per pair
-- ----------------------------------------------------------------------------
-- Existing duplicates first: keep the newest row for each pair, which is the one
-- the app's own «last one wins» behaviour was already showing at random.
delete from public.match_requests a
 using public.match_requests b
 where a.from_profile = b.from_profile
   and a.to_profile   = b.to_profile
   and a.created_at   < b.created_at;

create unique index if not exists match_requests_one_per_pair
  on public.match_requests (from_profile, to_profile);

create index if not exists match_requests_to_idx   on public.match_requests (to_profile, status);
create index if not exists match_requests_from_idx on public.match_requests (from_profile, status);

-- ----------------------------------------------------------------------------
-- 2. Sending a request is one operation, and it is the server's
--
-- An upsert from the client cannot work here: schema64 narrowed the UPDATE grant
-- to `status` and `match_update` only lets the RECIPIENT update, so the sender's
-- ON CONFLICT branch would be refused. This does the whole thing in one place,
-- with the checks the policy used to carry.
-- ----------------------------------------------------------------------------
create or replace function public.send_match_request(p_to uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare me uuid; rid uuid; existing text;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'bad_target' using errcode = '22023'; end if;
  if public.is_sanctioned(auth.uid()) then raise exception 'sanctioned' using errcode = '42501'; end if;
  if public.blocked_between(me, p_to) then raise exception 'blocked' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_to) then
    raise exception 'no_such_profile' using errcode = '22023';
  end if;

  select status into existing from public.match_requests
   where from_profile = me and to_profile = p_to;

  -- An accepted match is not re-opened by tapping send again.
  if existing = 'accepted' then
    select id into rid from public.match_requests where from_profile = me and to_profile = p_to;
    return rid;
  end if;

  insert into public.match_requests (from_profile, to_profile, note, status)
  values (me, p_to, nullif(btrim(coalesce(p_note, '')), ''), 'pending')
  on conflict (from_profile, to_profile) do update
     set status = 'pending',
         note = excluded.note,
         created_at = now()
  returning id into rid;

  return rid;
end $$;

revoke execute on function public.send_match_request(uuid, text) from public, anon;
grant execute on function public.send_match_request(uuid, text) to authenticated;

comment on function public.send_match_request is
  'Send or re-send a partner request. One row per pair: re-sending after a decline moves the same row back to pending instead of stacking a second one, which is what made the pair''s status flip between launches.';

-- A re-send is a new event for the recipient. The trigger only handled INSERT
-- and the accept; with the upsert above, a re-send is an UPDATE and would have
-- reached nobody.
create or replace function public.tg_notify_match()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify(new.to_profile, new.from_profile, 'match_request', null, new.id::text);
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform public.notify(new.from_profile, new.to_profile, 'match_accepted', null, new.id::text);
  elsif new.status = 'pending' and old.status is distinct from 'pending' then
    -- A re-send after a decline: same row, new ask.
    perform public.notify(new.to_profile, new.from_profile, 'match_request', null, new.id::text);
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 3. A device address belongs to whoever is signed in on that device
-- ----------------------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare me uuid;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'bad_token' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('ios','android','web') then
    raise exception 'bad_platform' using errcode = '22023';
  end if;

  -- The row may belong to the phone's previous owner. Moving it is the whole
  -- point: schema61 promises that a handed-over phone stops delivering to them.
  insert into public.push_tokens (token, profile_id, platform, updated_at)
  values (p_token, me, p_platform, now())
  on conflict (token) do update
     set profile_id = excluded.profile_id,
         platform   = excluded.platform,
         updated_at = now();
end $$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

comment on function public.register_push_token is
  'Claim this device''s push address for the signed-in profile, taking it from whoever held it before. The client upsert could not do this: push_tokens_own evaluates ON CONFLICT against the OLD row, whose owner is somebody else, so the write was refused and the new owner silently received nothing.';

-- ----------------------------------------------------------------------------
-- 4. One word for one role
--
-- The push said «Məşqçi cavab verdi» while the notification centre row it opens
-- says «Müəllim cavab verdi», and the app calls the role «Müəllim» in 88 places.
-- ----------------------------------------------------------------------------
create or replace function public.push_text(p_type text, p_actor_name text)
returns text[]
language sql
immutable
as $$
  select case p_type
    when 'message'         then array['Yeni mesaj',        coalesce(p_actor_name,'Kimsə') || ' sənə mesaj yazdı']
    when 'match_request'   then array['Məşq təklifi',      coalesce(p_actor_name,'Kimsə') || ' səninlə məşq etmək istəyir']
    when 'match_accepted'  then array['Təklif qəbul edildi', coalesce(p_actor_name,'Yoldaşın') || ' təklifini qəbul etdi']
    when 'trainer_request' then array['Yeni şagird sorğusu', coalesce(p_actor_name,'Kimsə') || ' səninlə işləmək istəyir']
    when 'trainer_decided' then array['Müəllim cavab verdi', coalesce(p_actor_name,'Müəllim') || ' sorğuna cavab verdi']
    when 'comment_reply'   then array['Şərhinə cavab',     coalesce(p_actor_name,'Kimsə') || ' şərhinə cavab yazdı']
    when 'comment_like'    then array['Şərhini bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' şərhini bəyəndi']
    when 'mention'         then array['Səni qeyd etdilər', coalesce(p_actor_name,'Kimsə') || ' səni şərhdə qeyd etdi']
    when 'review_reply'    then array['Rəyinə cavab',      coalesce(p_actor_name,'Zal') || ' rəyinə cavab yazdı']
    when 'video_like'      then array['Videonu bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' videonu bəyəndi']
    when 'post_like'       then array['Paylaşımını bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' paylaşımını bəyəndi']
    when 'follow'          then array['Yeni izləyici',     coalesce(p_actor_name,'Kimsə') || ' səni izləməyə başladı']
    else array['SPOT', 'Yeni bildiriş var']
  end;
$$;

revoke execute on function public.push_text(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. A detached gym stops claiming photos that were deleted with the account
-- ----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare uid uuid; pid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select p.id into pid from public.profiles p where p.user_id = uid;

  -- Storage is NOT touched here: Supabase refuses a direct DELETE on
  -- `storage.objects`. The client removes the files first, through
  -- `my_storage_objects()` + `storage.remove()` (schema51), so a failure there
  -- stops the deletion rather than orphaning the files.

  if pid is not null then
    -- The person's own content. Their video files have just been deleted, so
    -- keeping the rows would leave dead cards in the feed.
    delete from public.feed_videos     where author_id = pid;
    delete from public.community_posts where author_id = pid;
    delete from public.comments        where author_id = pid;

    /* The gym ROW survives with the owner detached (other people depend on it) —
       but its photos have just been deleted from storage with everything else
       this account owned. Leaving the columns set makes the card draw a blank
       grey rectangle instead of the branded placeholder, and nothing in the app
       can clear them afterwards. */
    update public.gyms
       set image_url = null,
           photos = '{}'
     where owner_id = pid;

    -- Not covered by a CASCADE from `profiles`: a block row where this account
    -- is the BLOCKED side is keyed on the other person's blocker_id.
    delete from public.blocks where blocked_id = pid or blocker_id = pid;
    delete from public.profiles where id = pid;
  end if;

  delete from auth.users where id = uid;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
