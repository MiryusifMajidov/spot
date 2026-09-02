-- ============================================================================
-- SPOT · schema42_real_messaging.sql  (F-02)
--
-- Messaging did not work. `sendMessage` wrote into `useDb.threads`
-- (AsyncStorage) and nothing else; `public.messages` had no sender column, was
-- closed to every client by schema24, and `from('messages')` was called from
-- nowhere. So the partner flow died at its last step: request → accepted → chat
-- opens → you type → the other person never sees it. The screen said so
-- honestly, but a conversation you can write into and nobody receives is worse
-- than no conversation, because the sender waits for an answer.
--
-- This replaces it with a real two-sided model.
--
-- WHO MAY TALK TO WHOM. A thread is not something a client invents: it is opened
-- by `open_thread()`, which requires a relationship that already exists in the
-- database — an ACCEPTED partner match, or an ACCEPTED trainer request between
-- the two — and refuses if either side has blocked the other (schema38). So
-- «anyone can message anyone» is impossible by construction, not by UI.
--
-- THE ONE-MESSAGE GATE. The design's rule is «sual = 1 mesaj, cavab gələnə qədər
-- bağlı». Enforced by a trigger: until the other person has sent at least one
-- message in the thread, you may have exactly one unanswered message in it. That
-- is the anti-harassment rule, and it belongs in the database for the same
-- reason the check-in radius does — a rule only the client enforces is not a
-- rule.
--
-- Both tables were empty (the four seeded «tural» rows went in schema24), so the
-- old shape is dropped rather than migrated.
--
-- Apply AFTER schema41_gym_listing_review.sql.
-- ============================================================================

drop table if exists public.messages cascade;

-- ----------------------------------------------------------------------------
-- 1. Threads
--
--    `a_profile < b_profile` is enforced, so a pair has exactly one thread no
--    matter who opens it — no «two conversations with the same person».
-- ----------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id         uuid primary key default gen_random_uuid(),
  a_profile  uuid not null references public.profiles(id) on delete cascade,
  b_profile  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_threads_ordered check (a_profile < b_profile),
  constraint chat_threads_pair unique (a_profile, b_profile)
);

create index if not exists chat_threads_a on public.chat_threads (a_profile);
create index if not exists chat_threads_b on public.chat_threads (b_profile);

alter table public.chat_threads enable row level security;
revoke all on public.chat_threads from anon, authenticated;
grant select on public.chat_threads to authenticated;

drop policy if exists chat_threads_mine on public.chat_threads;
create policy chat_threads_mine on public.chat_threads
  for select to authenticated
  using (a_profile = public.my_profile_id() or b_profile = public.my_profile_id());

-- ----------------------------------------------------------------------------
-- 2. Messages
-- ----------------------------------------------------------------------------
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.chat_threads(id) on delete cascade,
  -- The real sender. The old table had `from_me boolean`, decided by the client,
  -- which identifies nobody and let any writer claim either side.
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists messages_thread on public.messages (thread_id, created_at);
create index if not exists messages_unread on public.messages (thread_id) where read_at is null;

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;
-- Only the RECIPIENT marks a message read, so `read_at` is the one updatable column.
grant update (read_at) on public.messages to authenticated;

create or replace function public.in_thread(t uuid)
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
       and (th.a_profile = public.my_profile_id() or th.b_profile = public.my_profile_id())
  );
$$;

grant execute on function public.in_thread(uuid) to authenticated;

drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
  for select to authenticated
  using (public.in_thread(thread_id));

drop policy if exists messages_send on public.messages;
create policy messages_send on public.messages
  for insert to authenticated
  with check (
    sender_id = public.my_profile_id()
    and public.in_thread(thread_id)
    and not public.is_sanctioned(auth.uid())
  );

-- Marking read is only for the person who RECEIVED it.
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update to authenticated
  using (public.in_thread(thread_id) and sender_id <> public.my_profile_id())
  with check (public.in_thread(thread_id) and sender_id <> public.my_profile_id());

-- ----------------------------------------------------------------------------
-- 3. «Sual = 1 mesaj, cavab gələnə qədər bağlı»
-- ----------------------------------------------------------------------------
create or replace function public.messages_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare other_replied boolean; mine int;
begin
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
end $$;

drop trigger if exists messages_one_until_reply on public.messages;
create trigger messages_one_until_reply
  before insert on public.messages
  for each row execute function public.messages_gate();

-- ----------------------------------------------------------------------------
-- 4. Opening a thread requires a relationship that already exists
-- ----------------------------------------------------------------------------
create or replace function public.open_thread(other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare me uuid; lo uuid; hi uuid; tid uuid;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if other is null or other = me then raise exception 'bad_target' using errcode = '22023'; end if;

  if public.blocked_between(me, other) then
    raise exception 'blocked' using errcode = '42501';
  end if;

  -- An accepted partner match, or an accepted trainer link in either direction.
  if not public.has_relationship_with(other) then
    raise exception 'no_relationship' using errcode = '42501';
  end if;

  lo := least(me, other); hi := greatest(me, other);
  select id into tid from public.chat_threads where a_profile = lo and b_profile = hi;
  if tid is null then
    insert into public.chat_threads (a_profile, b_profile) values (lo, hi) returning id into tid;
  end if;
  return tid;
end $$;

revoke all on function public.open_thread(uuid) from public;
grant execute on function public.open_thread(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. A new message is a notification, like every other real event (schema35)
-- ----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment_like','comment_reply','mention','match_request',
                  'match_accepted','trainer_request','trainer_decided',
                  'review_reply','message'));

create or replace function public.tg_notify_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare recipient uuid;
begin
  select case when th.a_profile = new.sender_id then th.b_profile else th.a_profile end
    into recipient
    from public.chat_threads th where th.id = new.thread_id;
  perform public.notify(recipient, new.sender_id, 'message', null, new.thread_id::text);
  return new;
end $$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.tg_notify_message();

-- ----------------------------------------------------------------------------
-- 6. Realtime, so the other side sees it without reopening the screen
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
