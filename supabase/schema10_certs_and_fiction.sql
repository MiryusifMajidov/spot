-- ============================================================================
-- SPOT · schema10_certs_and_fiction.sql
--
-- Two things the four-role audit turned up that only the database can fix.
-- Apply AFTER schema9_found_gaps.sql.
--
-- Verified against the live database before writing this file:
--   · storage holds 3 objects, all in `videos`; NO certificate has been
--     uploaded yet, so moving certificates to a private bucket loses nothing.
--   · public.trainers holds 3 owner-less rows (elvin-m, nigar-a, rauf-q) with
--     invented ratings (4.9 / 4.8 / 4.5) and client counts (38 / 44 / 12);
--     two of them carry verified = true.
--   · all 4 seeded programs carry invented social proof (rating 4.6–4.9,
--     done_by up to 1240, video_count up to 28 while ZERO videos exist) and are
--     attributed to those non-existent, "verified" trainers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trainer certificates belong in a PRIVATE bucket
--
--    src/lib/images.ts addTrainerCert uploaded certificates — identity and
--    qualification documents — into the PUBLIC `avatars` bucket, while
--    src/app/trainer/verify.tsx promises the trainer that only SPOT sees them.
--    A public bucket means anyone holding the URL can read the document.
--
--    Reading now requires a signed URL, which is exactly the point: only the
--    uploader and an admin can mint one.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('certs', 'certs', false)
on conflict (id) do nothing;

drop policy if exists "certs upload" on storage.objects;
create policy "certs upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'certs');

-- storage.objects.owner is set to auth.uid() on insert, so this scopes reads to
-- the trainer who uploaded the document — plus admins, who must review it.
drop policy if exists "certs read" on storage.objects;
create policy "certs read" on storage.objects
  for select to authenticated
  using (bucket_id = 'certs' and (owner = auth.uid() or public.is_admin(auth.uid())));

drop policy if exists "certs update" on storage.objects;
create policy "certs update" on storage.objects
  for update to authenticated
  using (bucket_id = 'certs' and owner = auth.uid())
  with check (bucket_id = 'certs' and owner = auth.uid());

-- Deliberately no public read policy, and no delete policy: a submitted
-- verification document must not vanish while a decision is pending.

-- ----------------------------------------------------------------------------
-- 2. Remove the fabricated trainers
--
--    schema2.sql seeded three people who do not exist. The app listed them
--    under Kəşf → Müəllimlər with blue verification badges, invented ratings
--    and client counts, and let a real user send them a training request that
--    no one could ever receive (they have no owner_id).
--
--    The client no longer merges seed trainers, but the rows must go too — a
--    device with Supabase configured reads them straight from here.
-- ----------------------------------------------------------------------------
-- Every FK to trainers is ON DELETE CASCADE (verified), so trainer_requests,
-- student_programs and trainer_verifications go with them. Listed explicitly
-- anyway so the intent is readable.
delete from public.trainer_requests where trainer_id in ('elvin-m', 'nigar-a', 'rauf-q');
delete from public.student_programs  where trainer_id in ('elvin-m', 'nigar-a', 'rauf-q');
delete from public.trainers          where id         in ('elvin-m', 'nigar-a', 'rauf-q');

-- ----------------------------------------------------------------------------
-- 2b. Remove the fabricated feed
--
--    feed_videos v1/v2/v3 and community_posts c1/c2 were seeded with invented
--    engagement (2418 likes / 184 comments), authorship credited to the three
--    people deleted above — two of them flagged verified = true — and invented
--    results («-6 kq», «46 məşq») plus a coaching reply signed with a trainer's
--    name. Their video_url is NULL, so the client substituted a Big Buck Bunny
--    cartoon under a caption presenting it as deadlift technique.
--
--    The three genuine uploads (id like 'uv-%', 0 likes, real storage URLs) are
--    left completely alone.
-- ----------------------------------------------------------------------------
delete from public.feed_videos where id in ('v1', 'v2', 'v3');

--    community_posts.id is a **uuid with a default**, not the text 'c1'/'c2' —
--    so schema2's `on conflict (id) do nothing` never matched and re-running it
--    inserted the same two fabricated posts three times over (6 rows).
--
--    They are identified by what only a seed can be: the app's one and only
--    writer, createCommunityPost (src/lib/api.ts:264), always inserts
--    `likes: 0, comments: 0, type: 'text'`. There is no code path anywhere that
--    produces a non-zero engagement count or a 'progress' post, so this predicate
--    cannot reach a real user's post — now or in the future. The genuine post in
--    this table (author «Sən», 0 likes) is left untouched.
delete from public.community_posts
 where likes > 0
    or comments > 0
    or type = 'progress';

