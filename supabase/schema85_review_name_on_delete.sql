-- schema85: deleting the account takes the name off the person's gym reviews.
--
-- delete_my_account() removes the person's posts, comments, videos, programs and
-- profile, and reviews.author_id is ON DELETE SET NULL — but reviews.name is a
-- COPY of the display name, written when the review was posted, and it stayed on
-- the gym page for ever. «Hesabı sil» is supposed to end with nothing of the
-- person left in public; their name under a review is exactly that.
--
-- The review itself stays: it belongs to the gym's reputation, and other people
-- read it. Only the name goes. The app renders an empty name as «Hesabı silinmiş
-- istifadəçi» in the reader's own language, so nothing invents a new name.
-- (reviews.name is nullable — checked on the live schema.)

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

    -- The review stays for the gym; the name on it does not (schema85).
    update public.reviews set name = null where author_id = pid;

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

-- Names already left behind by deletions before today.
update public.reviews set name = null where author_id is null and name is not null;
