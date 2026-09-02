-- ============================================================================
-- SPOT · schema11_gym_truth.sql
--
-- Gym cards were showing numbers nobody measured. Verified on the live database
-- before writing this file:
--
--   gym            claims                     reality
--   ------------   ------------------------   -------------------------------
--   Iron Bay       ★4.8, 132 rəy, ✓verified   6 real reviews, true avg 4.5
--   Atlas Fitness  ★4.7,  74 rəy, ✓verified   0 real reviews
--   Volt Gym       ★4.6,  98 rəy              0 real reviews
--   Peak House     ★4.4,  41 rəy              0 real reviews
--   Titan Gym      118 üzv                    0 members
--   Atlas Xətai     90 üzv                    0 members
--   (the seeded gyms claimed 0 members while really having 2–15)
--
-- Two of them also carried a blue verification badge nobody ever granted.
--
-- The fix is not to blank the columns but to DERIVE them, and to keep them
-- derived — a stored aggregate that nothing maintains drifts straight back into
-- fiction. Apply AFTER schema10_certs_and_fiction.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rating + review_count follow the reviews that actually exist
-- ----------------------------------------------------------------------------
create or replace function public.refresh_gym_rating(g_id text)
returns void language sql security definer set search_path = public as $$
  update public.gyms g
     set rating       = coalesce((select round(avg(r.rating)::numeric, 1) from public.reviews r where r.gym_id = g_id), 0),
         review_count = (select count(*) from public.reviews r where r.gym_id = g_id)
   where g.id = g_id;
$$;

create or replace function public.reviews_touch_gym()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_gym_rating(old.gym_id);
    return old;
  end if;
  perform public.refresh_gym_rating(new.gym_id);
  -- A review moved between gyms has to correct both sides.
  if tg_op = 'UPDATE' and old.gym_id is distinct from new.gym_id then
    perform public.refresh_gym_rating(old.gym_id);
  end if;
  return new;
end $$;

drop trigger if exists reviews_sync_gym_rating on public.reviews;
create trigger reviews_sync_gym_rating
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_touch_gym();

-- ----------------------------------------------------------------------------
-- 2. members follows the profiles that actually chose this gym
-- ----------------------------------------------------------------------------
create or replace function public.refresh_gym_members(g_id text)
returns void language sql security definer set search_path = public as $$
  update public.gyms g
     set members = (select count(*) from public.profiles p where p.home_gym_id = g_id)
   where g.id = g_id;
$$;

create or replace function public.profiles_touch_gym()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.home_gym_id is not null then perform public.refresh_gym_members(old.home_gym_id); end if;
    return old;
  end if;
  if new.home_gym_id is not null then perform public.refresh_gym_members(new.home_gym_id); end if;
  if tg_op = 'UPDATE' and old.home_gym_id is not null and old.home_gym_id is distinct from new.home_gym_id then
    perform public.refresh_gym_members(old.home_gym_id);
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_gym_members on public.profiles;
create trigger profiles_sync_gym_members
  after insert or update of home_gym_id or delete on public.profiles
  for each row execute function public.profiles_touch_gym();

-- ----------------------------------------------------------------------------
-- 3. Backfill every gym from reality, once
-- ----------------------------------------------------------------------------
update public.gyms g
   set rating       = coalesce((select round(avg(r.rating)::numeric, 1) from public.reviews r where r.gym_id = g.id), 0),
       review_count = (select count(*) from public.reviews r where r.gym_id = g.id),
       members      = (select count(*) from public.profiles p where p.home_gym_id = g.id);

-- ----------------------------------------------------------------------------
-- 4. The blue badge means an admin approved an ownership claim — nothing else
--
--    Iron Bay and Atlas Fitness carried `verified = true` straight out of the
--    seed. A verification badge on a listing nobody checked is the single most
--    misleading thing a directory can show.
-- ----------------------------------------------------------------------------
update public.gyms g
   set verified = exists (
         select 1 from public.gym_claims c
          where c.gym_id = g.id and c.status = 'approved'
       );
