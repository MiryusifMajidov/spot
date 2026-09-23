-- schema87: «Hesabı sil» works for somebody who has written a gym review — and
-- the name really comes off.
--
-- Found while proving schema85 (rolled back, 2026-09-23). Two triggers stood in
-- the way, and both fire on the same UPDATE:
--
-- 1. reviews.author_id is ON DELETE SET NULL, so deleting the profile makes
--    Postgres UPDATE the review. reviews_guard treats ANY change of author_id as
--    tampering and raises `review_identity_is_fixed` — so delete_my_account()
--    threw and the account could not be deleted at all. Nobody hit it yet only
--    because no review exists in production. Both stores require account
--    deletion to work, and the app promises it in writing.
--    A client cannot forge this: author_id is not in the UPDATE grant for
--    `authenticated` (only body, name, rating, reply, reply_at are). The guard
--    now allows exactly one identity change — detaching a review from a person
--    who is being deleted (author_id → NULL) — and nothing else.
--
-- 2. reviews_stamp (schema80) re-applies `new.name := old.name` on every UPDATE,
--    which would have quietly undone schema85's anonymisation. It now lets the
--    name go to NULL on a row that has no author any more.
--
-- delete_my_account() detaches and anonymises in one statement before the
-- profile goes, so the FK has nothing left to touch.
--
-- Proof, run against the live database and rolled back (2026-09-23): a real
-- account with a review calls delete_my_account() as itself, and
--
--   RESULTS review kept=1, name=NULL, body=«TEST rəy mətni», profile gone=t
--
-- Before this file the same block ended in
--   ERROR: review_identity_is_fixed
-- i.e. the account could not be deleted at all. The app shows the detached row
-- as «Hesabı silinmiş istifadəçi» (src/lib/format.ts reviewerName).

create or replace function public.reviews_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare is_author boolean; is_owner boolean; detaching boolean;
begin
  is_author := exists (
    select 1 from public.profiles p
     where p.id = old.author_id and p.user_id = auth.uid()
  );
  is_owner := exists (
    select 1 from public.gyms g
     join public.profiles p on p.id = g.owner_id
     where g.id = old.gym_id and p.user_id = auth.uid()
  );
  -- «Hesabı sil» / the FK's own ON DELETE SET NULL: the review stays with the
  -- gym, the person leaves it. Nothing else may move author_id, and no client
  -- can: the column is not in the UPDATE grant.
  detaching := old.author_id is not null and new.author_id is null;

  -- The reply belongs to the gym.
  if (new.reply is distinct from old.reply or new.reply_at is distinct from old.reply_at)
     and not is_owner then
    raise exception 'only_the_gym_may_reply' using errcode = '42501';
  end if;

  -- The review belongs to the member who wrote it.
  if (new.body    is distinct from old.body
   or new.rating  is distinct from old.rating
   or new.name    is distinct from old.name
   or new.tenure  is distinct from old.tenure)
     and not (is_author or detaching) then
    raise exception 'only_the_author_may_edit' using errcode = '42501';
  end if;

  -- Neither of them may change whose review it is, or which gym it is about.
  if (new.author_id is distinct from old.author_id and not detaching)
     or new.gym_id is distinct from old.gym_id then
    raise exception 'review_identity_is_fixed' using errcode = '42501';
  end if;

  return new;
end $function$;

create or replace function public.reviews_stamp()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  if tg_op = 'INSERT' then
    new.reply      := null;
    new.reply_at   := null;
    new.created_at := now();
    -- reviews_insert already requires author_id to be the caller's own profile.
    new.name := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = new.author_id), new.name);
    select count(*) into n from public.check_ins c
     where c.gym_id = new.gym_id and c.profile_id = new.author_id;
    -- The exact shape the app renders (src/lib/format.ts tenureLabel).
    new.tenure := n || ' check-in edib';
  else
    -- A review whose author is gone may lose the name (schema85/87); everything
    -- else stays exactly as it was stamped at posting.
    if new.author_id is null and new.name is null then
      new.name := null;
    else
      new.name := old.name;
    end if;
    new.tenure     := old.tenure;
    new.created_at := old.created_at;
  end if;
  return new;
end $function$;

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

    /* The review stays for the gym; the person leaves it (schema85/87). Done in
       one statement BEFORE the profile goes, so the FK's own SET NULL has
       nothing left to do. */
    update public.reviews set author_id = null, name = null where author_id = pid;

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
