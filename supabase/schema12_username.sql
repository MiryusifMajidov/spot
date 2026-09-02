-- ============================================================================
-- SPOT · schema12_username.sql
--
-- A profile needs a handle as well as a display name. `name` is what a person
-- is called («Yusif»); `username` is how they are addressed and found (@yusif)
-- and must be unique.
--
-- Apply AFTER schema11_gym_truth.sql.
-- Additive only.
-- ============================================================================

alter table public.profiles add column if not exists username text;

-- Case-insensitive uniqueness: @Yusif and @yusif are the same handle. A partial
-- index so the many existing profiles with no handle yet do not collide on NULL.
drop index if exists profiles_username_key;
create unique index if not exists profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

-- Shape rules enforced in the database, not just in the client: 3–20 characters,
-- latin letters, digits and underscore only. Azerbaijani display names stay in
-- `name`; a handle has to be typeable on any keyboard and safe in a URL.
alter table public.profiles drop constraint if exists profiles_username_shape;
alter table public.profiles add constraint profiles_username_shape
  check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');

-- The column is readable by clients — a handle is public by design, unlike
-- `phone`. schema9 revoked table-wide SELECT and granted an explicit list, so
-- the new column has to be added to that grant or nobody could read it.
grant select (username) on public.profiles to anon, authenticated;

-- Suggest a handle for every profile that already has a name, so existing users
-- are not left blank. Derived from the name, transliterated out of Azerbaijani,
-- and de-duplicated with a numeric suffix. Users can change it afterwards.
with base as (
  select p.id,
         nullif(
           regexp_replace(
             lower(translate(coalesce(p.name, ''),
                             'əöüğışçƏÖÜĞIŞÇİ',
                             'aouginscAOUGISCI')),
             '[^a-z0-9]', '', 'g'),
           '') as slug
    from public.profiles p
   where p.username is null
),
ranked as (
  select id, slug,
         row_number() over (partition by slug order by id) as rn
    from base
   where slug is not null and length(slug) >= 3
)
update public.profiles p
   set username = case when r.rn = 1 then left(r.slug, 20)
                       else left(r.slug, 16) || r.rn::text end
  from ranked r
 where p.id = r.id
   and not exists (select 1 from public.profiles q
                    where lower(q.username) = lower(case when r.rn = 1 then left(r.slug, 20)
                                                         else left(r.slug, 16) || r.rn::text end));
