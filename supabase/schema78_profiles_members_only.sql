-- schema78 — other people's profiles are for members, not for the anon key
--
-- THE HOLE. `profiles_read` is granted to role `public` and lets through any row
-- with show_in_gym_list = true (the default). So a request carrying nothing but
-- the app's publishable key — no sign-in at all — could list every visible
-- member and read their name, age, gender, bio and avatar, filtered by home gym.
-- Guest mode hides these people in the UI; nothing on the server did. The
-- 2026-09 platform audit recorded the same hole, and the product rule («a guest
-- sees the gym list and the trainer list») was enforced only in React.
--
-- THE RULE. The «visible in my gym's list» branch now requires the CALLER to be
-- a registered member — somebody with an @ad. Anonymous sessions (ensureSession
-- mints one before the first screen), the bare anon role and guests keep exactly
-- what they need: their own row, and people they have a real relationship with.
--
-- ORDER MATTERS, which is why this file has two parts:
--   PART 1 is additive and safe to apply at any time.
--   PART 2 must wait until the app reads @ad availability through PART 1's RPC:
--   the old client check read `profiles` directly, as an UNREGISTERED user, in
--   the middle of registration — after PART 2 it would see nobody and call
--   every handle free. (The unique index still refuses a duplicate at save, and
--   the app reports that as «tutulub», so the degradation is safe — but it is a
--   worse experience than it needs to be.)

-- ============================================================ PART 1 (additive)

/* Is this handle somebody else's? Checked against EVERY profile, hidden ones
   included. The client version could only see visible profiles, so a member who
   had switched off «zal siyahısında görün» had a handle that looked free on the
   registration screen and was then refused at save. */
create or replace function public.username_taken(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles p
     where lower(p.username) = lower(trim(p_username))
       and coalesce(trim(p_username), '') <> ''
       and (auth.uid() is null or p.user_id is distinct from auth.uid())
  );
$$;

revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

/* A registered member: has a profile row WITH an @ad. The trigger that creates a
   row for every new auth user (schema.sql handle_new_user) never writes one, and
   registration requires one, so this is the line between «a session exists» and
   «a person has joined». Same test the app's gate uses (appStore bootstrap). */
create or replace function public.is_registered()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and coalesce(trim(p.username), '') <> ''
  );
$$;

revoke all on function public.is_registered() from public;
grant execute on function public.is_registered() to anon, authenticated;
