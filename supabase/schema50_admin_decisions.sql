-- ============================================================================
-- SPOT · schema50_admin_decisions.sql
--
-- The admin panel cannot approve anything. Not «is refused sometimes» — cannot,
-- ever, for any admin.
--
-- schema27 and schema41 correctly took the trust columns away from clients:
--
--   gyms      · UPDATE granted on (name, district, hours, price_month, …)
--               NOT on claim_status, owner_id, listed, verified
--   trainers  · UPDATE granted on (name, bio, specialty, listed, …)
--               NOT on verify_status, verified
--
-- and that is right: nobody may verify themselves. But the admin panel signs in
-- with the same publishable key and the same `authenticated` role as everybody
-- else — an admin is a row in `public.admins`, not a Postgres role. Column
-- privileges are checked before RLS and cannot ask «is this person an admin»,
-- so `web/admin/src/screens/Gyms.tsx:148` (`update({claim_status:'claimed',
-- owner_id})`) and `Trainers.tsx:138` (`update({verify_status:'approved',
-- verified:true})`) are refused outright.
--
-- Consequence, on the live platform: no gym claim can ever be approved, no gym
-- created in the app can ever be published, and no trainer can ever be
-- verified. Every «Doğrulanmış müəllim» surface in the product is unreachable,
-- and Trainers.tsx silently reverts its own optimistic row back to «pending».
--
-- The fix is not to widen the grants — that would hand every user the badge.
-- It is to route the decision through SECURITY DEFINER functions that check
-- `is_admin(auth.uid())` themselves, which is the same shape schema19 used for
-- check-in and schema40 for account deletion.
--
-- Every decision is written to `audit_log`, so an approval always has a name
-- against it.
--
-- Apply AFTER schema49_block_enforcement.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Shared guard
-- ----------------------------------------------------------------------------
create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_log(p_action text, p_entity text, p_entity_id text, p_reason text, p_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare a_name text;
begin
  select coalesce(p.name, 'admin') into a_name
    from public.profiles p where p.user_id = auth.uid();
  insert into public.audit_log (admin_id, admin_name, action, entity, entity_id, reason, meta)
  values (auth.uid(), a_name, p_action, p_entity, p_entity_id, p_reason, p_meta);
end $$;

-- ----------------------------------------------------------------------------
-- 1. Gym claims
-- ----------------------------------------------------------------------------
/**
 * Approve or reject a claim on a gym.
 *
 * `p_status` is 'claimed' | 'pending' | 'unclaimed'. Approving requires an owner
 * profile; rejecting clears it, so a rejected claim does not leave the claimant
 * holding the panel.
 */
create or replace function public.admin_set_gym_claim(
  p_gym text, p_status text, p_owner uuid, p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.require_admin();
  if p_status not in ('claimed', 'pending', 'unclaimed') then
    raise exception 'bad_status';
  end if;
  if p_status = 'claimed' and p_owner is null then
    raise exception 'owner_required';
  end if;

  update public.gyms
     set claim_status = p_status,
         owner_id     = case when p_status = 'claimed' then p_owner else null end
   where id = p_gym;

  if not found then raise exception 'gym_not_found'; end if;

  perform public.admin_log('gym_claim', 'gym', p_gym, p_reason,
    jsonb_build_object('status', p_status, 'owner', p_owner));
end $$;

/** Publish or unpublish a gym. schema41 made user-created gyms start unlisted;
 *  this is the only way one can ever become visible. */
create or replace function public.admin_set_gym_listed(
  p_gym text, p_listed boolean, p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.require_admin();
  update public.gyms set listed = p_listed where id = p_gym;
  if not found then raise exception 'gym_not_found'; end if;
  perform public.admin_log(case when p_listed then 'gym_publish' else 'gym_unpublish' end,
                           'gym', p_gym, p_reason, jsonb_build_object('listed', p_listed));
end $$;

-- ----------------------------------------------------------------------------
-- 2. Trainer verification
-- ----------------------------------------------------------------------------
/**
 * `p_status` is 'approved' | 'rejected' | 'pending' | 'unverified'.
 * `verified` follows the status rather than being passed separately — the two
 * disagreeing is exactly how a badge outlives the decision behind it.
 */
create or replace function public.admin_set_trainer_verification(
  p_trainer text, p_status text, p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.require_admin();
  if p_status not in ('approved', 'rejected', 'pending', 'unverified') then
    raise exception 'bad_status';
  end if;

  update public.trainers
     set verify_status = p_status,
         verified      = (p_status = 'approved')
   where id = p_trainer;

  if not found then raise exception 'trainer_not_found'; end if;

  perform public.admin_log('trainer_verify', 'trainer', p_trainer, p_reason,
    jsonb_build_object('status', p_status));

  -- The badge is stamped onto feed rows at insert (schema47); rows that already
  -- exist are realigned here so a newly verified coach's older videos do not
  -- keep saying «unverified», and a revoked badge disappears everywhere at once.
  update public.feed_videos v
     set verified = (p_status = 'approved')
   where v.author_id::text = p_trainer;
end $$;

grant execute on function public.admin_set_gym_claim(text, text, uuid, text)   to authenticated;
grant execute on function public.admin_set_gym_listed(text, boolean, text)     to authenticated;
grant execute on function public.admin_set_trainer_verification(text, text, text) to authenticated;
revoke execute on function public.require_admin() from anon, authenticated;
revoke execute on function public.admin_log(text, text, text, text, jsonb) from anon, authenticated;
