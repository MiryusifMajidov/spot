-- schema77 — the fallback suggests only verified trainers
--
-- schema75's fallback (nothing featured → shuffle the listed trainers) had no
-- verification filter. `listed` is the trainer's OWN switch, so any trainer put
-- themselves in front of every new member with one toggle — including one who
-- never passed ID + certificate + gym confirmation. And the admin panel's note
-- told the owner the opposite: «doğrulanmış müəllimlərdən təsadüfi 5».
--
-- The first screen a new member sees after registering is the most trusted
-- placement in the app. A stranger who has not been checked does not get it by
-- default. An admin can still feature anybody explicitly — that is a decision a
-- person made, not a switch the trainer flipped.

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
  with me as (select public.my_profile_id() as pid)
  select t.id, t.owner_id, t.name, t.specialty, t.rating, t.clients, t.photo_url, t.verified,
         (f.trainer_id is not null) as featured
    from public.trainers t
    left join public.featured_trainers f on f.trainer_id = t.id
   cross join me
   where t.listed = true
     and t.owner_id is not null
     and (me.pid is null or t.owner_id is distinct from me.pid)
     -- Featured by an admin, OR verified. Nothing else reaches this screen.
     and (f.trainer_id is not null or t.verified = true)
     and coalesce(nullif(trim(t.name), ''), '') <> ''
     and (coalesce(nullif(trim(t.specialty), ''), '') <> '' or coalesce(nullif(trim(t.bio), ''), '') <> '')
   order by
     (f.trainer_id is null),
     f.ord nulls last,
     random()
   limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke all on function public.suggested_trainers(int) from public;
grant execute on function public.suggested_trainers(int) to anon, authenticated;
