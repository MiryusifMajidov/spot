-- =====================================================================
-- SPOT — vertical slice schema (gyms · profiles · check-ins · matches)
-- Run this in the Supabase dashboard → SQL Editor → New query → Run.
-- Safe to re-run (idempotent).
-- =====================================================================

create extension if not exists postgis;

-- ---------------------------------------------------------------------
-- GYMS
-- ---------------------------------------------------------------------
create table if not exists public.gyms (
  id            text primary key,
  name          text not null,
  verified      boolean default false,
  district      text,
  location      geography(Point, 4326),
  price_month   int,
  day_pass      int,
  hours         text,
  members       int default 0,
  trainers      int default 0,
  rating        numeric(2,1) default 0,
  review_count  int default 0,
  amenities     text[] default '{}',
  tags          text[] default '{}',
  about         text,
  image_url     text
);

-- ---------------------------------------------------------------------
-- PROFILES  (a "person"; real users link via user_id, seeds leave it null)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique references auth.users(id) on delete cascade,
  name             text,
  gender           text,
  age              int,
  home_gym_id      text references public.gyms(id),
  level            text,
  goals            text[] default '{}',
  types            text[] default '{}',
  time_slot        text,
  bio              text,
  visibility       text default 'match-only',
  show_in_gym_list boolean default true,
  created_at       timestamptz default now()
);

-- ---------------------------------------------------------------------
-- CHECK-INS  (drives "who is at the gym now")
-- ---------------------------------------------------------------------
create table if not exists public.check_ins (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  gym_id      text not null references public.gyms(id) on delete cascade,
  created_at  timestamptz default now(),
  expires_at  timestamptz default now() + interval '2 hours'
);
create index if not exists check_ins_gym_active_idx on public.check_ins (gym_id, expires_at);

-- ---------------------------------------------------------------------
-- MATCH REQUESTS
-- ---------------------------------------------------------------------
create table if not exists public.match_requests (
  id           uuid primary key default gen_random_uuid(),
  from_profile uuid not null references public.profiles(id) on delete cascade,
  to_profile   uuid not null references public.profiles(id) on delete cascade,
  status       text default 'pending',   -- pending | accepted | declined
  created_at   timestamptz default now()
);

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.gyms           enable row level security;
alter table public.profiles       enable row level security;
alter table public.check_ins      enable row level security;
alter table public.match_requests enable row level security;

-- Gyms: public read
drop policy if exists gyms_read on public.gyms;
create policy gyms_read on public.gyms for select using (true);

-- Profiles: any authenticated user can read (needed for matching); write only your own
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Check-ins: authenticated read; write only rows tied to your own profile
drop policy if exists check_ins_read on public.check_ins;
create policy check_ins_read on public.check_ins for select to authenticated using (true);

drop policy if exists check_ins_write on public.check_ins;
create policy check_ins_write on public.check_ins for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = auth.uid()))
  with check (profile_id in (select id from public.profiles where user_id = auth.uid()));

-- Match requests: see the ones you sent or received; create only as sender
drop policy if exists match_read on public.match_requests;
create policy match_read on public.match_requests for select to authenticated
  using (
    from_profile in (select id from public.profiles where user_id = auth.uid())
    or to_profile in (select id from public.profiles where user_id = auth.uid())
  );

drop policy if exists match_insert on public.match_requests;
create policy match_insert on public.match_requests for insert to authenticated
  with check (from_profile in (select id from public.profiles where user_id = auth.uid()));

-- =====================================================================
-- Geo RPC: gyms near a point, ordered by distance
-- =====================================================================
create or replace function public.gyms_near(lat double precision, lng double precision)
returns table (gym public.gyms, distance_km double precision)
language sql stable as $$
  select g as gym,
         ST_Distance(g.location, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) / 1000.0 as distance_km
  from public.gyms g
  order by g.location <-> ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography;
$$;

