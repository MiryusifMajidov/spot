-- ============================================================================
-- SPOT · schema51_my_storage.sql
--
-- `deleteMyAccount()` promises the person that «videoların, şəkillərin serverdən
-- silinir» and then deletes nothing at all.
--
-- The client lists each bucket and keeps the rows where `f.owner === uid`. But
-- the Storage list endpoint does not return `owner` — it returns
-- `name, id, updated_at, created_at, last_accessed_at, metadata`. The TypeScript
-- type was widened by hand to `{ name: string; owner?: string | null }`, so the
-- compiler was happy and `f.owner` is `undefined` for every row. `mine` is
-- always empty, `remove()` is never called, and then the RPC deletes the auth
-- user — after which `owner = auth.uid()` can never match again and NOBODY can
-- remove those files.
--
-- What is left behind, in a public bucket, permanently: the person's avatar,
-- their face in every video they posted, their gym photos, and the ID document
-- and certificates they uploaded to `certs` for trainer verification.
--
-- Storage rows cannot be deleted from SQL on Supabase («Use the Storage API
-- instead»), so this does not delete them — it tells the client the truth about
-- what it owns, so the client can delete them through the Storage API while the
-- account still exists.
--
-- Apply AFTER schema50_admin_decisions.sql.
-- ============================================================================

/**
 * Every storage object owned by the caller, across the app's buckets.
 *
 * SECURITY DEFINER because `storage.objects` is not readable column-by-column
 * from a client, and `row_security = off` for the same reason — the WHERE clause
 * is the security boundary here, and it is pinned to `auth.uid()`, so this can
 * only ever return the caller's own rows.
 */
create or replace function public.my_storage_objects()
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.owner = auth.uid()
     and o.bucket_id in ('avatars', 'gyms', 'videos', 'certs');
$$;

revoke execute on function public.my_storage_objects() from anon;
grant execute on function public.my_storage_objects() to authenticated;
