-- ============================================================================
-- SPOT · schema38_blocks_and_visibility.sql
--
-- F-11  BLOCKING WAS ONLY ON THE DEVICE. `moderation.ts` wrote the blocked id
--       into `useAppStore.blocked` (AsyncStorage) and there was no table at all.
--       So «Blok» meant «I stop seeing them» and nothing else: the blocked
--       person still saw the profile, could still send a match request, and the
--       whole list vanished on reinstall. For an app that arranges people to
--       meet in person, that is a safety hole, not a preference.
--
-- F-14  PROFILE PRIVACY WAS ONLY ON THE DEVICE TOO. `profiles_read` is
--       `USING (true)`, and `visibility` is referenced by no policy anywhere;
--       `show_in_gym_list` is filtered in `isListable()` on the client. So a
--       person who switched «Zalda göründüyümü göstər» off was still fully
--       readable through the API — name, age, gender, gym, goals, bio, avatar —
--       with the key that ships in the APK. Only the app stopped drawing them.
--
-- The visibility rule kept here is deliberately narrow: hiding yourself removes
-- you from the DIRECTORY, it does not erase you from conversations you chose to
-- join. So a hidden profile stays readable to yourself, to admins, and to
-- anyone you already have a relationship with (an accepted match, a trainer
-- link); to everybody else the row simply is not there, and the app already
-- renders an unresolved author as «SPOT istifadəçisi» rather than guessing.
--
-- Apply AFTER schema37_first_admin.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. blocks
-- ----------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_by_blocked on public.blocks (blocked_id);

alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

-- You manage your OWN block list, and you can only read your own — knowing who
-- blocked you is not information this app should hand out.
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks
  for all to authenticated
  using (blocker_id in (select p.id from public.profiles p where p.user_id = auth.uid()))
  with check (blocker_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

/** Is there a block in EITHER direction between these two profiles?
 *  Symmetric on purpose: a block hides both ways, which is what the design
 *  means by «qarşılıqlı gizlətmə». */
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocks bl
     where (bl.blocker_id = a and bl.blocked_id = b)
        or (bl.blocker_id = b and bl.blocked_id = a)
  );
$$;

grant execute on function public.blocked_between(uuid, uuid) to anon, authenticated;

/** My profile id, or NULL for a guest. Used by the policies below. */
create or replace function public.my_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

grant execute on function public.my_profile_id() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. A block stops a partner request, not just the drawing of one
-- ----------------------------------------------------------------------------
drop policy if exists match_insert on public.match_requests;
create policy match_insert on public.match_requests
  for insert to authenticated
  with check (
    from_profile in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
    and not public.blocked_between(from_profile, to_profile)
  );

-- ----------------------------------------------------------------------------
-- 3. Profile reads honour the switch, and a block
-- ----------------------------------------------------------------------------
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select
  using (
    -- myself
    user_id = auth.uid()
    or public.is_admin(auth.uid())
    or (
      -- not hidden, and no block either way
      coalesce(show_in_gym_list, true)
      and not public.blocked_between(id, public.my_profile_id())
    )
    or (
      -- hidden, but we already have a relationship: an accepted match…
      exists (
        select 1 from public.match_requests m
         where m.status = 'accepted'
           and ((m.from_profile = profiles.id and m.to_profile = public.my_profile_id())
             or (m.to_profile   = profiles.id and m.from_profile = public.my_profile_id()))
      )
      -- …or a trainer/student link in either direction
      or exists (
        select 1 from public.trainer_requests r
          join public.trainers t on t.id = r.trainer_id
         where r.status = 'accepted'
           and ((r.from_profile = profiles.id and t.owner_id = public.my_profile_id())
             or (t.owner_id     = profiles.id and r.from_profile = public.my_profile_id()))
      )
    )
  );

-- The gym owner's existing read of their own members stays: policies are OR'd
-- and `profiles_gym_owner_read` is untouched.
