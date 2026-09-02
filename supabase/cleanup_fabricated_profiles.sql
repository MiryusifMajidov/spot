-- ============================================================================
-- SPOT · cleanup_fabricated_profiles.sql
--
-- Eleven profiles were created by a script in two bursts on 2026-08-31, at
-- 10:35 (6 accounts) and 10:36 (5 accounts): «Aysel Hüseynli», «Elçin Vəliyev»,
-- «Günel Rəhimova», «Kamran Səlimov», «Rəşad Məmmədli» and the rest, each name
-- present twice with a `2`-suffixed handle (`ayselhuseynli` / `ayselhuseynli2`),
-- every one with age 0, a home gym assigned, one goal, and a single sign-in at
-- the moment of creation. Every other minute in the whole `auth.users` table
-- holds exactly one account — a real device session.
--
-- They were passing `looksComplete()`, so the app was offering eleven invented
-- people as training partners. That is the one thing this product may never do.
--
-- Verified before deleting: they own no comment, video, post, review, check-in,
-- match request or program. Nothing is orphaned.
--
-- The earlier seed cleanup missed them because they were not seeded rows — they
-- were made through `signInAnonymously()` + a profile insert, so they looked
-- exactly like real sign-ups to every predicate used at the time. The creation
-- timestamp is what gives them away.
-- ============================================================================

begin;

create temporary table fabricated on commit drop as
select p.id as profile_id, p.user_id as auth_id
  from public.profiles p
  join auth.users u on u.id = p.user_id
 where u.created_at >= timestamptz '2026-08-31 10:35:00+00'
   and u.created_at <  timestamptz '2026-08-31 10:37:00+00';

-- A last guard: if this ever matches something other than the eleven known rows
-- — a real person who happened to sign up in that minute — stop rather than
-- guess.
do $$
declare n int;
begin
  select count(*) into n from fabricated;
  if n <> 11 then
    raise exception 'gözlənilən 11 sətir əvəzinə % tapıldı — dayandırıldı', n;
  end if;
end $$;

delete from public.profiles where id in (select profile_id from fabricated);
delete from auth.users     where id in (select auth_id    from fabricated);

commit;
