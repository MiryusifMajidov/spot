-- ============================================================================
-- SPOT · schema33_storage_ownership.sql
--
-- The three public buckets let ANY signed-in account overwrite ANY file:
--
--   «avatars update»  USING (bucket_id = 'avatars')   -- no owner, no WITH CHECK
--   «gyms update»     USING (bucket_id = 'gyms')
--   «videos update»   USING (bucket_id = 'videos')
--
-- and every upload runs with `upsert: true`. The paths are not secret either —
-- `feed_videos.video_url` is a public URL with the object path in it, so the
-- target is simply readable from the feed.
--
-- So the attack is: read someone's video URL, upsert your own bytes at that
-- path. The row keeps their name, their caption and their author_id — all the
-- work schema29 did to make content attributable — while the thing people watch
-- is yours. Same for a member's profile photo and a gym's cover.
--
-- (`certs` was already correct: SELECT is `owner = auth.uid() OR is_admin`,
--  UPDATE is owner-only. The verification screen's promise — «Sənədlər qapalı
--  saxlancdadır — yalnız SPOT komandası yoxlayır» — holds. It is the model the
--  other three now follow.)
--
-- Nothing legitimate breaks: every upload path already carries a timestamp
-- (`${prefix}-${Date.now().toString(36)}.jpg`, `uv-${…}.mp4`), so real uploads
-- are always new objects and never hit the UPDATE path at all.
--
-- Also adds what the buckets never had: a size cap and a MIME allowlist. Without
-- them any file type could be placed in a PUBLIC bucket and served from the
-- project's own domain — an HTML file there is a phishing page hosted by SPOT.
--
-- Apply AFTER schema32_one_listing_per_owner.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. You may only overwrite your own object
--
--    `storage.objects.owner` is stamped by Storage from the caller's JWT on
--    insert, so it is not something a client can set for somebody else.
-- ----------------------------------------------------------------------------
drop policy if exists "avatars update" on storage.objects;
create policy "avatars update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and owner = auth.uid())
  with check (bucket_id = 'avatars' and owner = auth.uid());

drop policy if exists "gyms update" on storage.objects;
create policy "gyms update" on storage.objects
  for update to authenticated
  using (bucket_id = 'gyms' and owner = auth.uid())
  with check (bucket_id = 'gyms' and owner = auth.uid());

drop policy if exists "videos update" on storage.objects;
create policy "videos update" on storage.objects
  for update to authenticated
  using (bucket_id = 'videos' and owner = auth.uid())
  with check (bucket_id = 'videos' and owner = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. You may delete your own object
--
--    There was no DELETE policy at all, so a removed certificate or a replaced
--    avatar stayed in the bucket forever with no way to take it out — including
--    for the person who uploaded it. Scoped to the owner, never wider.
-- ----------------------------------------------------------------------------
drop policy if exists "own object delete" on storage.objects;
create policy "own object delete" on storage.objects
  for delete to authenticated
  using (bucket_id in ('avatars','gyms','videos','certs') and owner = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Size caps and MIME allowlists
--
--    The client uploads jpeg/png/webp images and mp4 video; certificates are
--    photographed or exported as PDF. Anything else has no business here, and a
--    public bucket that accepts text/html is a page-hosting service.
-- ----------------------------------------------------------------------------
update storage.buckets set
  file_size_limit = 5 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'avatars';

update storage.buckets set
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'gyms';

update storage.buckets set
  file_size_limit = 100 * 1024 * 1024,
  allowed_mime_types = array['video/mp4','video/quicktime']
 where id = 'videos';

update storage.buckets set
  file_size_limit = 10 * 1024 * 1024,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'certs';
