-- APPLIED 2026-09-22. Proved (rolled back): a verification request for another
-- trainer's listing -> 42501, for the caller's own -> allowed; create_day_pass on a
-- gym with allow_day_pass=false -> 'day_pass_off', with it on -> a pass is issued.
-- schema79: two server-side holes found while fixing the trainer and gym panels.
--
-- 1. tv_insert only checked `auth.uid() = user_id`, so any signed-in person could
--    file a verification request against ANY trainer_id. The stamp trigger forces
--    'pending', so nobody could grant themselves a badge, but the request lands in
--    the admin queue under the victim's listing, and admin_decide_verification
--    moves the VICTIM's trainers row with the decision: a rejected junk request
--    strips a real trainer's badge and unverifies all of their feed videos.
--    The insert now also has to be for a listing the caller owns.
--    (trainer_id is not in the authenticated UPDATE grant, so tv_own_evidence
--    cannot be used to move a row to someone else's listing afterwards.)
--    Live check before this change: 0 rows filed against a foreign listing,
--    0 rows with a null trainer_id — nothing existing is invalidated.
--
-- 2. create_day_pass never read gyms.allow_day_pass. The owner's new switch hid
--    the button, but a direct RPC call still registered a pass at a gym that had
--    turned day passes off, and the owner's panel would count that visitor.
--    A pass that already exists is still returned (it was issued while day
--    passes were on and is how a person recovers a lost code); only a NEW pass
--    is refused.

drop policy if exists tv_insert on public.trainer_verifications;
create policy tv_insert on public.trainer_verifications
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and trainer_id is not null
    and public.owns_trainer(trainer_id)
  );

create or replace function public.create_day_pass(g_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare
  me uuid;
  gym_price numeric(10,2);
  gym_allows boolean;
  existing public.day_passes%rowtype;
  new_code text;
  ends timestamptz;
  tries int := 0;
begin
  me := auth.uid();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;

  select day_pass, allow_day_pass into gym_price, gym_allows from public.gyms where id = g_id;
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

  -- The owner switched day passes off. The app hides the button; this is the
  -- part a direct RPC call cannot get around. NULL is the column default's
  -- meaning (on), as the app reads it.
  if gym_allows = false then
    raise exception 'day_pass_off' using errcode = 'P0001';
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
end $function$;
