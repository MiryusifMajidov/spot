-- data01 (25.09.2026): take the three TEST coach listings out of Kəşf → Müəllimlər.
--
-- They were the only public content an App Review or Play reviewer could see:
-- specialities written literally as «Test», «Test1» and «Funksional guc test»,
-- two of them carrying the blue verified badge with every document column NULL.
-- Apple 2.1 rejects placeholder content, and it is the first screen a reviewer
-- reaches in guest mode.
--
-- UNLISTED, NOT DELETED, and that is deliberate: two of the three rows belong to
-- other people (@miri, @yghh), not to the owner. `listed = false` is exactly what
-- the coach's own «Kəşfdə görün» switch writes, so nobody loses a listing they
-- can not put back — they flip the switch in the app and it returns.
--
-- Written as a statement about the DATA, not the schema, so it is a one-off:
-- re-running it is harmless (already-unlisted rows do not match).
update public.trainers
   set listed = false
 where listed = true
   and specialty ilike '%test%';

select count(*) as still_listed_with_test_in_specialty
  from public.trainers where listed = true and specialty ilike '%test%';
select count(*) as trainers_listed_total from public.trainers where listed = true;
