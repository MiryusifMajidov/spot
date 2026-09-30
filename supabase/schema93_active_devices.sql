-- schema93 — «Aktiv cihazlar» (Parametrlər → Hesab)
--
-- A linked account can be open on several phones at once, and nothing showed
-- which: no list, no way to end a session on a phone that was lost, sold or
-- lent. And «Hesabdan çıx» called supabase.auth.signOut() with its default
-- scope, 'global', so leaving on ONE phone silently ended the account on every
-- other one as well.
--
-- The list is Supabase's own `auth.sessions` — the thing a sign-out actually
-- ends — read through SECURITY DEFINER functions scoped to auth.uid(). Nothing
-- in auth is exposed to the client directly.
--
-- 1. session_devices: what each session is (model, OS, app version), written by
--    the app for its OWN session only — the session id comes from the JWT, never
--    from an argument. auth.sessions alone knows only a user-agent («okhttp/4»),
--    which cannot tell a person which of their phones a row is.
-- 2. touch_my_device(): the app's heartbeat. Returns false once this session no
--    longer exists (null when the token carries no session to check), so a phone that was signed out from another one finds out the
--    next time it is opened instead of up to an hour later (the access token's
--    lifetime), and clears itself.
-- 3. my_devices(): the list, current session first.
-- 4. revoke_my_session(p_session): end ONE other session, or every other one
--    (null). The current session is refused — that is «Hesabdan çıx», which also
--    wipes the phone. Deleting from auth.sessions cascades to its refresh tokens,
--    so that phone cannot renew its access.
-- 5. push_tokens.session_id: a revoked phone must stop receiving this account's
--    pushes, so each push address remembers the session that registered it and
--    is deleted with it. register_push_token() fills it from the JWT, which also
--    covers app versions released before this file.

-- ----------------------------------------------------------- 1. session_devices
create table if not exists public.session_devices (
  session_id   uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  platform     text not null check (platform in ('ios', 'android', 'web', 'other')),
  device_name  text check (char_length(device_name) <= 80),
  os_version   text check (char_length(os_version) <= 40),
  app_version  text check (char_length(app_version) <= 20),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists session_devices_user_idx on public.session_devices (user_id);

alter table public.session_devices enable row level security;
-- No policies and no grants: only the functions below read or write it.
revoke all on public.session_devices from anon, authenticated;

comment on table public.session_devices is
  'What each auth session is (model, OS, app version), for Parametrlər → Aktiv cihazlar (schema93). Written by touch_my_device() for the caller''s own session only; read by my_devices().';

-- ----------------------------------------------------------- 5. push_tokens
alter table public.push_tokens add column if not exists session_id uuid;
create index if not exists push_tokens_session_idx on public.push_tokens (session_id);

comment on column public.push_tokens.session_id is
  'The auth session that registered this address (from the JWT). revoke_my_session() deletes the addresses of the sessions it ends (schema93).';

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path to 'public'
set row_security to 'off'
as $function$
declare me uuid;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then
    raise exception 'bad_token' using errcode = '22023';
  end if;
  if p_platform is not null and p_platform not in ('ios','android','web') then
    raise exception 'bad_platform' using errcode = '22023';
  end if;

  -- The row may belong to the phone's previous owner. Moving it is the whole
  -- point: schema61 promises that a handed-over phone stops delivering to them.
  -- schema93: the session goes with it, so ending that session ends its pushes.
  insert into public.push_tokens (token, profile_id, platform, session_id, updated_at)
  values (p_token, me, p_platform, nullif(auth.jwt() ->> 'session_id', '')::uuid, now())
  on conflict (token) do update
     set profile_id = excluded.profile_id,
         platform   = excluded.platform,
         session_id = excluded.session_id,
         updated_at = now();
end $function$;

-- ----------------------------------------------------------- 2. touch_my_device
create or replace function public.touch_my_device(
  p_platform text,
  p_device text,
  p_os text,
  p_app text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  -- null, not false: «cannot tell» must never read as «signed out elsewhere».
  if v_uid is null or v_sid is null then
    return null;
  end if;
  -- Ended elsewhere (Aktiv cihazlar on another phone): the access token still
  -- verifies until it expires, the session behind it does not exist.
  if not exists (select 1 from auth.sessions s where s.id = v_sid and s.user_id = v_uid) then
    return false;
  end if;

  insert into public.session_devices as d (session_id, user_id, platform, device_name, os_version, app_version)
  values (
    v_sid,
    v_uid,
    case when p_platform in ('ios', 'android', 'web') then p_platform else 'other' end,
    nullif(left(btrim(p_device), 80), ''),
    nullif(left(btrim(p_os), 40), ''),
    nullif(left(btrim(p_app), 20), '')
  )
  on conflict (session_id) do update
     set platform     = excluded.platform,
         device_name  = excluded.device_name,
         os_version   = excluded.os_version,
         app_version  = excluded.app_version,
         last_seen_at = now()
   where d.user_id = v_uid;

  -- Rows whose session ended some other way (a sign-out, an expiry) go too.
  delete from public.session_devices d
   where d.user_id = v_uid
     and not exists (select 1 from auth.sessions s where s.id = d.session_id);

  return true;
end $function$;

-- ----------------------------------------------------------- 3. my_devices
create or replace function public.my_devices()
returns table (
  session_id     uuid,
  is_current     boolean,
  platform       text,
  device_name    text,
  os_version     text,
  app_version    text,
  user_agent     text,
  signed_in_at   timestamptz,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  with me as (
    select auth.uid() as uid, nullif(auth.jwt() ->> 'session_id', '')::uuid as sid
  )
  select s.id,
         s.id = me.sid,
         d.platform,
         d.device_name,
         d.os_version,
         d.app_version,
         left(s.user_agent, 200),
         s.created_at,
         -- refreshed_at is a UTC wall-clock without a zone in auth.sessions.
         greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'utc', d.last_seen_at)
    from me
    join auth.sessions s on s.user_id = me.uid
    left join public.session_devices d on d.session_id = s.id
   where me.uid is not null
     and (s.not_after is null or s.not_after > now())
   order by (s.id = me.sid) desc,
            greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'utc', d.last_seen_at) desc;
$function$;

-- ----------------------------------------------------------- 4. revoke_my_session
create or replace function public.revoke_my_session(p_session uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_ids uuid[];
begin
  if v_uid is null or v_sid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_session = v_sid then
    raise exception 'current_session' using errcode = '22023';
  end if;

  select array_agg(s.id) into v_ids
    from auth.sessions s
   where s.user_id = v_uid
     and s.id <> v_sid
     and (p_session is null or s.id = p_session);

  if v_ids is null then
    return 0;
  end if;

  delete from public.push_tokens t where t.session_id = any (v_ids);
  delete from public.session_devices d where d.session_id = any (v_ids);
  delete from auth.sessions s where s.id = any (v_ids) and s.user_id = v_uid;
  return cardinality(v_ids);
end $function$;

revoke all on function public.touch_my_device(text, text, text, text) from public, anon;
revoke all on function public.my_devices() from public, anon;
revoke all on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.touch_my_device(text, text, text, text) to authenticated;
grant execute on function public.my_devices() to authenticated;
grant execute on function public.revoke_my_session(uuid) to authenticated;
