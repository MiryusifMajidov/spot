-- ============================================================================
-- SPOT · schema23_real_trainer_counts.sql
--
-- The Kəşf card for Iron Bay showed a chip reading «9 müəllim». There are zero
-- trainers at Iron Bay. There is exactly ONE trainer row in the entire database,
-- it belongs to volt-gym, and it is the user's own «Sən · Test» listing.
--
-- The chip was never a computation. It is a literal string seeded into the
-- `gyms.tags` array, next to «Duş» and «Park»:
--
--   iron-bay    tags = {Sərbəst ağırlıq, Duş, Park, 9 müəllim}
--   volt-gym    tags = {24 saat, Kardio, 14 müəllim}
--   atlas-fit   tags = {Basseyn, Sauna, 7 müəllim}
--   peak-house  tags = {Funksional, CrossFit, 5 müəllim}
--
-- 35 coaches that do not exist, frozen into a text array where nothing would
-- ever correct them. A tag is a facility («Duş», «24 saat»); a count is a
-- measurement and must come from a query.
--
-- `gyms.trainers` was separately stale for the same reason: `members` has the
-- `profiles_sync_gym_members` trigger and `rating` has `reviews_sync_gym_rating`,
-- but nothing ever refreshed `trainers`, so it still held the seed's 9/14/7/5.
-- This adds the missing third trigger, matching the two that already exist.
--
-- Apply AFTER schema22_drop_dead_counters.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Take the invented counts out of the tag chips
--
--    Matched by shape («<number> müəllim»), not by listing the four known
--    strings, so a seed that wrote «12 müəllim» somewhere else goes too.
-- ----------------------------------------------------------------------------
update public.gyms
   set tags = (select coalesce(array_agg(t), '{}') from unnest(tags) t
                where t !~ '^\s*\d+\s*müəllim\s*$')
 where exists (select 1 from unnest(tags) t where t ~ '^\s*\d+\s*müəllim\s*$');

-- ----------------------------------------------------------------------------
-- 2. Keep `gyms.trainers` true, the same way `members` and `rating` are kept
--
--    Counts LISTED trainers only — that is what a member browsing the app can
--    actually find and contact, so the number on the gym matches the list behind
--    it. An unlisted coach is invisible and must not be advertised.
-- ----------------------------------------------------------------------------
create or replace function public.refresh_gym_trainers(g text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gyms
     set trainers = (select count(*) from public.trainers t
                      where t.gym_id = g and coalesce(t.listed, false))
   where id = g;
$$;

create or replace function public.trainers_touch_gym()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.gym_id is not null then perform public.refresh_gym_trainers(old.gym_id); end if;
    return old;
  end if;
  if new.gym_id is not null then perform public.refresh_gym_trainers(new.gym_id); end if;
  -- A coach who moved gyms has to correct both sides.
  if tg_op = 'UPDATE' and old.gym_id is not null and old.gym_id is distinct from new.gym_id then
    perform public.refresh_gym_trainers(old.gym_id);
  end if;
  return new;
end $$;

drop trigger if exists trainers_sync_gym_trainers on public.trainers;
create trigger trainers_sync_gym_trainers
  after insert or update or delete on public.trainers
  for each row execute function public.trainers_touch_gym();

-- One-time correction of every existing row, including the gyms that have no
-- trainer at all and were claiming several.
update public.gyms g
   set trainers = (select count(*) from public.trainers t
                    where t.gym_id = g.id and coalesce(t.listed, false));
