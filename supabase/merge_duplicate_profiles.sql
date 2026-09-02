-- ============================================================================
-- SPOT · merge_duplicate_profiles.sql
--
-- The same person holds thirteen profiles: five «Yusif» and eight «Sən». Each
-- one is a separate anonymous sign-in — a reinstall mints a new identity and the
-- previous profile becomes unreachable (see `ensureSession` in src/lib/api.ts,
-- now fixed for the silent case). The visible symptom was the Yoldaşlar list
-- offering four copies of the user as training partners.
--
-- They are NOT empty, so this merges rather than deletes. A plain delete would
-- have destroyed real records, because every profile FK is ON DELETE CASCADE:
--
--   yusif   → 1 workout («Push · Sinə və qol · 640 kq · 2 set · Normal», 08-23)
--             1 progress row (a logged body weight, 08-23)
--   yusif2  → 1 workout («Gün 1 · Push · 360 kq · 1 set», 08-31)
--             1 PR («Bench 60 kq», 08-31)
--   san4    → 1 check-in (volt-gym, gym day 2026-08-30)
--
-- Everything above moves onto the live profile. Two rows are dropped instead of
-- moved, because moving them would create nonsense:
--
--   · match_request  yusif_spot → yusif4 : a partner request the user sent to a
--     dead copy of himself. Re-pointing it would make it a request to himself.
--   · trainer_request yusif2 → «Sən/Test» : a request to his own test trainer
--     listing, which is the row directly below.
--
-- The test trainer listing («Sən», specialty «Test», volt-gym, unverified) is
-- the ONLY trainer row in the whole database, and it is `listed = true` — so the
-- Müəllimlər tab was publicly showing a coach called «Sən» whose speciality is
-- «Test». Ownership moves to the live profile so the user can still edit or
-- remove it from inside the app, and it is unlisted: a placeholder name may not
-- be on a public list. Nothing is deleted, so relisting it after filling in real
-- details is one switch.
--
-- The live profile is identified by `last_active_at`, which schema20's
-- `touch_last_active()` stamps on every app launch — the device stamped
-- `yusif_spot` at 2026-09-02 12:17 UTC while this was being prepared. That is
-- evidence, not a guess.
-- ============================================================================

begin;

create temporary table live on commit drop as
select id from public.profiles where username = 'yusif_spot';

create temporary table dead on commit drop as
select p.id as profile_id, p.user_id as auth_id, p.username
  from public.profiles p
 where p.username in ('yusif', 'yusif2', 'yusif3', 'yusif4',
                      'san', 'san2', 'san3', 'san4', 'san5', 'san6', 'san7', 'san8');

do $$
declare n_live int; n_dead int;
begin
  select count(*) into n_live from live;
  select count(*) into n_dead from dead;
  if n_live <> 1 then raise exception 'canlı profil 1 deyil, % tapıldı — dayandırıldı', n_live; end if;
  if n_dead <> 12 then raise exception 'ölü profil 12 deyil, % tapıldı — dayandırıldı', n_dead; end if;
  -- The live profile must never be in the delete set.
  if exists (select 1 from dead d join live l on l.id = d.profile_id) then
    raise exception 'canlı profil silinəcəklər siyahısındadır — dayandırıldı';
  end if;
end $$;

-- ---- 1. drop the two requests that cannot meaningfully move ----------------
delete from public.match_requests
 where from_profile in (select profile_id from dead)
    or to_profile   in (select profile_id from dead);

delete from public.trainer_requests
 where from_profile in (select profile_id from dead);

-- ---- 2. move the real training history onto the live profile ---------------
update public.workouts  set profile_id = (select id from live) where profile_id in (select profile_id from dead);
update public.progress  set profile_id = (select id from live) where profile_id in (select profile_id from dead);
update public.prs       set profile_id = (select id from live) where profile_id in (select profile_id from dead);

-- The one-check-in-per-gym-day unique index (schema19) makes this fail loudly if
-- the live profile already holds that day — which it does not, it has none.
update public.check_ins set profile_id = (select id from live) where profile_id in (select profile_id from dead);

-- ---- 3. the test trainer listing: keep it, own it, stop showing it ---------
update public.trainers
   set owner_id = (select id from live),
       listed   = false
 where owner_id in (select profile_id from dead);

-- ---- 4. anything still pointing at a dead profile stops the merge ----------
do $$
declare n int;
begin
  select
    (select count(*) from public.check_ins        x where x.profile_id   in (select profile_id from dead))
  + (select count(*) from public.comment_likes    x where x.profile_id   in (select profile_id from dead))
  + (select count(*) from public.comments         x where x.author_id    in (select profile_id from dead))
  + (select count(*) from public.match_requests   x where x.from_profile in (select profile_id from dead)
                                                       or x.to_profile  in (select profile_id from dead))
  + (select count(*) from public.progress         x where x.profile_id   in (select profile_id from dead))
  + (select count(*) from public.prs              x where x.profile_id   in (select profile_id from dead))
  + (select count(*) from public.student_programs x where x.student_id   in (select profile_id from dead))
  + (select count(*) from public.trainer_requests x where x.from_profile in (select profile_id from dead))
  + (select count(*) from public.trainers         x where x.owner_id     in (select profile_id from dead))
  + (select count(*) from public.workouts         x where x.profile_id   in (select profile_id from dead))
  into n;
  if n <> 0 then
    raise exception 'CASCADE ilə silinəcək % sətir qaldı — dayandırıldı', n;
  end if;
end $$;
-- (community_posts, feed_videos, gyms, programs and reviews are ON DELETE SET
--  NULL, so they cannot lose a row here; all five are empty for these profiles
--  anyway — the three feed videos already carry a NULL author_id.)

-- ---- 5. remove the shells --------------------------------------------------
delete from public.profiles where id      in (select profile_id from dead);
delete from auth.users     where id       in (select auth_id    from dead);

commit;
