-- ============================================================================
-- SPOT · schema27_trust_columns.sql
--
-- TRUST. `trainers_insert` and `gyms_insert` were `WITH CHECK (true)`, and the
-- owner UPDATE policies covered every column. Tested on the live database as a
-- normal signed-in account:
--
--   insert into trainers (..., verified, verify_status, rating, clients)
--     values (..., true, 'approved', 5.0, 120)            -> ACCEPTED
--   update trainers set verified = true where owner_id = me -> ACCEPTED
--   insert into gyms (..., verified, claim_status)
--     values (..., true, 'claimed')                        -> ACCEPTED
--
-- So any user could publish themselves as an APPROVED trainer — skipping the
-- whole verification ladder (ID, certificate, gym confirmation) that exists to
-- protect the person hiring them — and hand themselves a 5.0 rating and 120
-- students at the same time. A gym could be created pre-verified and pre-claimed.
--
-- (What already held: the FK stopped a gym owned by somebody else, and RLS
-- stopped taking over an unowned catalogue gym or editing another coach's
-- listing. Those are unchanged.)
--
-- The fix is the one schema18 used on `profiles.status`: RLS cannot restrict
-- columns, so the grants do. Each table keeps exactly the columns its owner
-- legitimately fills in, and the trust/derived columns are withheld from every
-- client. Their real values come from defaults, admin action, and the triggers
-- below.
--
-- Apply AFTER schema26_checkin_visibility.sql, together with the client change
-- that stops writing these columns (becomeTrainer, createGym, publishTrainer,
-- buyDayPass, applyForClaim).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. trainers — a coach may describe themselves, not certify themselves
-- ----------------------------------------------------------------------------
revoke insert, update on public.trainers from anon, authenticated;

grant insert (
  id, name, gym_id, specialty, response_time, price_from, bio,
  certifications, owner_id, photo_url, cert_urls, listed
) on public.trainers to anon, authenticated;

grant update (
  name, gym_id, specialty, response_time, price_from, bio,
  certifications, photo_url, cert_urls, listed
) on public.trainers to anon, authenticated;

-- Withheld: verified, verify_status (the admin's decision), rating (nothing can
-- produce one — see note 4), clients (counted below). `owner_id` is grantable on
-- INSERT only: the FK plus `trainers_update` already stop pointing a row at
-- somebody else, but there is no reason to ever re-own an existing listing.

-- ----------------------------------------------------------------------------
-- 2. gyms — an owner may describe the gym, not verify or claim it
-- ----------------------------------------------------------------------------
revoke insert, update on public.gyms from anon, authenticated;

grant insert (
  id, name, district, price_month, day_pass, hours, amenities, tags, about,
  image_url, photos, lat, lng, location, owner_id, schedule, allow_day_pass, show_members
) on public.gyms to anon, authenticated;

grant update (
  name, district, price_month, day_pass, hours, amenities, tags, about,
  image_url, photos, lat, lng, location, schedule, allow_day_pass, show_members
) on public.gyms to anon, authenticated;

-- Withheld: verified, claim_status, members, trainers, rating, review_count, tons.

-- ----------------------------------------------------------------------------
-- 3. claim_status follows a real claim, not a client's word for it
--
--    `applyForClaim` used to write `claim_status = 'pending'` itself, right after
--    inserting the gym_claims row — "best-effort", and separately revocable. Now
--    the claim row is the single fact and the status is derived from it, so the
--    two can never disagree. Only an admin can move it to `claimed` (that lives
--    in the panel's approve flow, which runs with an admin's rights).
-- ----------------------------------------------------------------------------
create or replace function public.gym_claims_touch_gym()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gym_id is not null and new.status = 'pending' then
    update public.gyms
       set claim_status = 'pending'
     where id = new.gym_id
       and coalesce(claim_status, 'unclaimed') = 'unclaimed';
  end if;
  return new;
end $$;

drop trigger if exists gym_claims_sync_status on public.gym_claims;
create trigger gym_claims_sync_status
  after insert on public.gym_claims
  for each row execute function public.gym_claims_touch_gym();

-- ----------------------------------------------------------------------------
-- 4. `trainers.clients` becomes a count instead of a claim
--
--    A student is an ACCEPTED trainer request — SPOT has no payments, so there is
--    nothing else it could mean. The column was previously writable by the coach
--    and incremented by nothing, exactly like `gyms.trainers` before schema23.
--
--    `trainers.rating` gets no such treatment on purpose: `reviews` has a
--    `gym_id` and no `trainer_id`, so there is no way for a member to rate a
--    coach at all. It stays 0 and is now unwritable, which is what both screens
--    already assume — they print «Yeni müəllim» rather than a zero. Showing a
--    real rating needs trainer reviews to exist first.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_trainer_clients(t text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trainers
     set clients = (select count(*) from public.trainer_requests r
                     where r.trainer_id = t and r.status = 'accepted')
   where id = t;
$$;

create or replace function public.trainer_requests_touch_trainer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_trainer_clients(old.trainer_id);
    return old;
  end if;
  perform public.refresh_trainer_clients(new.trainer_id);
  if tg_op = 'UPDATE' and old.trainer_id is distinct from new.trainer_id then
    perform public.refresh_trainer_clients(old.trainer_id);
  end if;
  return new;
end $$;

drop trigger if exists trainer_requests_sync_clients on public.trainer_requests;
create trigger trainer_requests_sync_clients
  after insert or update or delete on public.trainer_requests
  for each row execute function public.trainer_requests_touch_trainer();

-- One-time correction, and reset any rating that was never earned.
update public.trainers t
   set clients = (select count(*) from public.trainer_requests r
                   where r.trainer_id = t.id and r.status = 'accepted');
update public.trainers set rating = 0 where coalesce(rating, 0) <> 0;

-- ----------------------------------------------------------------------------
-- 5. `verify_status` follows the verification queue
--
--    The client wrote 'pending' itself while also inserting the queue row. With
--    the column withheld, the queue row is what moves the status — so a listing
--    can never advertise «yoxlanılır» without an entry a moderator can see.
-- ----------------------------------------------------------------------------
create or replace function public.trainer_verifications_touch_trainer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trainer_id is null then return new; end if;
  if new.status = 'pending' then
    update public.trainers set verify_status = 'pending'
     where id = new.trainer_id and coalesce(verify_status,'unverified') = 'unverified';
  elsif new.status = 'approved' then
    update public.trainers set verify_status = 'approved', verified = true where id = new.trainer_id;
  elsif new.status = 'rejected' then
    update public.trainers set verify_status = 'rejected', verified = false where id = new.trainer_id;
  end if;
  return new;
end $$;

drop trigger if exists trainer_verifications_sync_trainer on public.trainer_verifications;
create trigger trainer_verifications_sync_trainer
  after insert or update on public.trainer_verifications
  for each row execute function public.trainer_verifications_touch_trainer();

-- ----------------------------------------------------------------------------
-- 6. There is no commission
--
--    `day_passes.commission` defaulted to 0 and `buyDayPass` wrote 0 into it with
--    the comment «SPOT takes no commission — ever». A column that exists is a
--    place for a number to appear later. The product rule is absolute, so the
--    column goes.
-- ----------------------------------------------------------------------------
alter table public.day_passes drop column if exists commission;

comment on column public.day_passes.price is
  'The gym''s own informational price, settled at the gym. SPOT collects nothing and takes no commission — never sum this column into a total for anybody.';
