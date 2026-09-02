-- ============================================================================
-- SPOT · schema28_request_decisions.sql
--
-- `tr_update` is `USING (owns_trainer(trainer_id) OR owns_profile(from_profile))`,
-- so the STUDENT could set their own request to `accepted`. Verified live:
--
--   student inserts request                 -> ok
--   student sets status = 'accepted'        -> ACCEPTED
--   trainer's `clients` counter             -> 1
--
-- A stranger could therefore appear on any coach's roster and, since schema27
-- made `clients` a real count, inflate their advertised student number too. The
-- INSERT policy has no status condition either, so the row could simply be
-- created `accepted` in the first place.
--
-- Column grants cannot fix this one: the trainer and the student are both
-- `authenticated`, so `status` cannot be granted to one and withheld from the
-- other. RLS cannot see the old row either. A BEFORE trigger can do both.
--
-- The rule:
--   · the TRAINER decides — any status;
--   · the STUDENT may only ever put a request into `pending`, which is what
--     asking (and asking again after a refusal) means;
--   · a new row starts `pending` unless the trainer is the one creating it.
--
-- `decided_at` follows the decision rather than the client's clock, so the
-- timestamp on a decision is the moment the database recorded it.
--
-- Apply AFTER schema27_trust_columns.sql.
-- ============================================================================

create or replace function public.trainer_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare is_trainer boolean;
begin
  is_trainer := public.owns_trainer(new.trainer_id);

  if tg_op = 'INSERT' then
    if not is_trainer and coalesce(new.status, 'pending') <> 'pending' then
      raise exception 'trainer_request_must_start_pending' using errcode = '42501';
    end if;
    if is_trainer then new.decided_at := now(); end if;
    return new;
  end if;

  -- UPDATE
  if new.status is distinct from old.status then
    if is_trainer then
      new.decided_at := now();
    elsif public.owns_profile(new.from_profile) and new.status = 'pending' then
      -- Asking again after «rədd edildi» is the student's to do; nothing else is.
      new.decided_at := null;
    else
      raise exception 'only_the_trainer_decides' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trainer_requests_guard_status on public.trainer_requests;
create trigger trainer_requests_guard_status
  before insert or update on public.trainer_requests
  for each row execute function public.trainer_requests_guard();

-- Any row that reached `accepted` without a trainer's decision would be a
-- fabricated student. There are none today (the only accepted rows came from
-- rolled-back tests), but the check runs so the state is never assumed.
do $$
declare n int;
begin
  select count(*) into n
    from public.trainer_requests r
   where r.status = 'accepted' and r.decided_at is null;
  if n > 0 then
    raise notice 'DİQQƏT: qərar vaxtı olmayan % qəbul edilmiş sorğu var — yoxla', n;
  end if;
end $$;
