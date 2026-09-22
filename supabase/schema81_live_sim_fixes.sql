-- schema81: defects found by the live multi-user run (scripts/sim, run cl9gnb,
-- 2026-09-22: 10 accounts acting at once; 202 PASS, 4 FAIL).
--
-- 1. trainer_requests_guard let a student set `pending` from ANY status. The
--    app's own requestTrainer() UPSERTS status:'pending' on (trainer_id,
--    from_profile), so a student who had been ACCEPTED could put the pair back
--    to pending: decided_at cleared, the trainer's active count dropped, and the
--    trainer was told nothing (FAIL decide-concurrently.accepted-cannot-reset).
--    Asking again is the student's right only after «rədd edildi» or «bitdi».
--
-- 2. open_thread looked the pair up and then inserted, with no ON CONFLICT. Two
--    people writing first at the same instant both inserted; the loser got the
--    unique violation on chat_threads_pair, which the app showed as «Hesabına
--    məhdudiyyət qoyulub» (FAIL program-chat.first-message-race). The insert now
--    yields to the row the other side just created. (The app also stopped
--    calling a unique violation a sanction, and retries once.)
--
-- 3. notifications.actor_id was ON DELETE SET NULL. When the person who caused a
--    notification deleted their account, the notification stayed — unread, as
--    «Kimsə şagirdin olmaq istəyir» — pointing at a request, like or message
--    that the same deletion had removed. It now goes with its actor.
--
-- 4. delete_my_account() left two kinds of the person's rows behind:
--    · their PROGRAMS: owner_id SET NULL, and programs_read is public, so a
--      deleted account's programs stayed readable by everyone, ownerless;
--    · a gym they created that SPOT never listed: detached but still USABLE
--      (check_in_with_code and create_day_pass look at neither owner nor
--      listed), with no one left to see or switch anything off.
--    Both are now deleted. A LISTED gym stays, as before: it is in the catalogue
--    and other people depend on it. A never-listed gym is deleted only when no
--    other profile or trainer points at it (those FKs are NO ACTION); its day
--    passes go first, because day_passes.gym_id is SET NULL and would otherwise
--    leave passes with neither a user nor a gym.

-- ---------------------------------------------------------------- 1 ----
create or replace function public.trainer_requests_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare is_trainer boolean;
begin
  is_trainer := public.owns_trainer(new.trainer_id);

  if tg_op = 'INSERT' then
    if not is_trainer and coalesce(new.status, 'pending') <> 'pending' then
      raise exception 'trainer_request_must_start_pending' using errcode = '42501';
    end if;
    if is_trainer then new.decided_at := now(); end if;
    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status then
    if is_trainer then
      new.decided_at := now();
    elsif public.owns_profile(new.from_profile) and new.status = 'pending'
          and old.status in ('declined', 'ended') then
      -- Asking again after «rədd edildi» or «bitdi» is the student's to do.
      -- Not over an ACCEPTED request: that would undo the trainer's decision
      -- without the trainer knowing.
      new.decided_at := null;
    else
      raise exception 'only_the_trainer_decides' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------- 2 ----
create or replace function public.open_thread(other uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare me uuid; lo uuid; hi uuid; tid uuid;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if other is null or other = me then raise exception 'bad_target' using errcode = '22023'; end if;

  if public.blocked_between(me, other) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  -- An accepted partner match, an accepted trainer link in either direction, or
  -- a trainer whose listing is up.
  if not (public.has_relationship_with(other) or public.is_listed_trainer(other)) then
    raise exception 'no_relationship' using errcode = '42501';
  end if;

  lo := least(me, other); hi := greatest(me, other);
  -- Both sides may get here at the same instant; the second insert yields to
  -- the first instead of failing on chat_threads_pair.
  insert into public.chat_threads (a_profile, b_profile) values (lo, hi)
  on conflict (a_profile, b_profile) do nothing
  returning id into tid;
  if tid is null then
    select id into tid from public.chat_threads where a_profile = lo and b_profile = hi;
  end if;
  return tid;
end $function$;

-- ---------------------------------------------------------------- 3 ----
-- Notifications whose actor is already gone point at nothing.
-- (review_reply is left alone: the reply itself stays on the review.)
delete from public.notifications where actor_id is null
   and type in ('trainer_request', 'trainer_decided', 'match_request', 'match_accepted',
                'comment_like', 'comment_reply', 'mention', 'video_like', 'post_like',
                'follow', 'message');
alter table public.notifications drop constraint if exists notifications_actor_id_fkey;
alter table public.notifications
  add constraint notifications_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete cascade;

-- ---------------------------------------------------------------- 4 ----
create or replace function public.delete_my_account()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare uid uuid; pid uuid; g text;
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
    -- Programs too (schema81): programs_read is public, and owner_id SET NULL
    -- used to leave a deleted person's programs readable by everyone.
    delete from public.programs        where owner_id = pid;

    /* A gym SPOT never listed goes with its owner (schema81) — nobody else can
       have found it, and detached it stayed usable (check-ins, day passes) with
       no one to switch anything off. Only when no other profile or trainer
       points at it (NO ACTION FKs); its day passes first, since
       day_passes.gym_id is SET NULL. The owner's own references are cleared so
       they do not block it. */
    update public.profiles set home_gym_id = null
     where id = pid and home_gym_id in (select id from public.gyms where owner_id = pid);
    update public.trainers set gym_id = null
     where owner_id = pid and gym_id in (select id from public.gyms where owner_id = pid);
    for g in
      select gy.id from public.gyms gy
       where gy.owner_id = pid
         and coalesce(gy.listed, false) = false
         and not exists (select 1 from public.profiles p2 where p2.home_gym_id = gy.id and p2.id <> pid)
         and not exists (select 1 from public.trainers t2 where t2.gym_id = gy.id and t2.owner_id is distinct from pid)
    loop
      delete from public.day_passes where gym_id = g;
      delete from public.gyms where id = g;
    end loop;

    /* A LISTED gym survives with the owner detached (other people depend on
       it) — but its photos have just been deleted from storage with everything
       else this account owned. Leaving the columns set makes the card draw a
       blank grey rectangle instead of the branded placeholder, and nothing in
       the app can clear them afterwards. */
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
end $function$;
