-- ============================================================================
-- SPOT · schema39_fix_profile_policy_recursion.sql
--
-- schema38's `profiles_read` called `my_profile_id()`, which SELECTs from
-- `profiles` — so evaluating the policy re-evaluated the policy:
--
--   ERROR 42P17: infinite recursion detected in policy for relation "profiles"
--
-- SECURITY DEFINER alone does not help: the definer is still subject to the
-- table's row security. `set row_security = off` inside the function is what
-- takes the helper out of the policy it is being called from. Both helpers that
-- read `profiles` get it.
--
-- Caught by the test suite before anything shipped — the first read of my own
-- profile failed, which is exactly the query the whole app starts with.
--
-- Apply AFTER schema38_blocks_and_visibility.sql.
-- ============================================================================

create or replace function public.my_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.id from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks bl
     where (bl.blocker_id = a and bl.blocked_id = b)
        or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

-- The relationship branch reads `match_requests` and `trainer_requests`, whose
-- own policies read `profiles` — the same loop one step further out. Moved into
-- a definer function so the policy body touches nothing that can recurse.
create or replace function public.has_relationship_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.match_requests m
     where m.status = 'accepted'
       and ((m.from_profile = other and m.to_profile = public.my_profile_id())
         or (m.to_profile   = other and m.from_profile = public.my_profile_id()))
  ) or exists (
    select 1 from public.trainer_requests r
      join public.trainers t on t.id = r.trainer_id
     where r.status = 'accepted'
       and ((r.from_profile = other and t.owner_id = public.my_profile_id())
         or (t.owner_id     = other and r.from_profile = public.my_profile_id()))
  );
$$;

grant execute on function public.has_relationship_with(uuid) to anon, authenticated;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select
  using (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
    or (
      coalesce(show_in_gym_list, true)
      and not public.blocked_between(id, public.my_profile_id())
    )
    or public.has_relationship_with(id)
  );
