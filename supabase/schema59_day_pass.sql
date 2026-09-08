-- ============================================================================
-- SPOT · schema59_day_pass.sql
--
-- The day-pass is the one place in SPOT where the app prints a code and tells a
-- person to show it to a stranger. Today that code is a lie in four ways.
--
-- 1. NOBODY CAN CHECK IT. `src/app/(tabs)/discover/gym/[id].tsx` prints
--    «Resepsiyada bu kodu göstər», and there is no screen, RPC or panel anywhere
--    in this repo where a gym can look a code up. The receptionist is being asked
--    to trust six characters rendered by the visitor's own phone.
--
-- 2. THE VISITOR'S PHONE INVENTS IT. `buyDayPass` builds the code with
--    Math.random() on the client and INSERTs it directly — and writes `price`
--    itself too. So the number the owner panel counts as a real registration is
--    whatever the client typed, and anyone could write a pass for any gym at any
--    price. Server-generated now; the price is read from `gyms.day_pass`.
--
-- 3. THE CODE DIES ON NAVIGATION. It lives only in `useState`. Leave the screen
--    and the code is gone — while the row stays in the database, so the button
--    offers to register a second one. A person who bought a pass, backed out to
--    check the gym hours, and came back has lost the thing they were told to show
--    at the door.
--
-- 4. NOTHING EVER ENDS A PASS. `expires_at` is set to 23:59 and then no code path
--    reads it: `getGymDayPasses` counts every pass ever created under
--    «Qeydə alınan day-pass», and schema58 had to drop `daypass_active` from the
--    admin dashboard for exactly this reason.
--
-- This migration makes the pass real end to end: created by the server, readable
-- back by its owner, verifiable and redeemable by the gym, and bounded in time.
--
-- MONEY: unchanged, and deliberately so. SPOT charges nothing and holds nothing.
-- `price` is copied from the gym's own informational figure so the panel cannot
-- be fed a fake one; it is never summed, never displayed as income, and no
-- commission column exists (schema27 dropped it).
--
-- PRIVACY: `redeem_day_pass` and `check_day_pass` return the pass and NOTHING
-- about the person holding it — no name, no profile id, no history. Reception
-- needs to know the code is good, not who the visitor is. The person is standing
-- there; the database does not need to introduce them.
--
-- Apply AFTER schema58_admin_dashboard.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. When a pass was actually honoured at the door
-- ----------------------------------------------------------------------------
alter table public.day_passes add column if not exists used_at timestamptz;

comment on column public.day_passes.status is
  'Redemption state only: active (issued, not yet shown) or used (honoured at reception); refunded is admin-only. Expiry is NOT stored here — nothing sweeps this column — so every read must pair status = ''active'' with expires_at > now().';

comment on column public.day_passes.price is
  'The gym''s own informational day-pass price, copied from gyms.day_pass by create_day_pass. SPOT collects nothing: the visitor pays the gym at the door. Never summed into a total anywhere.';

-- ----------------------------------------------------------------------------
-- 1. Only the server may issue a pass
--
-- `dp_user_insert` (schema5) let any signed-in client write a day_passes row with
-- a code and a price of its choosing. Both are facts about the gym, not about the
-- client, so both move to the server. The RPC is now the only way in.
-- ----------------------------------------------------------------------------
drop policy if exists dp_user_insert on public.day_passes;
revoke insert on public.day_passes from anon, authenticated;

