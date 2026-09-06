-- ============================================================================
-- SPOT · merge_orphan_content.sql
--
-- A gap in `merge_duplicate_profiles.sql`, found while wiring the save counts.
--
-- That script merged thirteen anonymous profiles belonging to one person into
-- `yusif_spot`, moving their workouts, PRs, check-ins and trainer listing. It
-- did not list `feed_videos` or `community_posts`, so the content those sessions
-- created was left with `author_id = null` while the accounts that made it were
-- deleted. The consequences are real and visible:
--
--   · the feed credits every one of them to «SPOT istifadəçisi»
--   · the author cannot delete or hide their own video (schema13's owner policy
--     matches on author_id)
--   · `video_save_count` returns null forever, so the author can never see the
--     number the app is now built to show them
--
-- WHAT THE EVIDENCE IS, AND WHAT IT IS NOT.
-- `storage.objects` still records who uploaded each file, and the three uploader
-- uids no longer exist in `auth.users` — they were deleted by the merge, which
-- had already established, from `last_active_at`, that all those sessions were
-- this one person. Exactly one profile now exists in the database. So this is
-- the merge finishing its own job on two tables it forgot, not a new claim about
-- who wrote what.
--
-- It is still an inference, so it is deliberately narrow: only rows with NO
-- author are touched, only while exactly one profile exists, and only when their
-- uploader is one of the deleted accounts. If a second person ever signs up
-- before this runs, the guard aborts rather than handing them the wrong author.
-- ============================================================================

begin;

do $$
declare live uuid; n_profiles int; n_v int; n_p int;
begin
  select count(*) into n_profiles from public.profiles;
  if n_profiles <> 1 then
    raise exception 'bazada % profil var — sahiblik təyin etmək üçün dayandırıldı', n_profiles;
  end if;
  select id into live from public.profiles;

  -- Videos: only those whose stored file was uploaded by an account that no
  -- longer exists (i.e. one the merge deleted).
  update public.feed_videos v
     set author_id = live
   where v.author_id is null
     and exists (
       select 1 from storage.objects o
        where o.bucket_id = 'videos'
          and o.name = v.id || '.mp4'
          and o.owner is not null
          and not exists (select 1 from auth.users u where u.id = o.owner)
     );
  get diagnostics n_v = row_count;

  -- Posts carry no file, so there is no uploader record to lean on. With a
  -- single profile in the database there is no other candidate, and the same
  -- guard above already refuses to run once a second person exists.
  update public.community_posts set author_id = live where author_id is null;
  get diagnostics n_p = row_count;

  raise notice 'video: %, post: %', n_v, n_p;
end $$;

-- The display name and badge now follow from the profile (schema47). Realign
-- the rows this just gave an author to, so the feed stops saying
-- «SPOT istifadəçisi» over content that has one.
update public.feed_videos v
   set author     = coalesce(nullif(btrim(p.name), ''), v.author),
       is_trainer = (p.role = 'trainer'),
       verified   = coalesce((select t.verified from public.trainers t where t.id = v.author_id::text), false)
  from public.profiles p
 where p.id = v.author_id;

update public.community_posts c
   set author = coalesce(nullif(btrim(p.name), ''), c.author)
  from public.profiles p
 where p.id = c.author_id;

commit;
