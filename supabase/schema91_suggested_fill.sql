-- schema91 — the registration trainer step fills up to five, in tiers
--
-- schema77 let only admin-featured or verified trainers into
-- `suggested_trainers()`. The rule was right about trust and wrong about launch:
-- on 29.09.2026 the live project had 6 trainers, 2 of them listed, 0 verified and
-- 0 featured — so the function returned nothing, and onboarding/trainers.tsx,
-- which steps aside on an empty answer, never appeared for anybody. The owner's
-- requirement is that a new member is shown up to five trainers to follow.
--
-- Tiers, in this order, random within a tier:
--   0. featured by an admin (featured_trainers.ord first) — a person decided;
--   1. verified — ID, certificate and gym confirmed;
--   2. the rest: listed trainers with a COMPLETE public profile — a name, a
--      specialty, and a photo or a written bio. These are the same trainers
--      Kəşf already shows to everybody, since `listed` is the trainer's own
--      opt-in to being found. They carry no «verified» badge on the screen
--      (the badge is `verified`, which stays false for them).
-- Tier 2 only ever fills what tiers 0 and 1 leave empty, so as trainers are
-- verified they push the unverified ones out of the five on their own.
--
-- Every tier still requires `listed` (a trainer who switched themselves off is
-- not put in front of new members, featured or not), an owner, a name, and not
-- being the person asking.

create or replace function public.suggested_trainers(p_limit int default 5)
returns table (
  id        text,
  owner_id  uuid,
  name      text,
  specialty text,
  rating    numeric,
  clients   int,
  photo_url text,
  verified  boolean,
  featured  boolean
)
language sql
security definer
set search_path = public
set row_security = off
as $$
  with me as (select public.my_profile_id() as pid),
  pool as (
    select t.id, t.owner_id, t.name, t.specialty, t.rating, t.clients, t.photo_url, t.verified,
           (f.trainer_id is not null) as featured,
           f.ord,
           case
             when f.trainer_id is not null then 0
             when t.verified = true then 1
             else 2
           end as tier
      from public.trainers t
      left join public.featured_trainers f on f.trainer_id = t.id
     cross join me
     where t.listed = true
       and t.owner_id is not null
       and (me.pid is null or t.owner_id is distinct from me.pid)
       and coalesce(nullif(trim(t.name), ''), '') <> ''
       and (
             -- tiers 0 and 1: as schema77 — something beyond a name
             ((f.trainer_id is not null or t.verified = true)
               and (coalesce(nullif(trim(t.specialty), ''), '') <> '' or coalesce(nullif(trim(t.bio), ''), '') <> ''))
             -- tier 2: a complete public profile
          or (coalesce(nullif(trim(t.specialty), ''), '') <> ''
               and (t.photo_url is not null or coalesce(nullif(trim(t.bio), ''), '') <> ''))
           )
  ),
  -- One card per person: the screen keys rows by owner, and two trainer rows
  -- for one owner would show the same face twice. The best-tier row wins.
  one as (
    select distinct on (owner_id) *
      from pool
     order by owner_id, tier, ord nulls last, random()
  )
  select id, owner_id, name, specialty, rating, clients, photo_url, verified, featured
    from one
   order by tier, ord nulls last, random()
   limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke all on function public.suggested_trainers(int) from public;
grant execute on function public.suggested_trainers(int) to anon, authenticated;
