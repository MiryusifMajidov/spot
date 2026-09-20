-- schema74 — check-in by QR, and the end of the GPS rule
--
-- Check-in used to be a distance test: the phone sent a coordinate and the
-- server allowed it within 150 m of the gym. The screen said out loud what was
-- wrong with that — «bu, zalda olduğunun sübutu deyil» — because the coordinate
-- comes from the phone, and a phone can be told to send any coordinate at all.
-- It also failed honestly for the wrong people: GPS is weak inside a concrete
-- building, so somebody standing at the reception desk got «Lokasiya vaxtında
-- gəlmədi» while somebody across the street did not.
--
-- A QR taped to the reception desk inverts it. The proof is no longer a number
-- the phone chose; it is a string only somebody who walked in can read.
--
-- WHERE THE CODE LIVES. Not on `public.gyms`: that table carries a TABLE-level
-- SELECT grant for `authenticated`, and a table grant makes any column-level
-- revoke useless — a new column there would be world-readable, which is exactly
-- the one thing the code must not be. It gets its own table, readable only by
-- the gym's owner, and the check-in function reads it with row security off.

-- ---------------------------------------------------------------- 1. the code
create table if not exists public.gym_checkin_codes (
  gym_id     text primary key references public.gyms(id) on delete cascade,
  code       text not null unique,
  rotated_at timestamptz not null default now()
);

alter table public.gym_checkin_codes enable row level security;

drop policy if exists gcc_owner_read on public.gym_checkin_codes;
create policy gcc_owner_read on public.gym_checkin_codes
  for select to authenticated
  using (
    exists (
      select 1 from public.gyms g
       where g.id = gym_checkin_codes.gym_id
         and g.owner_id = public.my_profile_id()
    )
  );

-- SELECT only, and RLS narrows it to the owner. Writes go through the RPC below
-- so a code can never be chosen by hand (a guessable code is a code everybody
-- can use from home).
revoke all on public.gym_checkin_codes from anon, authenticated;
grant select on public.gym_checkin_codes to authenticated;

-- ------------------------------------------------- 2. the owner makes / rotates
create or replace function public.gym_rotate_checkin_code(p_gym_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if not public.owns_gym(p_gym_id) then
    raise exception 'not_your_gym' using errcode = '42501';
  end if;

  -- 10 chars from a 32-symbol alphabet ≈ 10^15 possibilities. Rotating is how a
  -- gym invalidates a code somebody photographed and shared.
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.gym_checkin_codes (gym_id, code, rotated_at)
  values (p_gym_id, v_code, now())
  on conflict (gym_id) do update set code = excluded.code, rotated_at = now();

  return v_code;
end $$;

revoke all on function public.gym_rotate_checkin_code(text) from public, anon;
grant execute on function public.gym_rotate_checkin_code(text) to authenticated;

-- ------------------------------------------------------- 3. the member scans it
create or replace function public.check_in_with_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_profile uuid;
  v_gym     record;
  v_open    text;
  v_id      uuid;
begin
  select p.id into v_profile from public.profiles p where p.user_id = auth.uid();
  if v_profile is null then
    raise exception 'checkin_not_signed_in' using errcode = 'P0001';
  end if;

  if public.is_sanctioned(auth.uid()) then
    raise exception 'checkin_sanctioned' using errcode = 'P0001';
  end if;

  select g.id, g.name, g.hours into v_gym
    from public.gym_checkin_codes c
    join public.gyms g on g.id = c.gym_id
   where c.code = upper(trim(p_code));

  -- A wrong code and a code for a gym that has since been removed are the same
  -- thing to the person holding the phone: this QR does not open anything.
  if v_gym.id is null then
    raise exception 'checkin_bad_code' using errcode = 'P0001';
  end if;

  v_open := public.gym_open_now(v_gym.hours);
  if v_open = 'closed' then
    raise exception 'checkin_closed:%', coalesce(v_gym.hours, '') using errcode = 'P0001';
  end if;

  insert into public.check_ins (profile_id, gym_id)
  values (v_profile, v_gym.id)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'gym_id', v_gym.id, 'gym_name', v_gym.name);

exception
  -- The unique index is the authority on the daily cap, not a prior SELECT.
  when unique_violation then
    raise exception 'checkin_already_today' using errcode = 'P0001';
end $$;

revoke all on function public.check_in_with_code(text) from public, anon;
grant execute on function public.check_in_with_code(text) to authenticated;

-- ------------------------------------------------- 4. the distance rule is over
-- Left in place as a function rather than dropped, so an older build still on
-- somebody's phone fails with a plain «icazə yoxdur» instead of a missing-function
-- error it has no message for. Nothing may call it any more.
revoke all on function public.check_in(text, double precision, double precision) from public, anon, authenticated;
