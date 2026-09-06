-- ============================================================================
-- SPOT · schema49_block_enforcement.sql
--
-- schema38 made blocking real for profiles and match requests. It did NOT reach
-- messaging, and messaging arrived later (schema42) without it:
--
--   messages_send  WITH CHECK (sender_id = my_profile_id()
--                              AND in_thread(thread_id)
--                              AND NOT is_sanctioned(auth.uid()))
--
-- Membership, and nothing about blocks. So once a thread exists — and a thread
-- exists as soon as two people have matched — blocking the other person stops
-- nothing: they keep sending, the row lands, and `tg_notify_message` writes a
-- `message` notification straight into the blocker's inbox. The person who
-- pressed «Blok et» is told «qarşılıqlı gizlənirsiniz» and then keeps receiving
-- messages from exactly the person they blocked. In an app that sends people to
-- meet strangers in a gym, that is the safety feature failing in the one moment
-- it is used.
--
-- Blocking is symmetric here on purpose: neither direction may write once a
-- block exists in either direction. The thread and its history stay readable —
-- deleting somebody's record of what was said to them would be worse.
--
-- Apply AFTER schema48_checkin_privacy.sql.
-- ============================================================================

/** Is there a block, in either direction, between the two people in this
 *  thread? `blocked_between` (schema38/39) already answers for a pair; this
 *  resolves the pair from the thread. */
create or replace function public.thread_blocked(t uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.chat_threads th
     where th.id = t
       and public.blocked_between(th.a_profile, th.b_profile)
  );
$$;

grant execute on function public.thread_blocked(uuid) to authenticated;

drop policy if exists messages_send on public.messages;
create policy messages_send on public.messages
  for insert to authenticated
  with check (
    sender_id = public.my_profile_id()
    and public.in_thread(thread_id)
    and not public.is_sanctioned(auth.uid())
    and not public.thread_blocked(thread_id)
  );

-- Belt and braces, and in ONE place rather than eight: `notify()` is the single
-- door every trigger goes through (schema35), so the block check belongs there.
-- A blocked account could otherwise still like, follow or reply its way into the
-- blocker's inbox — the message trigger was only the loudest case.
create or replace function public.notify(
  p_profile uuid, p_actor uuid, p_type text, p_target text, p_entity text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile is null then return; end if;
  if p_actor is not null and p_actor = p_profile then return; end if;
  -- Blocked in either direction: the event may still be recorded, but it does
  -- not reach the person who asked not to hear from them.
  if p_actor is not null and public.blocked_between(p_actor, p_profile) then return; end if;
  if not public.notif_enabled(p_profile, p_type) then return; end if;
  insert into public.notifications (profile_id, actor_id, type, target_key, entity_id)
  values (p_profile, p_actor, p_type, p_target, p_entity);
end $$;
