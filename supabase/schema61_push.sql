-- ============================================================================
-- SPOT · schema61_push.sql
--
-- SPOT has had a notification system since schema35 — a `notifications` table, a
-- `notify()` funnel, per-type preferences, a notification centre — and none of it
-- ever reached a phone that was not already open on the right screen. Every
-- notification in this app is a row somebody has to come back and look for.
--
-- That breaks the product in the places it matters most:
--   · a match request expires unseen, because the other person never learns it
--     exists;
--   · a trainer answers a student and the student finds out days later;
--   · a gym owner's claim is approved and nobody tells them.
-- Each of those is a conversation the app promised to carry and then dropped.
--
-- WHAT THIS DOES. The push goes out from the database, at the same moment the
-- notification row is written, with no server in between: `pg_net` posts to
-- Expo's push service directly from `notify()`. Nothing else in SPOT changes —
-- the same `notify()` funnel, the same block check, the same per-type
-- preferences. A person who turned «match_request» off gets neither the row nor
-- the push, because it is one decision in one place.
--
-- WHAT A PUSH SAYS. A name and what happened. Never the content: not the message
-- text, not the comment, not the review. A lock screen is read by whoever is
-- holding the phone, and SPOT's own rule is that a chat is between two people.
-- The text is in the app, behind the person's own unlock.
--
-- Apply AFTER schema60_challenges_real.sql.
-- Requires the client half: src/lib/push.ts registers the token.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. Where a phone says «reach me here»
--
-- The TOKEN is the primary key, not the profile: one person has several devices,
-- and one device can be handed to somebody else. Re-registering an existing token
-- under a new profile moves it, so the previous owner of a borrowed phone stops
-- receiving notifications on it — which is the behaviour the privacy rules
-- require.
-- ----------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token      text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform   text check (platform in ('ios','android','web')),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_profile_idx on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- A token is a device address. Only its owner may see it, and nobody may read
-- somebody else's — a list of another person's devices is not information this
-- app hands out.
drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens
  for all to authenticated
  using (profile_id = public.my_profile_id())
  with check (profile_id = public.my_profile_id());

comment on table public.push_tokens is
  'Expo push tokens, one row per device. Owner-only under RLS. Deleted by the client on sign-out, and by ON DELETE CASCADE when the account goes.';

-- ----------------------------------------------------------------------------
-- 2. What the phone is told
--
-- Azerbaijani, short, and never the content of anything. `actor` is the person
-- who caused it; when we do not know their name the sentence still works.
-- ----------------------------------------------------------------------------
create or replace function public.push_text(p_type text, p_actor_name text)
returns text[]
language sql
immutable
as $$
  select case p_type
    when 'message'         then array['Yeni mesaj',        coalesce(p_actor_name,'Kimsə') || ' sənə mesaj yazdı']
    when 'match_request'   then array['Məşq təklifi',      coalesce(p_actor_name,'Kimsə') || ' səninlə məşq etmək istəyir']
    when 'match_accepted'  then array['Təklif qəbul edildi', coalesce(p_actor_name,'Yoldaşın') || ' təklifini qəbul etdi']
    when 'trainer_request' then array['Yeni şagird sorğusu', coalesce(p_actor_name,'Kimsə') || ' səninlə işləmək istəyir']
    when 'trainer_decided' then array['Məşqçi cavab verdi', coalesce(p_actor_name,'Məşqçi') || ' sorğuna cavab verdi']
    when 'comment_reply'   then array['Şərhinə cavab',     coalesce(p_actor_name,'Kimsə') || ' şərhinə cavab yazdı']
    when 'comment_like'    then array['Şərhini bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' şərhini bəyəndi']
    when 'mention'         then array['Səni qeyd etdilər', coalesce(p_actor_name,'Kimsə') || ' səni şərhdə qeyd etdi']
    when 'review_reply'    then array['Rəyinə cavab',      coalesce(p_actor_name,'Zal') || ' rəyinə cavab yazdı']
    when 'video_like'      then array['Videonu bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' videonu bəyəndi']
    when 'post_like'       then array['Paylaşımını bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' paylaşımını bəyəndi']
    when 'follow'          then array['Yeni izləyici',     coalesce(p_actor_name,'Kimsə') || ' səni izləməyə başladı']
    else array['SPOT', 'Yeni bildiriş var']
  end;
$$;

comment on function public.push_text is
  'Push title and body per notification type. Carries a name and an event, never content: no message text, no comment, no review body. A lock screen is read by whoever holds the phone.';

-- ----------------------------------------------------------------------------
-- 3. Send it
--
-- pg_net queues the request on a background worker, so this does not block — or
-- fail — the transaction that produced the notification. Everything is wrapped
-- anyway: a push that cannot go out must never roll back the notification row,
-- which is the copy the person will still find in the app.
-- ----------------------------------------------------------------------------
create or replace function public.push_send(
  p_profile uuid, p_title text, p_body text, p_data jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', p_title,
           'body', p_body,
           'sound', 'default',
           'channelId', 'default',
           'data', coalesce(p_data, '{}'::jsonb)))
    into msgs
    from public.push_tokens t
   where t.profile_id = p_profile
     -- Expo's own format. A row that is not one cannot be delivered, and posting
     -- it would only get the whole batch rejected.
     and t.token ~ '^Expo(nent)?PushToken\[.+\]$';

  if msgs is null then return; end if;

  perform net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json'),
    body    := msgs
  );
exception when others then
  -- Deliberately swallowed. The notification row is already written; a failed
  -- push must not take it down with it.
  return;
end $$;

revoke all on function public.push_send(uuid, text, text, jsonb) from public;

comment on function public.push_send is
  'Post one Expo push per registered device of a profile. Failures are swallowed on purpose: the in-app notification row is the record, and it must survive a push that could not be sent.';

-- ----------------------------------------------------------------------------
-- 4. The one funnel every notification already goes through
--
-- No new call sites. `notify()` is where the block check and the per-type
-- preference already live, so a push obeys both by construction — there is no
-- second path that could disagree with the first.
-- ----------------------------------------------------------------------------
create or replace function public.notify(
  p_profile uuid, p_actor uuid, p_type text, p_target text, p_entity text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor_name text; txt text[]; nid uuid;
begin
  if p_profile is null then return; end if;
  if p_actor is not null and p_actor = p_profile then return; end if;
  -- Blocked in either direction: the event may still be recorded, but it does
  -- not reach the person who asked not to hear from them.
  if p_actor is not null and public.blocked_between(p_actor, p_profile) then return; end if;
  if not public.notif_enabled(p_profile, p_type) then return; end if;

  insert into public.notifications (profile_id, actor_id, type, target_key, entity_id)
  values (p_profile, p_actor, p_type, p_target, p_entity)
  returning id into nid;

  select name into actor_name from public.profiles where id = p_actor;
  txt := public.push_text(p_type, actor_name);

  perform public.push_send(
    p_profile, txt[1], txt[2],
    -- `actor` is what the tap handler needs to open a chat or a profile: it is
    -- the same field `notifTarget()` reads in the app, so a tapped push and a
    -- tapped row in the notification centre land on exactly the same screen.
    jsonb_build_object('type', p_type, 'target', p_target, 'entity', p_entity,
                       'actor', p_actor, 'id', nid)
  );
end $$;

comment on function public.notify is
  'The single place a notification is created. Writes the row AND sends the push, so the block check and the per-type preference above cannot be bypassed by one path and honoured by the other.';