-- ----------------------------------------------------------------------------
-- 3. Strip the invented social proof from the starter programs
--
--    The four seeded programs are genuinely useful training plans, so they
--    stay — but nothing about them was measured. A rating nobody gave, a
--    "1240 nəfər edir" nobody did, and a video count of 28 when the app
--    contains zero exercise videos are all fabrications.
--
--    Authorship is corrected rather than deleted: SPOT wrote these starter
--    plans, so SPOT is named. Attributing them to a "verified" trainer who
--    does not exist was the dishonest part.
-- ----------------------------------------------------------------------------
update public.programs
   set rating           = 0,
       video_count      = 0,
       done_by          = 0,
       saves            = 0,
       creator_name     = 'SPOT',
       creator_type     = 'spot',
       creator_verified = false
 where id in ('ppl-strength', 'home-basics', 'fat-loss-8', 'strength-5x5');

-- Genuine plan properties (weeks, days_per_week, minutes, level, goal, tags)
-- are deliberately left untouched — those describe the plan, they are not
-- claims about other people's behaviour.

-- ----------------------------------------------------------------------------
-- 4. Any gym still carrying a seeded occupancy figure
--    `members` / `tons` were seeded as marketing numbers, not measured. The
--    client stops rendering an unmeasured live count, but a stale figure here
--    would still reach the gym cards.
-- ----------------------------------------------------------------------------
update public.gyms
   set members = 0,
       tons    = 0
 where owner_id is null;   -- seeded catalogue rows only; a real owner's gym is left alone

-- ----------------------------------------------------------------------------
-- 5. A REAL cross-gym tonnage ranking
--
--    `gyms.tons` is written by nothing, anywhere — so the gym leaderboard was
--    fiction on both sides: the seeded fallback in src/data/challenges.ts AND
--    the seeded column read by useGymRanking. Item 4 above zeroes the column;
--    this gives the screen something true to show instead.
--
--    It has to be a function, not a client query: `workouts` is owner-scoped by
--    RLS (the privacy red line — nobody may read another person's workouts), so
--    no client can sum across a gym. SECURITY DEFINER lets the aggregate run,
--    and the function returns ONLY totals — never a row, a name, a weight or a
--    session belonging to an identifiable person. A gym with fewer than 3
--    members is withheld entirely, so a total can never be attributed to one
--    individual.
-- ----------------------------------------------------------------------------
create or replace function public.gym_tonnage_ranking()
returns table (gym_id text, gym_name text, members bigint, tons numeric, per_member numeric)
language sql
stable
security definer
set search_path = public
as $$
  select g.id,
         g.name,
         count(distinct p.id)                                          as members,
         round((coalesce(sum(w.volume_kg), 0) / 1000.0)::numeric, 1)   as tons,
         round((coalesce(sum(w.volume_kg), 0) / greatest(count(distinct p.id), 1))::numeric, 0) as per_member
    from public.gyms g
    join public.profiles p on p.home_gym_id = g.id
    left join public.workouts w on w.profile_id = p.id
   group by g.id, g.name
  having count(distinct p.id) >= 3
   order by per_member desc
$$;

revoke all on function public.gym_tonnage_ranking() from public;
grant execute on function public.gym_tonnage_ranking() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. match_requests could be created and read, but never answered
--
--    Confirmed live: the table has ONLY `match_insert` and `match_read`. With no
--    UPDATE policy, accepting or declining a partner request changes zero rows —
--    the matching loop, which is the core of the whole product, cannot complete
--    on the server. With no DELETE policy, «Geri götür» can never withdraw an
--    offer, so the screen's promise that the other person will no longer see it
--    was impossible to keep.
--
--    Who may do what:
--      · the RECIPIENT answers (accept / decline) — and may only ever move a
--        request out of 'pending', never resurrect a decided one;
--      · the SENDER withdraws, and only while it is still pending — once the
--        other person has answered, the answer stands.
-- ----------------------------------------------------------------------------
drop policy if exists match_update on public.match_requests;
create policy match_update on public.match_requests
  for update to authenticated
  using (
    status = 'pending'
    and to_profile in (select p.id from public.profiles p where p.user_id = auth.uid())
  )
  with check (
    to_profile in (select p.id from public.profiles p where p.user_id = auth.uid())
  );

drop policy if exists match_delete on public.match_requests;
create policy match_delete on public.match_requests
  for delete to authenticated
  using (
    status = 'pending'
    and from_profile in (select p.id from public.profiles p where p.user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 7. A closed trainer account stayed publicly listed
--
--    Closing the trainer account left the listing live in Kəşf → Müəllimlər,
--    still collecting requests nobody would answer. `trainers` has no DELETE
--    policy (deliberately — a listing must not vanish while a verification or a
--    student relationship references it), and verify_status cannot stand in: its
--    CHECK allows only unverified/pending/approved/rejected.
--
--    So: an explicit flag. Existing rows default to listed, and the client
--    filters on it.
-- ----------------------------------------------------------------------------
alter table public.trainers add column if not exists listed boolean not null default true;

-- No new policy is needed: `trainers_update` already scopes UPDATE to
-- `owner_id in (select id from profiles where user_id = auth.uid())`, which is
-- exactly the owner unlisting their own row (verified against pg_policies).
