-- APPLIED 2026-09-22 with the owner's approval. Proved (rolled back): a second message
-- before a reply -> wait_for_reply; after a block -> 'blocked'; while muted -> 'sanctioned'.
-- schema83: a refused message says WHY, and «one message until a reply» holds
-- under concurrency.
--
-- 1. messages_send's WITH CHECK refuses for two reasons that come back as the same
--    anonymous «new row violates row-level security policy»: a sanction on the
--    sender (is_sanctioned) or a block between the two people (thread_blocked).
--    The app had to guess, and told a blocked person in good standing «Hesabına
--    məhdudiyyət qoyulub» (independent review of 1.3.5). The BEFORE INSERT gate
--    now raises 'blocked' / 'sanctioned' by name first; the policy stays as the
--    backstop. The app's refusal map already matches both words.
--
-- 2. The gate counted the sender's earlier messages without a lock, so two first
--    messages sent at the same instant both saw «none yet» and both landed. It
--    now takes the thread row first — FOR NO KEY UPDATE, which does NOT conflict
--    with the KEY SHARE lock the messages→chat_threads FK check takes (schema82's
--    lesson) — so the second insert counts after the first has committed.

create or replace function public.messages_gate()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare other_replied boolean; mine int;
begin
  if public.thread_blocked(new.thread_id) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  if public.is_sanctioned(auth.uid()) then
    raise exception 'sanctioned' using errcode = '42501';
  end if;

  -- Serialise the «one message until a reply» count per thread.
  perform 1 from public.chat_threads where id = new.thread_id for no key update;

  select exists (
    select 1 from public.messages m
     where m.thread_id = new.thread_id and m.sender_id <> new.sender_id
  ) into other_replied;

  if not other_replied then
    select count(*) into mine from public.messages m
     where m.thread_id = new.thread_id and m.sender_id = new.sender_id;
    if mine >= 1 then
      raise exception 'wait_for_reply' using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;
