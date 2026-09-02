-- ============================================================================
-- SPOT · schema19_checkin_server_side.sql
--
-- The check-in gates lived only in src/app/(tabs)/workout/checkin.tsx: the
-- 150 m radius, the opening hours and the one-per-gym-day cap were all decided
-- on the phone, and then the phone inserted the row itself. Anyone with the
-- publishable key could POST straight into `check_ins` and appear "indi zalda"
-- from anywhere, any number of times a day. The streak, the live member count
-- and the gym owner's attendance list all rest on that table, so the honest
-- statement was the one already printed on the screen: «hələ serverdə
-- təsdiqlənmir».
--
-- This file moves the gates into the database. Apply AFTER schema18.
--
-- WHAT THIS DOES AND DOES NOT PROVE
--   The daily cap and the gym-day boundary become facts: they are computed from
--   `created_at`, which the client cannot set, and enforced by a unique index.
--   The distance is checked against the coordinates the phone REPORTS. That
--   stops a wrong gym, a stale pin and a careless client — it is not proof of
--   physical presence, because a modified client can report any position. Real
--   proof needs a QR code or a beacon at the gym. Nothing in the app may claim
--   more than this; the check-in screen's hint text says exactly the above.
--
-- PRIVACY
--   The reported position is an ARGUMENT, never a column. `checkins_gym_owner_read`
--   lets a gym owner read the check-in rows for their own gym; had the latitude
--   and longitude been stored, that policy would have handed every gym owner the
--   precise location of each member at check-in time. The RPC verifies the
--   coordinates and discards them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. The gym day (04:00 → 04:00, Asia/Baku) becomes a stored fact
--
--    Same boundary the streak engine uses (useDb.checkIn / gymDay). Generated
--    from created_at, so it cannot be spoofed by the client. `timezone(text,
--    timestamptz)` is immutable, which is what a generated column requires.
-- ----------------------------------------------------------------------------

-- The table currently holds one profile with five rows on a single day — test
-- check-ins from device work. Keep the first of each day, drop the repeats, or
-- the unique index below cannot be created.
delete from public.check_ins c
 using public.check_ins keep
 where c.profile_id = keep.profile_id
   and ((c.created_at at time zone 'Asia/Baku') - interval '4 hours')::date
     = ((keep.created_at at time zone 'Asia/Baku') - interval '4 hours')::date
   and (keep.created_at, keep.id) < (c.created_at, c.id);

alter table public.check_ins
  add column if not exists gym_day date
  generated always as (((created_at at time zone 'Asia/Baku') - interval '4 hours')::date) stored;

create unique index if not exists check_ins_one_per_gym_day
  on public.check_ins (profile_id, gym_day);

-- ----------------------------------------------------------------------------
-- 1. Metres between two WGS-84 points
--
--    Haversine, mirroring distanceM() in checkin.tsx. PostGIS is not installed
--    on this project and this is the only geodesic question we ask.
-- ----------------------------------------------------------------------------
create or replace function public.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- ----------------------------------------------------------------------------
-- 2. Is the gym open right now?
--
--    `gyms.hours` is free text the owner typed («6:00–24:00», «24 saat»). This
--    is the SQL twin of checkHours() and keeps the same three states. `unknown`
--    is deliberate and must NOT be treated as closed: refusing a check-in
--    because we could not read the text would punish the member for the owner's
--    typing. The screen tells the user when the hours went unchecked.
-- ----------------------------------------------------------------------------
create or replace function public.gym_open_now(raw text)
returns text            -- 'always' | 'open' | 'closed' | 'unknown'
language plpgsql
stable
as $$
declare
  txt   text := btrim(coalesce(raw, ''));
  m     text[];
  o     int;
  c     int;
  mins  int;
begin
  if txt = '' then return 'unknown'; end if;
  if txt ~* '24\s*/\s*7|24\s*saat|həmişə|hemise|24h' then return 'always'; end if;

  m := regexp_match(txt, '(\d{1,2})[:.](\d{2})\s*[–—−-]\s*(\d{1,2})[:.](\d{2})');
  if m is null then return 'unknown'; end if;

  o := m[1]::int * 60 + m[2]::int;
  c := m[3]::int * 60 + m[4]::int;
  if o = c then return 'always'; end if;

  mins := extract(hour from (now() at time zone 'Asia/Baku'))::int * 60
        + extract(minute from (now() at time zone 'Asia/Baku'))::int;

  -- A closing time at or past midnight (24:00, or 02:00 after a 22:00 open) wraps.
  if c > o then
    return case when mins >= o and mins < c then 'open' else 'closed' end;
  else
    return case when mins >= o or mins < c then 'open' else 'closed' end;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. The only way a check-in row can be created
--
--    Every refusal raises with a stable machine code so the client can print the
--    precise Azerbaijani reason instead of a generic «alınmadı». The numbers a
--    message carries (metres, the opening window) are the real measured values.
-- ----------------------------------------------------------------------------
create or replace function public.check_in(
  p_gym_id text,
  p_lat    double precision,
  p_lng    double precision
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid;
  v_gym     record;
  v_open    text;
  v_metres  double precision;
  v_id      uuid;
begin
  select p.id into v_profile from public.profiles p where p.user_id = auth.uid();
  if v_profile is null then
    raise exception 'checkin_not_signed_in' using errcode = 'P0001';
  end if;

  if public.is_sanctioned(auth.uid()) then
    raise exception 'checkin_sanctioned' using errcode = 'P0001';
  end if;

  select g.id, g.lat, g.lng, g.hours into v_gym
    from public.gyms g where g.id = p_gym_id;
  if v_gym.id is null then
    raise exception 'checkin_no_gym' using errcode = 'P0001';
  end if;

  -- Without a recorded address there is nothing to measure against. The client
  -- already refuses this case; the server must not be more permissive.
  if v_gym.lat is null or v_gym.lng is null then
    raise exception 'checkin_gym_no_coords' using errcode = 'P0001';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'checkin_no_position' using errcode = 'P0001';
  end if;

  v_metres := public.distance_m(p_lat, p_lng, v_gym.lat, v_gym.lng);
  if v_metres > 150 then
    raise exception 'checkin_too_far:%', round(v_metres)::bigint using errcode = 'P0001';
  end if;

  v_open := public.gym_open_now(v_gym.hours);
  if v_open = 'closed' then
    raise exception 'checkin_closed:%', coalesce(v_gym.hours, '') using errcode = 'P0001';
  end if;

  insert into public.check_ins (profile_id, gym_id)
  values (v_profile, p_gym_id)
  returning id into v_id;

  return v_id;

exception
  -- The unique index is the authority on the daily cap, not a prior SELECT:
  -- two phones pressing the button at once would both pass a read-then-write
  -- check and only this catch stops the second row.
  when unique_violation then
    raise exception 'checkin_already_today' using errcode = 'P0001';
end;
$$;

revoke all on function public.check_in(text, double precision, double precision) from public;
grant execute on function public.check_in(text, double precision, double precision) to authenticated;
grant execute on function public.gym_open_now(text) to anon, authenticated;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Close the direct write path
--
--    With INSERT revoked, the RPC above is the only door. UPDATE and DELETE go
--    too: a check-in is a record of something that happened, and the client has
--    never had a reason to rewrite or erase one. Reads are untouched — the
--    member's own history, the live count and the gym owner's list all keep
--    working through the existing SELECT policies.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on public.check_ins from anon, authenticated;

drop policy if exists check_ins_write on public.check_ins;
drop policy if exists checkins_self_insert on public.check_ins;
