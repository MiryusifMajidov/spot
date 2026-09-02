-- ============================================================================
-- SPOT · cleanup_fabricated_profiles_2.sql
--
-- One row of the fabricated batch fell outside the first cleanup's window:
-- «Rəşad Məmmədli» / @ranadmammadli2 was created at 10:34, a minute before the
-- 10:35–10:37 burst. Same signature as the other eleven — a duplicate of a name
-- already present, a `2`-suffixed handle, age 0, one goal, a home gym, and a
-- single sign-in at the moment of creation. It owns no content of any kind.
--
-- Handles are unique, so naming it directly is exact — no window, no guesswork.
-- ============================================================================

begin;

create temporary table stray on commit drop as
select p.id as profile_id, p.user_id as auth_id
  from public.profiles p
 where p.username = 'ranadmammadli2';

do $$
declare n int;
begin
  select count(*) into n from stray;
  if n <> 1 then
    raise exception 'gözlənilən 1 sətir əvəzinə % tapıldı — dayandırıldı', n;
  end if;
end $$;

delete from public.profiles where id in (select profile_id from stray);
delete from auth.users     where id in (select auth_id    from stray);

commit;
