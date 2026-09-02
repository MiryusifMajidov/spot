-- ============================================================================
-- SPOT · schema41_gym_listing_review.sql
--
-- `create-gym.tsx` needs a name and a pin, and the row is live in Kəşf the
-- moment it lands: `gyms_read` is `USING (true)` and nothing marks a gym as
-- awaiting review. So the catalogue is open to spam — ten «Titan Fitness»
-- entries would sit next to the real gyms, and on 2026-08-31 exactly two
-- fabricated gyms had to be deleted by hand for this reason.
--
-- `trainers` already solved this with `listed`; gyms get the same column and the
-- same rule, which also makes the two account types behave alike.
--
--   · a gym CREATED FROM THE APP starts `listed = false` — visible to its owner
--     in their own panel, invisible in the catalogue;
--   · an admin (ops or higher) publishes it;
--   · approving a VÖEN claim publishes it too, since that is a stronger check
--     than an admin glance;
--   · the catalogue's four seeded gyms stay listed.
--
-- `listed` is withheld from clients by GRANT, exactly like `verified` and
-- `claim_status` in schema27 — otherwise «starts unlisted» is one UPDATE away
-- from meaningless.
--
-- Apply AFTER schema40_delete_account.sql.
-- ============================================================================

alter table public.gyms add column if not exists listed boolean not null default false;

-- Everything already in the catalogue keeps its place.
update public.gyms set listed = true where listed is distinct from true;

-- New rows default to false: `create-gym.tsx` does not pass the column, and the
-- grant below stops it ever doing so.
alter table public.gyms alter column listed set default false;

revoke insert (listed), update (listed) on public.gyms from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Only a listed gym is public. An owner still sees their own, and an admin sees
-- everything — otherwise the panel could not review what it is meant to publish.
-- ----------------------------------------------------------------------------
drop policy if exists gyms_read on public.gyms;
create policy gyms_read on public.gyms
  for select
  using (
    coalesce(listed, false)
    or owner_id = public.my_profile_id()
    or public.is_admin(auth.uid())
  );

-- ----------------------------------------------------------------------------
-- An approved claim publishes the gym: a real VÖEN application that ops accepted
-- is a stronger signal than a moderator eyeballing the name.
-- ----------------------------------------------------------------------------
create or replace function public.gym_claims_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.gyms set claim_status = 'claimed', listed = true where id = new.gym_id;
  end if;
  return new;
end $$;

drop trigger if exists gym_claims_publish_gym on public.gym_claims;
create trigger gym_claims_publish_gym
  after update on public.gym_claims
  for each row execute function public.gym_claims_publish();
