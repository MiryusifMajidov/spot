-- ============================================================================
-- SPOT · schema40_delete_account.sql
--
-- There was no way to delete an account. «Məxfilik» offered «Datanı bu cihazdan
-- sil» and, for the server copy, «dəstəyə yaz» — a support channel that accepts
-- no free text and has no reply path (F-16). So a person could not remove their
-- profile, their videos, their comments or their photos by any means.
--
-- Apple has required in-app account deletion since 2022 and Google Play requires
-- it too: this is a store rejection, before it is a privacy problem.
--
-- What goes, in one transaction:
--   · the profile row, whose CASCADEs take the check-ins, comments, comment
--     likes, match requests, progress, PRs, workouts, student links, trainer
--     requests, trainer listing and notifications with it;
--   · the auth user, so the credential cannot sign in again.
--
-- What is deliberately kept, with the author detached (`ON DELETE SET NULL`):
-- community posts, feed videos, reviews, gyms and programs. Deleting a gym or a
-- program would take away things other members depend on, and the app already
-- renders an author-less row as «SPOT istifadəçisi» rather than guessing a name.
-- A gym left owner-less returns to the catalogue as unclaimed, which is true.
--
-- The account's uploaded files (avatar, gym photos, videos, certificates) are
-- deleted by the client just before this runs — Postgres is not allowed to touch
-- `storage.objects` directly on Supabase.
--
-- Apply AFTER schema39_fix_profile_policy_recursion.sql.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare uid uuid; pid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select p.id into pid from public.profiles p where p.user_id = uid;

  -- Storage is NOT touched here: Supabase refuses a direct DELETE on
  -- `storage.objects` («Use the Storage API instead»), so the files are removed
  -- by the client immediately before this call, through `storage.remove()` —
  -- which schema33 already scopes to `owner = auth.uid()`. See
  -- `deleteMyAccount()` in src/lib/api.ts: the files go first, so a failure
  -- there stops the whole deletion instead of orphaning them.

  if pid is not null then
    -- Not covered by a CASCADE from `profiles`: a block row where this account
    -- is the BLOCKED side is keyed on the other person's blocker_id.
    delete from public.blocks where blocked_id = pid or blocker_id = pid;
    delete from public.profiles where id = pid;
  end if;

  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account is
  'Deletes the caller''s own account: their storage objects, their profile (with every CASCADE it owns) and their auth user. Content whose author FK is ON DELETE SET NULL survives without a name. Irreversible.';
