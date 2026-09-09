-- ============================================================================
-- SPOT · schema66_remove_seed_gyms.sql
--
-- SPOT's entire gym catalogue is four businesses a seed script made up.
--
-- `schema.sql:153` inserted Iron Bay, Volt Gym, Atlas Fitness and Peak House
-- with monthly prices, day-pass prices, opening hours, amenity lists, «about»
-- copy and coordinates that nobody supplied. All four still have `owner_id`
-- null and `claim_status` 'unclaimed' — no real business has ever agreed to any
-- of it — and they are not part of the catalogue, they ARE the catalogue:
-- onboarding step 4 «Zalını seç» offers exactly these, Kəşf → Zallar lists
-- exactly these, and the map plots exactly these.
--
-- WHAT IT COSTS A REAL PERSON. Somebody installing SPOT in Baku picks «Iron Bay»
-- because it is the only Nərimanov option. The app then shows them 45 ₼/ay,
-- 5 ₼ günlük and 6:00–24:00 for a business that published none of those numbers;
-- anchors their partner matching to a gym with no members; and measures their
-- check-in distance against 40.4093, 49.8671 — the CENTRE OF THE DISTRICT — so
-- standing inside the real gym they are told it is 1.4 km away and cannot check
-- in at all.
--
-- It is also the last place the app still shows invented figures. schema10,
-- schema15, schema34 and schema60 removed the fabricated trainers, people,
-- participant counts and challenges; the landing page's claims went in the same
-- pass. These four rows outlived all of it because deleting them empties a
-- screen, and an empty screen is uncomfortable in a way a wrong number is not.
--
-- WHAT REPLACES THEM. Nothing, until a real gym registers — which is exactly
-- what the app already says when the list is empty («Hələ zal yoxdur»), and what
-- onboarding already offers («Zalım yoxdur — evdə məşq edirəm»). The solo
-- trainee, who is the core persona, needs no gym at all. The client-side copies
-- in src/data/mock.ts go in the same commit; without that they would simply take
-- over as the offline fallback and nothing would change on screen.
--
-- The dependent rows are test data from this project's own development: one
-- check-in, six day-passes, one profile's home gym and one trainer's gym. They
-- are cleared rather than cascaded blindly, so the deletion is explicit about
-- everything it touches.
--
-- Apply AFTER schema65_admin_metrics.sql.
-- ============================================================================

do $$
declare seeded text[] := array['iron-bay','volt-gym','atlas-fit','peak-house'];
        n int;
begin
  -- A gym somebody has claimed is NOT seed data any more, whatever its id.
  select count(*) into n from public.gyms
   where id = any(seeded) and (owner_id is not null or claim_status = 'claimed');
  if n > 0 then
    raise exception 'REFUSING: % of the seeded gyms now has a real owner — do not delete somebody''s business', n;
  end if;

  -- References that would otherwise block the delete (ON DELETE NO ACTION).
  update public.profiles set home_gym_id = null where home_gym_id = any(seeded);
  update public.trainers  set gym_id      = null where gym_id      = any(seeded);

  -- check_ins, reviews and gym_claims cascade; day_passes set null. Say so out
  -- loud rather than letting the FKs decide silently.
  delete from public.day_passes where gym_id = any(seeded);
  delete from public.gyms where id = any(seeded);
end $$;

comment on table public.gyms is
  'Real gyms only. The four seeded rows (iron-bay, volt-gym, atlas-fit, peak-house) were deleted by schema66: invented prices, hours and amenities under invented business names, with district-centre coordinates that made check-in impossible from inside the real building. A gym enters this table when somebody registers it.';
