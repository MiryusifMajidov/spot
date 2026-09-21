-- schema78 PART 2 — apply ONLY after the app calls username_taken() for the
-- registration check (src/lib/api.ts isUsernameTaken). See schema78 for why.
--
-- The «visible in the gym list» branch now needs a registered caller. Every other
-- branch is unchanged: your own row, admins, and people you have a relationship
-- with (an accepted match or trainer link — has_relationship_with, schema39).

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select
  using (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
    or (
      public.is_registered()
      and coalesce(show_in_gym_list, true)
      and not public.blocked_between(id, public.my_profile_id())
    )
    or public.has_relationship_with(id)
  );

comment on policy profiles_read on public.profiles is
  'schema78. Other members'' profiles are readable by REGISTERED members (an @ad on their own profile), not by the bare publishable key, anonymous sessions or guests. Own row, admins and real relationships unchanged.';
