-- ============================================================================
-- SPOT · schema56_verification_decision.sql
--
-- schema55 narrowed the UPDATE grant on `trainer_verifications` to the three
-- evidence columns, so a trainer can attach their own certificate without also
-- being handed `status`. That is right — but the ADMIN panel writes `status`,
-- `internal_note` and `reject_reason` on that same table through a plain
-- `.update()`, with the same `authenticated` role and the same column grants.
-- Narrowing the grant would break the moderator's own screen, exactly the way
-- schema50 found the gym and trainer trust columns already broken.
--
-- Column grants cannot ask «is this an admin». So the moderator's write goes the
-- same way the rest of schema50 went: one SECURITY DEFINER function that checks
-- `is_admin` itself, updates BOTH rows — the queue row and the trainer's badge —
-- and writes the audit entry. One call, one decision, no half-applied state
-- where a request leaves the queue without the badge following it.
--
-- Apply AFTER schema55_trainer_evidence.sql.
-- ============================================================================

/**
 * Decide one verification request.
 *
 * `p_status` is 'approved' | 'rejected' | 'pending'.
 * `p_note` is the moderator's internal note; `p_reason` is the rejection reason
 * shown to the trainer. Both optional, both only ever written by an admin.
 */
create or replace function public.admin_decide_verification(
  p_verification uuid, p_status text, p_note text default null, p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare v record;
begin
  perform public.require_admin();
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'bad_status';
  end if;
  if p_status = 'rejected' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required';
  end if;

  select * into v from public.trainer_verifications where id = p_verification;
  if v is null then raise exception 'verification_not_found'; end if;

  update public.trainer_verifications
     set status        = p_status,
         internal_note = coalesce(p_note, internal_note),
         reject_reason = case when p_status = 'rejected' then p_reason else null end
   where id = p_verification;

  -- The badge follows the decision in the same statement, so the queue can never
  -- empty without the trainer's row moving with it.
  if v.trainer_id is not null then
    update public.trainers
       set verify_status = p_status,
           verified      = (p_status = 'approved')
     where id = v.trainer_id;

    update public.feed_videos fv
       set verified = (p_status = 'approved')
     where fv.author_id::text = v.trainer_id;
  end if;

  perform public.admin_log('trainer_verify', 'trainer_verification', p_verification::text,
    coalesce(p_reason, p_note),
    jsonb_build_object('status', p_status, 'trainer_id', v.trainer_id));
end $$;

/** The moderator's private note, without a decision attached. */
create or replace function public.admin_set_verification_note(
  p_verification uuid, p_note text
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.require_admin();
  update public.trainer_verifications set internal_note = p_note where id = p_verification;
  if not found then raise exception 'verification_not_found'; end if;
  perform public.admin_log('trainer_verify_note', 'trainer_verification', p_verification::text, null, '{}'::jsonb);
end $$;

grant execute on function public.admin_decide_verification(uuid, text, text, text) to authenticated;
grant execute on function public.admin_set_verification_note(uuid, text)           to authenticated;
