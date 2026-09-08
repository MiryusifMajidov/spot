-- ============================================================================
-- SPOT · schema62_grant_hardening.sql
--
-- schema2 granted privileges to `anon` and `authenticated` in a loop over a list
-- of table names. A loop cannot say «and only these privileges», so every table
-- in `public` came out with the full set — including three nobody ever wanted:
--
--   TRUNCATE   · **not filtered by row-level security.** RLS is a row filter, and
--                TRUNCATE does not read rows; a role holding it empties the whole
--                table regardless of every policy above. `audit_log` is described
--                in schema4 as «append-only (24 months; no UPDATE/DELETE policy
--                exists)» — and has carried a TRUNCATE grant the entire time, so
--                the sentence was true of policies and false of privileges.
--                Same for profiles, workouts, progress and reports.
--   REFERENCES · lets a role point a foreign key at the table, which blocks
--                deletes there from then on.
--   TRIGGER    · lets a role attach a trigger to a table it does not own.
--
-- None of these is reachable through Supabase's API today: PostgREST issues no
-- TRUNCATE and no DDL, and the anon key is a JWT for PostgREST rather than a
-- Postgres password. This is not a live hole — it is the second lock. A grant
-- with no purpose is a grant waiting for the day something can reach it, and the
-- column-grant traps in this project have already shown how easily a privilege
-- outlives the reason it was given.
--
-- The second half revokes INSERT / UPDATE / DELETE on the tables that have NO
-- write policy at all — read-only catalogues (`exercises`, `meals`,
-- `shop_items`), an admin-read evidence table (`report_messages`), and PostGIS's
-- own views. Writes there are already refused by RLS; this makes the privilege
-- match the intent, so a permissive policy added later cannot quietly open a
-- door the grants left unlocked. Tables WITH a write policy are untouched — and
-- deliberately so: revoking a table-level privilege also drops the column-level
-- grants underneath it, which is exactly how schema45's careful column list was
-- silently undone once already.
--
-- Apply AFTER schema61_push.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privileges nothing in SPOT uses, on every table in public
-- ----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v','m','p')
  loop
    begin
      execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
    exception when insufficient_privilege or wrong_object_type then
      -- PostGIS owns spatial_ref_sys; we revoke what we are allowed to and
      -- leave the rest rather than failing the migration over a system table.
      null;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Write privileges on tables that have no write policy
--
-- Guarded twice: only tables with no INSERT/UPDATE/DELETE/ALL policy, and only
-- tables with no COLUMN-level grants — revoking at table level would take those
-- with it, and the column lists are the whole defence on feed_videos,
-- community_posts, profiles, gyms and trainers.
-- ----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select c.oid, c.relname
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where n2.nspname = 'public' and c.relkind in ('r','v','p')
       and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
            and p.cmd in ('INSERT','UPDATE','DELETE','ALL'))
       -- `information_schema.column_privileges` is the WRONG source for this
       -- test: it reports a column as granted when the grant is on the TABLE, so
       -- every table looked like it had column-level grants and nothing was
       -- revoked. `pg_attribute.attacl` is non-null only for a real per-column
       -- grant, which is the thing that must not be dropped.
       and not exists (
         select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and a.attacl is not null)
  loop
    begin
      execute format('revoke insert, update, delete on public.%I from anon, authenticated', t.relname);
    exception when insufficient_privilege or wrong_object_type then
      -- PostGIS owns spatial_ref_sys and its two views; leave what is not ours.
      null;
    end;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. Say it out loud where the claim is strongest
-- ----------------------------------------------------------------------------
comment on table public.audit_log is
  'Append-only record of admin decisions. No UPDATE or DELETE policy, and since schema62 no TRUNCATE grant either — the privilege used to contradict the promise.';
