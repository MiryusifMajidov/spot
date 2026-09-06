-- ============================================================================
-- SPOT · schema53_listing_ownership.sql
--
-- Three doors that were left open, all reachable over REST with the publishable
-- key that ships inside the APK.
--
-- 1. ANYONE CAN CREATE A LISTING IN SOMEBODY ELSE'S NAME.
--    `gyms_insert` and `trainers_insert` are both `WITH CHECK (true)`, and
--    `owner_id` is in the INSERT grant for both — for `anon` as well as
--    `authenticated`. So a request can insert a gym or a trainer listing whose
--    owner is another person's profile id.
--
--    That is worse than vandalism, because schema32 added «one owner, one
--    listing» unique indexes: planting a row on a victim's profile means the
--    victim can never register their own gym or trainer account. A denial of
--    service against a specific person, permanently, from a guest session.
--
-- 2. A NEW TRAINER CAN PUBLISH ITSELF.
--    `listed` is insertable, so a listing appears in Kəşf → Müəllimlər the
--    instant it is written, before anyone has looked at it. schema41 already
--    decided the opposite for gyms.
--
-- 3. ANY ACCOUNT CAN FORGE A «MÜƏLLİM ŞƏRHİ».
--    `community_posts` grants INSERT on `trainer_comment` and `stats`. The feed
--    renders `trainer_comment` as a coach's verdict, with the coach's name and
--    «müəllim» next to it. Anyone could put words in a named trainer's mouth on
--    their own post. (schema47 rewrote this grant list and carried the two
--    columns across — this removes them.)
--
-- Apply AFTER schema52_delete_own_content.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A listing may only be created for yourself
-- ----------------------------------------------------------------------------
drop policy if exists gyms_insert on public.gyms;
create policy gyms_insert on public.gyms
  for insert to authenticated
  with check (
    owner_id = public.my_profile_id()
    and not public.is_sanctioned(auth.uid())
  );

drop policy if exists trainers_insert on public.trainers;
create policy trainers_insert on public.trainers
  for insert to authenticated
  with check (
    owner_id = public.my_profile_id()
    -- A trainer row's id IS its owner's profile id (`becomeTrainer` upserts
    -- `{id: me.id}`), so a row claiming a different id is claiming a different
    -- person's listing.
    and id = public.my_profile_id()::text
    and not public.is_sanctioned(auth.uid())
  );

-- A guest has no profile, so `my_profile_id()` is null and the checks above can
-- never pass. Taking the grant away as well makes that explicit rather than
-- incidental.
revoke insert on public.gyms     from anon;
revoke insert on public.trainers from anon;

-- ----------------------------------------------------------------------------
-- 2. A new trainer listing is not published by its own author
-- ----------------------------------------------------------------------------
revoke insert on public.trainers from authenticated;
grant insert (
  id, name, gym_id, specialty, response_time, price_from, bio,
  certifications, cert_urls, photo_url, owner_id
) on public.trainers to authenticated;

-- Same shape for gyms: `listed` was already withheld, `owner_id` stays (the
-- policy above pins it to the caller).
revoke insert on public.gyms from authenticated;
grant insert (
  id, name, district, price_month, day_pass, hours, amenities, tags,
  about, image_url, photos, lat, lng, location, schedule,
  allow_day_pass, show_members, owner_id
) on public.gyms to authenticated;

alter table public.trainers alter column listed set default false;

-- ----------------------------------------------------------------------------
-- 3. Nobody writes a trainer's words but the app's trainer flow
-- ----------------------------------------------------------------------------
revoke insert on public.community_posts from anon, authenticated;
grant insert (
  id, author, author_id, gym, time_ago, type, body, created_at
) on public.community_posts to authenticated;

-- Anything already planted is removed rather than left on display. Nothing in
-- the app writes `trainer_comment` today, so every non-null value is either a
-- seed or a forgery.
update public.community_posts set trainer_comment = null where trainer_comment is not null;
