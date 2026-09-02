-- ============================================================================
-- SPOT · schema8_photos_location.sql
-- Profile / trainer / gym photos + a real map location for gyms.
-- Apply AFTER schema7_gym_owner.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Photo columns
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;
alter table public.trainers add column if not exists photo_url  text;
alter table public.trainers add column if not exists cert_urls  text[] default '{}';   -- certificate images
alter table public.gyms     add column if not exists photos     text[] default '{}';   -- gallery (image_url stays the cover)

-- ----------------------------------------------------------------------------
-- 2. Gym coordinates the owner picked on the map.
--    `location` (PostGIS geography) already exists and powers `gyms_near`;
--    these two columns make the picked point readable/writable from the client
--    without requiring PostGIS syntax, and a trigger keeps `location` in sync.
-- ----------------------------------------------------------------------------
alter table public.gyms add column if not exists lat double precision;
alter table public.gyms add column if not exists lng double precision;

create or replace function public.sync_gym_location()
returns trigger language plpgsql as $$
begin
  if new.lat is not null and new.lng is not null then
    new.location := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  end if;
  return new;
end $$;

drop trigger if exists gyms_sync_location on public.gyms;
create trigger gyms_sync_location
  before insert or update of lat, lng on public.gyms
  for each row execute function public.sync_gym_location();

-- Backfill lat/lng for gyms that already have a location.
update public.gyms
   set lat = ST_Y(location::geometry), lng = ST_X(location::geometry)
 where location is not null and (lat is null or lng is null);

-- ----------------------------------------------------------------------------
-- 3. Storage buckets (public read, authenticated upload) — same shape as `videos`.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
drop policy if exists "avatars read" on storage.objects;
create policy "avatars read" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "avatars upload" on storage.objects;
create policy "avatars upload" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
drop policy if exists "avatars update" on storage.objects;
create policy "avatars update" on storage.objects for update to authenticated using (bucket_id = 'avatars');

insert into storage.buckets (id, name, public) values ('gyms', 'gyms', true) on conflict (id) do nothing;
drop policy if exists "gyms read" on storage.objects;
create policy "gyms read" on storage.objects for select using (bucket_id = 'gyms');
drop policy if exists "gyms upload" on storage.objects;
create policy "gyms upload" on storage.objects for insert to authenticated with check (bucket_id = 'gyms');
drop policy if exists "gyms update" on storage.objects;
create policy "gyms update" on storage.objects for update to authenticated using (bucket_id = 'gyms');
