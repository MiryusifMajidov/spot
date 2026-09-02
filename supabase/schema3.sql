-- =====================================================================
-- SPOT — schema part 3: account roles + user-created trainers/gyms/programs
-- Run this in the Supabase SQL Editor (one paste). Safe to re-run.
-- =====================================================================

-- 1) Role + trainer fields on the user's own profile (profiles is owner-RLS,
--    so the app can set these via updateMyProfile without new policies).
alter table public.profiles add column if not exists role text default 'user';        -- 'user' | 'trainer'
alter table public.profiles add column if not exists specialty text;
alter table public.profiles add column if not exists price_from int;

-- 2) Ownership columns so a user can create & manage their own listings.
alter table public.trainers add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.gyms     add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.programs add column if not exists owner_id uuid references public.profiles(id) on delete set null;

-- 3) RLS: allow authenticated users to create listings, and update only their own.
--    (Read stays public via the existing *_read policies.)
drop policy if exists trainers_insert on public.trainers;
create policy trainers_insert on public.trainers for insert to authenticated with check (true);
drop policy if exists trainers_update on public.trainers;
create policy trainers_update on public.trainers for update to authenticated
  using (owner_id in (select id from public.profiles where user_id = auth.uid()))
  with check (owner_id in (select id from public.profiles where user_id = auth.uid()));

drop policy if exists gyms_insert on public.gyms;
create policy gyms_insert on public.gyms for insert to authenticated with check (true);
drop policy if exists gyms_update on public.gyms;
create policy gyms_update on public.gyms for update to authenticated
  using (owner_id in (select id from public.profiles where user_id = auth.uid()))
  with check (owner_id in (select id from public.profiles where user_id = auth.uid()));

-- programs already has programs_insert (authenticated). Add owner-scoped update.
drop policy if exists programs_update on public.programs;
create policy programs_update on public.programs for update to authenticated
  using (owner_id in (select id from public.profiles where user_id = auth.uid()))
  with check (owner_id in (select id from public.profiles where user_id = auth.uid()));

-- 4) Storage bucket for user-uploaded feed videos (public read, authenticated upload).
insert into storage.buckets (id, name, public) values ('videos', 'videos', true) on conflict (id) do nothing;
drop policy if exists "videos read" on storage.objects;
create policy "videos read" on storage.objects for select using (bucket_id = 'videos');
drop policy if exists "videos upload" on storage.objects;
create policy "videos upload" on storage.objects for insert to authenticated with check (bucket_id = 'videos');
