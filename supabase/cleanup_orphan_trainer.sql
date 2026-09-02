-- ============================================================================
-- SPOT · cleanup_orphan_trainer.sql
--
-- `merge_duplicate_profiles.sql` moved the «Sən · Test» trainer listing onto the
-- live profile so it would not be destroyed by the CASCADE. That was right for
-- the data and wrong for the shape: a trainer row's `id` IS the owner's profile
-- id (see `becomeTrainer`, which upserts `{ id: me.id, owner_id: me.id }`), and
-- this row kept `391f765e…` — the id of the deleted `san4` profile.
--
-- When the app later published a proper listing, the account ended up owning TWO
-- trainer rows. `getMyTrainerId()` used `.maybeSingle()`, which errors on two
-- rows, so the whole trainer panel showed «Yüklənmədi — şagird siyahısını
-- gətirmək alınmadı» with the network perfectly healthy.
--
-- The orphan goes. Verified before deleting: it is unlisted, unverified, and has
-- no requests, no assigned programs and no verification row — everything real
-- belongs to `27a5ab55…`, whose id does match the profile.
--
-- `getMyTrainerId()` is also made deterministic in the same change, the way
-- `getMyGymId()` already is, so a duplicate can never brick the panel again.
-- ============================================================================

begin;

create temporary table orphan on commit drop as
select t.id
  from public.trainers t
 where t.owner_id is not null
   and not exists (select 1 from public.profiles p where p.id::text = t.id);

do $$
declare n int;
begin
  select count(*) into n from orphan;
  if n <> 1 then
    raise exception 'gözlənilən 1 sahibsiz elan əvəzinə % tapıldı — dayandırıldı', n;
  end if;
  select count(*) into n
    from public.trainer_requests r where r.trainer_id in (select id from orphan);
  if n <> 0 then raise exception 'bu elana bağlı % sorğu var — dayandırıldı', n; end if;
  select count(*) into n
    from public.student_programs s where s.trainer_id in (select id from orphan);
  if n <> 0 then raise exception 'bu elana bağlı % proqram var — dayandırıldı', n; end if;
end $$;

delete from public.trainer_verifications where trainer_id in (select id from orphan);
delete from public.trainers where id in (select id from orphan);

commit;
