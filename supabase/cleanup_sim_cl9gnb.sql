-- One-off: rows the live multi-user run cl9gnb (2026-09-22) could not delete
-- through the app, because delete_my_account() did not yet remove never-listed
-- gyms (fixed in schema81). Identified by id AND by the run's TEST marker, so
-- nothing else can match. Day passes first: day_passes.gym_id is SET NULL.
delete from public.day_passes
 where id in ('19f9a127-4add-4542-9fff-78831a40931b', '3225670a-5b11-4375-ae84-32aea777ea93')
   and gym_id in ('usr-mucl9rbu', 'usr-mucl9rci');
delete from public.gyms
 where id in ('usr-mucl9rbu', 'usr-mucl9rci')
   and owner_id is null
   and name like 'TEST %';
-- gym_checkin_codes cascade with their gym.
select 'left' as k, (select count(*) from public.gyms where id in ('usr-mucl9rbu', 'usr-mucl9rci'))::text || ' gyms, '
       || (select count(*) from public.day_passes where gym_id in ('usr-mucl9rbu', 'usr-mucl9rci'))::text || ' passes, '
       || (select count(*) from public.gym_checkin_codes where gym_id in ('usr-mucl9rbu', 'usr-mucl9rci'))::text || ' codes' as v;
