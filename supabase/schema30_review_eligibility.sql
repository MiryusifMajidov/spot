-- ============================================================================
-- SPOT · schema30_review_eligibility.sql
--
-- «Yalnız bu zalda ən azı 3 dəfə check-in edən rəy yaza bilər — saxta rəylərin
-- qarşısını alır.» That sentence is on the gym screen, and it was true only of
-- the button: `reviews_insert` never checked a single check-in, so a request
-- made outside the app could review any gym without ever going there.
--
-- The rule matters more than most, because `reviews_sync_gym_rating` turns these
-- rows straight into the gym's public star rating. An unguarded review table is
-- a rating anyone can set.
--
-- Enforced here, at the same threshold the screen states. schema19 already made
-- check-ins themselves server-verified and capped at one per gym day, so three
-- of them is three separate days at that gym — which is exactly what the
-- sentence promises.
--
-- Also: one review per person per gym. The screen shows «Sənin rəyin» in the
-- singular and offers an edit, but nothing stopped a second row being inserted
-- and counted again in the average.
--
-- Apply AFTER schema29_author_required.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. One review per member per gym
--
--    Rows written before this may violate it, so the index is built only after
--    checking. If it fails, look at the duplicates rather than dropping them.
-- ----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from (
    select gym_id, author_id from public.reviews
     where author_id is not null
     group by 1,2 having count(*) > 1
  ) d;
  if n > 0 then
    raise exception '% zal/müəllif cütündə birdən çox rəy var — əvvəlcə onlara bax', n;
  end if;
end $$;

create unique index if not exists reviews_one_per_member
  on public.reviews (gym_id, author_id)
  where author_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Three real check-ins at THIS gym before a review
-- ----------------------------------------------------------------------------
create or replace function public.can_review_gym(p_gym_id text, p_author uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*) from public.check_ins c
     where c.gym_id = p_gym_id and c.profile_id = p_author
  ) >= 3;
$$;

grant execute on function public.can_review_gym(text, uuid) to anon, authenticated;

drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    and not public.is_sanctioned(auth.uid())
    and public.can_review_gym(gym_id, author_id)
  );

-- Editing your own review must not become a way around the gate, and must never
-- let a member rewrite somebody else's words.
drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews
  for update to authenticated
  using (author_id in (select p.id from public.profiles p where p.user_id = auth.uid()))
  with check (
    author_id in (select p.id from public.profiles p where p.user_id = auth.uid())
    and public.can_review_gym(gym_id, author_id)
  );