create or replace function public.create_day_pass(g_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  me uuid;
  gym_price numeric(10,2);
  existing public.day_passes%rowtype;
  new_code text;
  ends timestamptz;
  tries int := 0;
begin
  me := auth.uid();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;

  select day_pass into gym_price from public.gyms where id = g_id;
  if not found then raise exception 'no_such_gym' using errcode = '22023'; end if;

  -- One live pass per person per gym. Pressing the button again returns the pass
  -- that already exists instead of stacking rows the owner would read as
  -- separate visitors — and it is how a person recovers a code they lost.
  select * into existing from public.day_passes
   where user_id = me and gym_id = g_id and status = 'active' and expires_at > now()
   order by purchased_at desc limit 1;
  if found then
    return jsonb_build_object(
      'code', existing.code, 'expires_at', existing.expires_at,
      'price', existing.price, 'reused', true);
  end if;

  -- Valid until the end of the day in Baku, where the gym and the visitor are.
  -- `date_trunc('day', now())` would end the pass at 04:00 local, because the
  -- database runs in UTC.
  ends := ((now() at time zone 'Asia/Baku')::date + 1)::timestamp - interval '1 second';
  ends := ends at time zone 'Asia/Baku';

  -- No 0/O/1/I/5/S: the code is read off one screen and typed into another by a
  -- person who is not being paid to be careful about it.
  loop
    new_code := '';
    for _i in 1..6 loop
      new_code := new_code || substr('23467892ABCDEFGHJKLMNPQRTUVWXYZ',
                                     1 + floor(random() * 31)::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.day_passes
       where code = new_code and status = 'active' and expires_at > now());
    tries := tries + 1;
    if tries > 20 then raise exception 'code_collision' using errcode = '40001'; end if;
  end loop;

  insert into public.day_passes (user_id, gym_id, code, price, status, expires_at)
  values (me, g_id, new_code, coalesce(gym_price, 0), 'active', ends);

  return jsonb_build_object(
    'code', new_code, 'expires_at', ends, 'price', coalesce(gym_price, 0), 'reused', false);
end $$;

revoke all on function public.create_day_pass(text) from public;
grant execute on function public.create_day_pass(text) to authenticated;

comment on function public.create_day_pass is
  'Issue (or return) today''s day-pass for the caller at one gym. Code and price come from the server, never the client. Idempotent while a pass is live, so the button cannot stack rows and a lost code can be recovered.';

-- ----------------------------------------------------------------------------
-- 2. Reception can look a code up — without learning who is holding it
--
-- Two functions on purpose. A single verify-and-burn call means one typo turns a
-- stranger's valid pass into a used one, so checking is separate from honouring
-- it and the panel asks before it writes.
-- ----------------------------------------------------------------------------
create or replace function public.check_day_pass(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare p public.day_passes%rowtype; c text;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  c := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(c) < 4 then raise exception 'bad_code' using errcode = '22023'; end if;

  -- `owns_gym` is the whole authorisation: a code is only ever visible to the
  -- gym it was issued for. Not finding it and it belonging to another gym look
  -- identical from here, which is the point — this is not a lookup oracle.
  select * into p from public.day_passes
   where code = c and public.owns_gym(gym_id)
   order by purchased_at desc limit 1;
  if not found then return jsonb_build_object('state', 'not_found'); end if;

  return jsonb_build_object(
    'state', case
               when p.status = 'used'     then 'used'
               when p.status = 'refunded' then 'refunded'
               when p.expires_at <= now() then 'expired'
               else 'valid' end,
    'gym_id', p.gym_id,
    'price', p.price,
    'purchased_at', p.purchased_at,
    'expires_at', p.expires_at,
    'used_at', p.used_at);
end $$;

revoke all on function public.check_day_pass(text) from public;
grant execute on function public.check_day_pass(text) to authenticated;

comment on function public.check_day_pass is
  'Reception lookup for a day-pass code at a gym the caller owns. Returns the pass state and nothing about the visitor — no name, no profile, no history. Changes nothing.';

create or replace function public.redeem_day_pass(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare p public.day_passes%rowtype; c text;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  c := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(c) < 4 then raise exception 'bad_code' using errcode = '22023'; end if;

  select * into p from public.day_passes
   where code = c and public.owns_gym(gym_id)
   order by purchased_at desc limit 1;
  if not found then return jsonb_build_object('state', 'not_found'); end if;

  if p.status = 'used' then
    return jsonb_build_object('state', 'used', 'used_at', p.used_at, 'gym_id', p.gym_id);
  end if;
  if p.status = 'refunded' then
    return jsonb_build_object('state', 'refunded', 'gym_id', p.gym_id);
  end if;
  if p.expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'expires_at', p.expires_at, 'gym_id', p.gym_id);
  end if;

  update public.day_passes set status = 'used', used_at = now() where id = p.id;

  return jsonb_build_object(
    'state', 'redeemed', 'gym_id', p.gym_id, 'price', p.price, 'used_at', now());
end $$;

revoke all on function public.redeem_day_pass(text) from public;
grant execute on function public.redeem_day_pass(text) to authenticated;

comment on function public.redeem_day_pass is
  'Mark a day-pass honoured at the door. Owner-only, one-way, and it reports the exact reason when it refuses (already used, expired, unknown) rather than failing silently.';

-- ----------------------------------------------------------------------------
-- 3. An index for the lookup reception actually performs
-- ----------------------------------------------------------------------------
create index if not exists day_passes_code_idx on public.day_passes (code);
create index if not exists day_passes_user_live_idx
  on public.day_passes (user_id, gym_id, expires_at desc) where status = 'active';
