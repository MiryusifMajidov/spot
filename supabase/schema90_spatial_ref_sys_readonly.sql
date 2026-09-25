-- schema90: take away anon's ability to DESTROY the PostGIS coordinate table.
--
-- `public.spatial_ref_sys` came with the PostGIS extension, which was installed
-- into `public`. Supabase's default grants left it with SELECT, INSERT, UPDATE,
-- DELETE **and TRUNCATE** for both `anon` and `authenticated`, RLS is off, and
-- the schema is exposed through PostgREST. The app's publishable key is inside
-- every APK — and, since the repository is public, on GitHub — so anybody at all
-- could have emptied the table that every distance calculation depends on:
-- `gyms_near(lat, lng)` sorts the map by distance, and with no SRID rows the
-- geography operators fail. That is not a data leak; it is a switch anyone could
-- flip to break the map for every user at once.
--
-- `schema62_grant_hardening.sql` already tried to revoke this and swallowed the
-- failure on purpose, because the table is owned by `supabase_admin` and a
-- revoke by a non-owner raises. This file does the same revoke but keeps the
-- error, so a failure is visible instead of silent — and it revokes ONLY the
-- write privileges.
--
-- SELECT IS DELIBERATELY KEPT. PostGIS reads spatial_ref_sys while answering a
-- geography query; revoking SELECT from `authenticated` would break the map for
-- real users, which is the very thing this file is protecting.
--
-- RESULT WHEN RUN (25.09.2026): the revoke was REFUSED and the hole is STILL
-- OPEN. Read back immediately afterwards, every write privilege is still there:
--
--   anon_select t | anon_insert t | anon_update t | anon_delete t
--   anon_truncate t | auth_truncate t
--
-- The migration role (`postgres`) does not own the table, and only the owner may
-- revoke. So this cannot be fixed from the CLI. What is left:
--
--   1. Run the same REVOKE from the Supabase dashboard's SQL editor. Takes one
--      paste; if it also fails, the role there is no higher and step 2 applies.
--   2. Ask Supabase support to move PostGIS out of `public`
--      (`alter extension postgis set schema extensions;`) or to revoke for us.
--
-- Why it matters, stated plainly: `anon` may DELETE, and PostgREST exposes the
-- `public` schema, so `DELETE /rest/v1/spatial_ref_sys` with the publishable key
-- — which ships inside every APK — would empty the table that every distance
-- calculation reads. The map stops sorting by distance for everyone. It is not a
-- data leak and nothing private is exposed; it is a switch left within reach.

do $$
declare
  could_not text := '';
begin
  begin
    revoke insert, update, delete, truncate on table public.spatial_ref_sys from anon, authenticated;
  exception when others then
    -- Not the owner. Say so loudly: the hole is still open and needs to be
    -- closed from the Supabase dashboard (SQL editor runs as a role that can),
    -- or by moving PostGIS out of `public` into its own schema.
    could_not := sqlerrm;
  end;

  if could_not <> '' then
    raise warning 'spatial_ref_sys: could not revoke write privileges — %', could_not;
  end if;
end $$;

-- What the grants look like now. `f` in the write columns is the goal.
select
  has_table_privilege('anon',          'public.spatial_ref_sys', 'SELECT')   as anon_select,
  has_table_privilege('anon',          'public.spatial_ref_sys', 'INSERT')   as anon_insert,
  has_table_privilege('anon',          'public.spatial_ref_sys', 'UPDATE')   as anon_update,
  has_table_privilege('anon',          'public.spatial_ref_sys', 'DELETE')   as anon_delete,
  has_table_privilege('anon',          'public.spatial_ref_sys', 'TRUNCATE') as anon_truncate,
  has_table_privilege('authenticated', 'public.spatial_ref_sys', 'TRUNCATE') as auth_truncate;
