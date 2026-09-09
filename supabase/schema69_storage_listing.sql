-- ============================================================================
-- SPOT · schema69_storage_listing.sql
--
-- The three public buckets can be ENUMERATED by anyone holding the publishable
-- key. `videos read`, `avatars read` and `gyms read` are all
-- `USING (bucket_id = '…')` for role `public`, which includes `anon`, and that
-- policy governs the LIST endpoint as well as the authenticated read. So
-- `POST /storage/v1/object/list/videos` returns every filename in the bucket —
-- including objects no `feed_videos` row points at any more, and every avatar
-- ever uploaded.
--
-- That is a different thing from a public bucket serving a known file. A
-- `public = true` bucket answers `GET /object/public/<bucket>/<path>` WITHOUT
-- consulting RLS at all, which is the path the app uses everywhere
-- (`getPublicUrl`) — the feed, avatars and gym photos keep working untouched.
-- What goes away is the ability to ask the bucket what it contains.
--
-- `certs` was already `authenticated` + owner/admin, correctly.
--
-- Apply AFTER schema68_grants_and_policies.sql.
-- ============================================================================

drop policy if exists "videos read" on storage.objects;
create policy "videos read" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos');

drop policy if exists "avatars read" on storage.objects;
create policy "avatars read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "gyms read" on storage.objects;
create policy "gyms read" on storage.objects
  for select to authenticated
  using (bucket_id = 'gyms');

comment on policy "videos read" on storage.objects is
  'Signed-in callers only. Playing a video does not go through here — a public bucket serves /object/public/<path> without consulting RLS — so this governs only LISTING, which nobody outside the app has any reason to do.';
