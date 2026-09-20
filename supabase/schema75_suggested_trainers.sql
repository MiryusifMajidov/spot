-- schema75 — the trainers SPOT suggests to a new member
--
-- A person who has just made an account has an empty app: no partner, no
-- program, no trainer. The one thing SPOT can do at that moment is show them
-- who is actually here. Which trainers appear is a business decision, so an
-- admin sets it — and when nobody has set anything, the app must still have
-- five real answers rather than an empty screen.
--
-- WHY A SEPARATE TABLE. Not a `featured` column on `public.trainers`: the
-- client-side UPDATE grant there is column-scoped, and every column added later
-- has to be kept out of it by hand or a trainer can feature themselves. A table
-- whose only writer is an admin RPC cannot drift that way.
--
-- The list itself is NOT secret — it is a recommendation shown to everyone — so
-- reading it is open. Writing it is admin-only.

create table if not exists public.featured_trainers (
  trainer_id text primary key references public.trainers(id) on delete cascade,
  ord        int  not null default 0,
  set_by     uuid,
  set_at     timestamptz not null default now()
);

alter table public.featured_trainers enable row level security;

drop policy if exists ft_read on public.featured_trainers;
create policy ft_read on public.featured_trainers
  for select to anon, authenticated using (true);

revoke all on public.featured_trainers from anon, authenticated;
grant select on public.featured_trainers to anon, authenticated;

-- ------------------------------------------------- the admin sets the list
create or replace function public.admin_set_featured_trainer(
  p_trainer_id text,
  p_on         boolean,
  p_ord        int default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Featuring a trainer is a commercial act — it is the most valuable placement
  -- in the app — so it sits at the same level as verifying one.
  -- `require_admin_at_least` returns void and raises 'admin_only' itself; it is
  -- a statement, not a test. Writing `if not require_admin_at_least(...)` type-
  -- errors at call time, which is to say: in production, on the first admin who
  -- tried to feature somebody.
  perform public.require_admin_at_least('ops');

  if p_on then
    insert into public.featured_trainers (trainer_id, ord, set_by, set_at)
    values (p_trainer_id, coalesce(p_ord, 0), auth.uid(), now())
    on conflict (trainer_id) do update
      set ord = excluded.ord, set_by = excluded.set_by, set_at = now();
    perform public.admin_log('featured_trainer_on', 'trainer', p_trainer_id, null,
                             jsonb_build_object('ord', coalesce(p_ord, 0)));
  else
    delete from public.featured_trainers where trainer_id = p_trainer_id;
    perform public.admin_log('featured_trainer_off', 'trainer', p_trainer_id, null, '{}'::jsonb);
  end if;
end $$;

revoke all on function public.admin_set_featured_trainer(text, boolean, int) from public, anon;
grant execute on function public.admin_set_featured_trainer(text, boolean, int) to authenticated;

-- ------------------------------------------------- what the app actually shows
/*
 * Featured first, in the admin's order; then everyone else to fill the gap. The
 * fallback is the point: with nothing configured — which is the state of the
 * database today — a new member still meets real coaches instead of an empty
 * screen telling them SPOT has nobody.
 *
 * The fallback is RANDOM, not by rating. `trainers.rating` is `numeric default
 * 0` that schema27 pinned to zero and made unwritable, and `reviews` carries a
 * `gym_id` with no `trainer_id` — so nothing in SPOT can rate a coach, and
 * every row's rating is 0. Ordering by it would have looked principled and in
 * fact frozen the list to whatever order Postgres happened to return, handing
 * the same two people every placement forever. Verified coaches still come
 * first, because approval (ID + certificate + gym confirmation) is a real
 * signal; the shuffle only decides who among equals gets seen.
 *
 * Hence not `stable`: `random()` is volatile, and a stable wrapper would be
 * free to give every caller in a statement the same shuffle.
 *
 * Only `listed` trainers, ever: `listed` is the trainer's own switch, and
 * featuring someone who has taken their listing down would advertise a service
 * they have withdrawn. The caller is excluded so a trainer is never suggested
 * themselves.
 */
-- The return type gains a column below, and Postgres will not let `create or
-- replace` change one, so the old shape has to go first.
drop function if exists public.suggested_trainers(int);

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
     -- Following is what the suggestion screen offers, and `follows` is keyed
     -- on a profile id: a trainer row nobody owns is a listing, not a person to
     -- follow, so suggesting it would hand the app a button that cannot work.
     and t.owner_id is not null
     and (me.pid is null or t.owner_id is distinct from me.pid)
     -- A row nobody would recognise as a person is not a recommendation. Same
     -- rule the discovery list applies (src/lib/hooks.ts isRealTrainer).
     and coalesce(nullif(trim(t.name), ''), '') <> ''
     and (coalesce(nullif(trim(t.specialty), ''), '') <> '' or coalesce(nullif(trim(t.bio), ''), '') <> '')
   order by
     (f.trainer_id is null),        -- featured first
     f.ord nulls last,              -- in the admin's order
     t.verified desc nulls last,    -- then approved coaches
     random()                       -- and among equals, a fair shuffle
   limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke all on function public.suggested_trainers(int) from public;
grant execute on function public.suggested_trainers(int) to anon, authenticated;

-- --------------------------------------------------------------------------
-- RUN THIS BLOCK ON ITS OWN, after the DDL above.
-- `supabase db query` sends a file as one transaction, so a closing
-- `raise exception` rolls the CREATEs back with the probe.
-- --------------------------------------------------------------------------
-- do $$
-- declare n int; begin
--   select count(*) into n from public.suggested_trainers(5);
--   raise exception 'RESULTS: suggested_trainers returned % row(s) with nothing featured', n;
-- end $$;
