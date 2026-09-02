-- ============================================================================
-- SPOT · schema9_found_gaps.sql
--
-- Gaps found by running supabase/verify_schema.sql against the LIVE database
-- (506 checks) and by auditing what the client + admin panel actually require.
-- Every item below was CONFIRMED against the live schema, not inferred:
-- the FK targets came from pg_constraint and the policies from pg_policies.
--
-- None of these is created by schema1–8. Each one is a feature that silently
-- does nothing today, because almost every read/write in the app swallows its
-- error and keeps showing seed data — so a missing column or policy looks
-- exactly like "no data yet".
--
-- Apply AFTER schema8_photos_location.sql.
-- Additive only: no DROP TABLE, no data loss.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. programs.description
--    src/app/(tabs)/workout/create.tsx inserts `description`. No migration ever
--    created the column, so the insert failed and the screen fell back to a row
--    without it — the program saved, the description the user typed was thrown
--    away, and the toast still said "created".
-- ----------------------------------------------------------------------------
alter table public.programs add column if not exists description text;

-- ----------------------------------------------------------------------------
-- 2. challenges: admins can read but not write
--    RLS is ON (schema2) with only `challenges_read` (SELECT) — confirmed live.
--    The admin panel creates challenges (web/admin/src/screens/Challenges.tsx:137)
--    and toggles `active` (:114); both are refused today, and the panel's
--    optimistic local state makes the toggle *look* like it worked.
--    `is_admin()` comes from schema4_admin.sql.
-- ----------------------------------------------------------------------------
drop policy if exists challenges_admin_insert on public.challenges;
create policy challenges_admin_insert on public.challenges
  for insert to authenticated
  with check (public.is_admin(auth.uid()));

drop policy if exists challenges_admin_update on public.challenges;
create policy challenges_admin_update on public.challenges
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Deliberately NO delete policy: challenges are retired by setting active=false,
-- so participation history is never destroyed from the panel.

-- ----------------------------------------------------------------------------
-- 3. day_passes: a gym owner cannot read their own gym's passes
--    Live SELECT policy is only `dp_user_read` — (auth.uid() = user_id OR
--    is_admin(...)). A gym owner is neither, so src/lib/roles.ts getGymDayPasses
--    gets zero rows and the gym panel's day-pass card always reads 0.
--    `owns_gym()` comes from schema6_trainer_students.sql.
--
--    Scope note: this exposes the pass row (code, price, status, times) for the
--    owner's OWN gym only. It does NOT expose anything about the buyer beyond
--    the user_id already needed to honour the pass — no profile, no workout,
--    no weight. The privacy red line is untouched.
-- ----------------------------------------------------------------------------
--    Signature note: owns_gym takes ONE argument — owns_gym(g_id text) — and
--    resolves the caller itself via auth.uid(), because it is SECURITY DEFINER.
--    day_passes.gym_id is `text`, which matches it exactly.
drop policy if exists dp_owner_read on public.day_passes;
create policy dp_owner_read on public.day_passes
  for select to authenticated
  using (public.owns_gym(gym_id));

-- ----------------------------------------------------------------------------
-- 4. reviews: the owner reply policy lets an owner rewrite the review itself
--    schema7_gym_owner.sql says "an owner can NEVER delete one: Reviews stay the
--    members' property", but `reviews_owner_reply` is an unrestricted UPDATE on
--    every row of their gym — Postgres RLS cannot limit columns, so today an
--    owner could rewrite `body` and `rating`.
--
--    The only review UPDATE the app performs is replyToReview()
--    (src/lib/gymOwner.tsx:233) writing reply + reply_at, so a column-level
--    grant closes the hole without breaking anything.
-- ----------------------------------------------------------------------------
revoke update on public.reviews from authenticated;
grant update (reply, reply_at) on public.reviews to authenticated;

-- ----------------------------------------------------------------------------
-- 5. storage: `videos` has read + upload but no update policy
--    src/lib/api.ts:370 uploads with `upsert: true`, which makes supabase-js send
--    `x-upsert: true`; that path needs UPDATE on storage.objects. schema3 created
--    read+upload only. schema8 provisions exactly this for avatars and gyms.
-- ----------------------------------------------------------------------------
drop policy if exists "videos update" on storage.objects;
create policy "videos update" on storage.objects
  for update to authenticated
  using (bucket_id = 'videos')
  with check (bucket_id = 'videos');

-- ----------------------------------------------------------------------------
-- 6. moderation_actions.admin_id: `not null` and `on delete set null` contradict
--    schema4_admin.sql:102 declares both. Deleting an admin's auth user would
--    raise a not-null violation instead of nulling the column, so the delete
--    fails rather than preserving the audit row. Nothing in the app deletes auth
--    users today, so this is latent — we keep the column NOT NULL (an audit row
--    without an actor is worthless) and drop the contradictory FK action.
-- ----------------------------------------------------------------------------
do $$
declare fk_name text;
begin
  select c.conname into fk_name
    from pg_constraint c
   where c.conrelid = 'public.moderation_actions'::regclass
     and c.contype = 'f'
     and c.confdeltype = 'n'                                  -- ON DELETE SET NULL
     and c.conkey = array[(select attnum from pg_attribute
                            where attrelid = 'public.moderation_actions'::regclass
                              and attname = 'admin_id')];
  if fk_name is not null then
    execute format('alter table public.moderation_actions drop constraint %I', fk_name);
    alter table public.moderation_actions
      add constraint moderation_actions_admin_id_fkey
      foreign key (admin_id) references auth.users(id) on delete restrict;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 7. PRIVACY: every user's phone number is world-readable today
--
--    CONFIRMED on the live database: `profiles_read` is `USING (true)`, the
--    table has a `phone` column, and 12 of 28 profiles carry a real number.
--    The anon key ships inside the APK, so anyone who extracts it can read
--    every phone number in the product.
--
--    The masking design was already correct and is simply bypassed:
--      - the mobile app never reads `phone` at all (not even in DbProfile)
--      - the admin panel masks it (Users.tsx maskPhone) and is supposed to
--        reveal it only through `admin_unmask_phone`, a SECURITY DEFINER RPC
--        that writes a `phone_unmask` audit entry
--    but with no column privileges the raw number reached both clients anyway,
--    which made the masking cosmetic and the audit trail meaningless.
--
--    Row-level security cannot restrict columns, so the fix is column-level
--    privileges. A SECURITY DEFINER function is not subject to them, so admin
--    unmasking keeps working exactly as designed - and becomes the ONLY way to
--    see a number.
--
--    NOTE: this makes `select *` on profiles fail for these roles (Postgres
--    requires every column of a `*` expansion to be permitted). The clients were
--    updated in the same change: src/lib/api.ts PROFILE_COLS and
--    web/admin/src/screens/Users.tsx now name their columns explicitly.
-- ----------------------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;

grant select (
  id, user_id, name, gender, age, home_gym_id, level, goals, types, time_slot,
  bio, visibility, show_in_gym_list, created_at, role, specialty, price_from,
  avatar_url, status, status_reason, status_until, reports_count,
  requests_sent, requests_answered, streak_current, last_active_at
) on public.profiles to anon, authenticated;

-- `phone` is intentionally NOT in that list. Nothing else changes: the row-level
-- policies (profiles_read / profiles_admin_read / profiles_gym_owner_read) still
-- decide WHICH rows are visible; these grants decide which COLUMNS.
--
-- Ordering note: `avatar_url` appears above, so schema8_photos_location.sql must
-- be applied BEFORE this file.