-- =====================================================================
-- Auto-create a profile row when a new auth user signs up
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', 'Sən'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- SEED DATA
-- =====================================================================
insert into public.gyms (id, name, verified, district, location, price_month, day_pass, hours, members, trainers, rating, review_count, amenities, tags, about) values
  ('iron-bay','Iron Bay',   true,  'Nərimanov', ST_SetSRID(ST_MakePoint(49.8671,40.4093),4326), 45, 5, '6:00–24:00', 214, 9, 4.8, 132, '{"Sərbəst ağırlıq","Duş","Park","Sauna","Kardio zonası","Wi-Fi"}', '{"Sərbəst ağırlıq","Duş","Park","9 müəllim"}', 'Nərimanovda sərbəst ağırlıq üzərində qurulmuş güc zalı. Geniş kardio zonası, təmiz duş və park daxil.'),
  ('volt-gym','Volt Gym',   false, 'Yasamal',   ST_SetSRID(ST_MakePoint(49.8210,40.3777),4326), 60, 7, '24 saat',    340, 14,4.6, 98,  '{"24 saat","Duş","Kardio zonası","Qrup dərsləri"}', '{"24 saat","Kardio","14 müəllim"}', '24 saat açıq, müasir avadanlıqlı şəhər zalı.'),
  ('atlas-fit','Atlas Fitness',true,'Xətai',    ST_SetSRID(ST_MakePoint(49.8890,40.3810),4326), 50, 6, '7:00–23:00', 180, 7, 4.7, 74,  '{"Sərbəst ağırlıq","Basseyn","Sauna","Duş"}', '{"Basseyn","Sauna","7 müəllim"}', 'Basseyn və sauna daxil tam kompleks.'),
  ('peak-house','Peak House',false, 'Nəsimi',    ST_SetSRID(ST_MakePoint(49.8520,40.3950),4326), 40, 4, '8:00–22:00', 120, 5, 4.4, 41,  '{"Funksional","CrossFit","Duş"}', '{"Funksional","CrossFit","5 müəllim"}', 'Funksional və CrossFit yönümlü butik zal.')
on conflict (id) do nothing;

-- Seed people (no auth user) so "who's here" and matching look alive
insert into public.profiles (id, name, gender, age, home_gym_id, level, goals, types, time_slot, bio) values
  ('11111111-1111-1111-1111-111111111111','Kamran','kişi',26,'iron-bay','Orta','{"Kütlə yığmaq","Güc"}','{"Sərbəst ağırlıq","Powerlifting"}','Axşam 17–21','Push/pull/legs edirəm, ölü qaldırmada spot axtarıram.'),
  ('22222222-2222-2222-2222-222222222222','Tural','kişi',29,'iron-bay','İrəli','{"Güc"}','{"Powerlifting"}','Axşam 17–21','Güc üzərində işləyirəm.'),
  ('33333333-3333-3333-3333-333333333333','Aysel','qadın',24,'iron-bay','Orta','{"Forma saxlamaq"}','{"Funksional","Kardio"}','Səhər 6–9','Səhər məşqlərini sevirəm.'),
  ('44444444-4444-4444-4444-444444444444','Orxan','kişi',31,'iron-bay','Başlanğıc','{"Arıqlamaq"}','{"Kardio","Funksional"}','Axşam 17–21','Yeni başlamışam.'),
  ('55555555-5555-5555-5555-555555555555','Nigar','qadın',27,'volt-gym','Orta','{"Arıqlamaq"}','{"Funksional"}','Gündüz 9–17','Funksional məşqlər.')
on conflict (id) do nothing;

-- Active check-ins at Iron Bay (visible as "here now")
insert into public.check_ins (profile_id, gym_id, expires_at)
select p.id, 'iron-bay', now() + interval '2 hours'
from public.profiles p
where p.id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
)
and not exists (
  select 1 from public.check_ins c
  where c.profile_id = p.id and c.gym_id = 'iron-bay' and c.expires_at > now()
);
