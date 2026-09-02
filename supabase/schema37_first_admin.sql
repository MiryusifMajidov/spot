-- ============================================================================
-- SPOT · schema37_first_admin.sql
--
-- `public.admins` was empty. Every admin surface checks it, so three flows ended
-- in a blind spot: a trainer could never become «Doğrulanmış», a gym owner could
-- never be approved, and a report sat in a queue nobody could open — while the
-- app promises «SPOT komandası yoxlayacaq» on the verification screen.
--
-- The account promoted here is the project's own — `yusif_spot`, the profile the
-- device signs in as. It gets `owner`, the only role that can create other
-- admins, so every further admin is added deliberately from the panel rather
-- than by another migration.
--
-- `admins.user_id` is an AUTH uid (not a profile id) — the same distinction that
-- has caused four separate bugs in this project, so it is taken from
-- `profiles.user_id` rather than typed in.
--
-- Apply AFTER schema36_notif_prefs_read.sql.
-- ============================================================================

insert into public.admins (user_id, name, role, two_factor)
select p.user_id, coalesce(p.name, 'SPOT'), 'owner', false
  from public.profiles p
 where p.username = 'yusif_spot'
   and p.user_id is not null
on conflict (user_id) do update set role = 'owner';

do $$
declare n int;
begin
  select count(*) into n from public.admins where role = 'owner';
  if n = 0 then
    raise exception 'owner admin yaradılmadı — profil tapılmadı?';
  end if;
end $$;
