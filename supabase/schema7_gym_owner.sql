-- =====================================================================
-- SPOT — schema part 7: gym-owner panel (real data, no payments)
-- Run this in the Supabase SQL Editor (one paste). Safe to re-run.
--
-- What it adds:
--   1) reviews.reply / reply_at  — the ONE moderation power a gym owner has.
--      An owner can reply to a review. An owner can NEVER delete one:
--      the policy below permits UPDATE only for the gym's owner, and the app
--      never issues a delete. Reviews stay the members' property.
--   2) gyms.schedule            — the owner's own class/hours schedule (text rows).
--   3) gyms.allow_day_pass      — whether the gym wants day-passes recorded.
--      NOTE: SPOT charges nothing and holds no money. `day_passes.price` is a
--      display price only; payment happens at the gym.
--   4) gyms.show_members        — whether the member list is shown publicly.
-- =====================================================================

-- 1) Official replies on reviews -------------------------------------------
alter table public.reviews add column if not exists reply    text;
alter table public.reviews add column if not exists reply_at timestamptz;

-- Owner of the gym may UPDATE its reviews (the app only ever writes reply/reply_at).
-- There is deliberately no delete policy — an owner cannot remove a review.
drop policy if exists reviews_owner_reply on public.reviews;
create policy reviews_owner_reply on public.reviews for update to authenticated
  using (
    gym_id in (
      select g.id from public.gyms g
      join public.profiles p on p.id = g.owner_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    gym_id in (
      select g.id from public.gyms g
      join public.profiles p on p.id = g.owner_id
      where p.user_id = auth.uid()
    )
  );

-- 2/3/4) Owner-managed gym fields ------------------------------------------
alter table public.gyms add column if not exists schedule       jsonb   default '[]'::jsonb;
alter table public.gyms add column if not exists allow_day_pass boolean default true;
alter table public.gyms add column if not exists show_members   boolean default true;

-- The owner-scoped gyms_update policy from schema3.sql already covers these.
