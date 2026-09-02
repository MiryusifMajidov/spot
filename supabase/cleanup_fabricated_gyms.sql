-- ============================================================================
-- SPOT · cleanup_fabricated_gyms.sql
--
-- Two gyms sat in the public Kəşf catalogue that no one can visit:
--
--   seed-g-0301528c  «Atlas Fitness Xətai»  Xətai   08:00–24:00  41 ₼/ay
--   seed-g-eb8a6fca  «Titan Gym»            Nəsimi  08:00–24:00  67 ₼/ay
--
-- Both have no coordinates, no description, no tags and no members, so they
-- cannot be checked into (the 150 m gate refuses without coordinates) and never
-- appear on the map. «Atlas Fitness Xətai» also duplicates the catalogue's real
-- «Atlas Fitness», which is likewise in Xətai.
--
-- What settles it: each carries a `gym_claims` row created at 2026-08-31 10:36 —
-- the same minute as the eleven fabricated profiles — with an invented VÖEN and
-- a `https://example.com/...` selfie link, and no claimant at all. They are the
-- same script's output. A sweep of every `created_at` table confirms these two
-- claims are the last rows left from that window.
--
-- The claims are the worse half: they sat in the moderator's queue as pending
-- business verifications, with paperwork that leads to a dead domain.
--
-- Verified before deleting: no check-in, review, trainer, day pass, member or
-- saved bookmark points at either gym.
-- ============================================================================

begin;

create temporary table fake_gyms on commit drop as
select id from public.gyms where id in ('seed-g-0301528c', 'seed-g-eb8a6fca');

do $$
declare n int;
begin
  select count(*) into n from fake_gyms;
  if n <> 2 then raise exception 'gözlənilən 2 zal əvəzinə % tapıldı — dayandırıldı', n; end if;

  -- Nothing real may be attached. If anything is, stop and look rather than delete.
  select
    (select count(*) from public.profiles   p where p.home_gym_id in (select id from fake_gyms))
  + (select count(*) from public.check_ins  c where c.gym_id      in (select id from fake_gyms))
  + (select count(*) from public.reviews    r where r.gym_id      in (select id from fake_gyms))
  + (select count(*) from public.trainers   t where t.gym_id      in (select id from fake_gyms))
  + (select count(*) from public.day_passes d where d.gym_id      in (select id from fake_gyms))
  into n;
  if n <> 0 then
    raise exception 'bu zallara bağlı % real sətir var — dayandırıldı', n;
  end if;
end $$;

delete from public.gym_claims where gym_id in (select id from fake_gyms);
delete from public.gyms       where id     in (select id from fake_gyms);

commit;
