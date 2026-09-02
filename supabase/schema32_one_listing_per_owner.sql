-- ============================================================================
-- SPOT · schema32_one_listing_per_owner.sql
--
-- «One profile = one gym» and «one profile = one trainer listing» are real rules
-- — `createGym` refuses a second gym with `gym-exists`, and `becomeTrainer`
-- upserts on `id = me.id` — but neither was enforced anywhere except in the
-- client. A second row is not a cosmetic problem: it is what breaks the panels.
--
-- It already happened, twice over:
--
--   · `getMyGymId()` carries a comment about a profile that ended up owning two
--     gyms, where `.maybeSingle()` returned PGRST116 and the discarded error was
--     rendered as «Bu hesaba bağlı zal yoxdur» — the panel dead forever.
--   · today, a profile merge left a second TRAINER row and `getMyTrainerId()`
--     hit exactly the same error, so the whole trainer account showed
--     «Yüklənmədi» on a healthy network.
--
-- Both read paths are now written to survive duplicates. This stops them being
-- created at all, which is the part the client cannot guarantee — its check is a
-- read followed by a write, and two devices (or one retry after a lost response)
-- race straight through it.
--
-- Apply AFTER schema31_review_edit_rights.sql.
-- ============================================================================

do $$
declare n int;
begin
  select count(*) into n from (
    select owner_id from public.gyms where owner_id is not null
     group by owner_id having count(*) > 1) d;
  if n > 0 then raise exception '% profil birdən çox zala sahibdir — əvvəlcə onlara bax', n; end if;

  select count(*) into n from (
    select owner_id from public.trainers where owner_id is not null
     group by owner_id having count(*) > 1) d;
  if n > 0 then raise exception '% profil birdən çox müəllim elanına sahibdir — əvvəlcə onlara bax', n; end if;
end $$;

create unique index if not exists gyms_one_per_owner
  on public.gyms (owner_id) where owner_id is not null;

create unique index if not exists trainers_one_per_owner
  on public.trainers (owner_id) where owner_id is not null;
