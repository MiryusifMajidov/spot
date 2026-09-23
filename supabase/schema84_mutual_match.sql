-- schema84: two people who ask each other are a match, and one accept settles
-- both directions.
--
-- Found by the live multi-user run cq8rjw (2026-09-22): u4 and u5 sent each
-- other a partner request at the same instant. match_requests is directional
-- with one row per (from, to), so that is two rows. u5 accepted u4's row — and
-- u5's OWN row to u4 stayed «pending». The pair was half-open: u4 kept getting a
-- «Qəbul et» card from somebody it was already matched with, and because the
-- launch read has no ORDER BY, the next launch showed «accepted» or «incoming»
-- depending on which row the server happened to return last.
--
-- 1. tg_match_mutual: whenever a row becomes accepted, the opposite row (if any)
--    becomes accepted too. One pass only — the recursive call finds the other
--    row already accepted and stops.
-- 2. send_match_request: asking somebody who has already asked YOU is mutual
--    interest, so that row is written as accepted straight away and (1) settles
--    the other direction.
-- 3. tg_notify_match: a row INSERTED as accepted must not send «X wants to train
--    with you» — the mutual update in (1) sends «match_accepted» to the other
--    person, which is the true event.

create or replace function public.tg_match_mutual()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    update public.match_requests
       set status = 'accepted'
     where from_profile = new.to_profile
       and to_profile = new.from_profile
       and status is distinct from 'accepted';
  end if;
  return new;
end $function$;

drop trigger if exists match_requests_mutual on public.match_requests;
create trigger match_requests_mutual
  after insert or update on public.match_requests
  for each row execute function public.tg_match_mutual();

create or replace function public.tg_notify_match()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    -- A row born accepted is the second half of a mutual ask; the other
    -- direction's update (tg_match_mutual) sends «match_accepted».
    if new.status is distinct from 'accepted' then
      perform public.notify(new.to_profile, new.from_profile, 'match_request', null, new.id::text);
    end if;
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform public.notify(new.from_profile, new.to_profile, 'match_accepted', null, new.id::text);
  elsif new.status = 'pending' and old.status is distinct from 'pending' then
    -- A re-send after a decline: same row, new ask.
    perform public.notify(new.to_profile, new.from_profile, 'match_request', null, new.id::text);
  end if;
  return new;
end $function$;

create or replace function public.send_match_request(p_to uuid, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare me uuid; rid uuid; existing text; reverse_status text; new_status text;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'bad_target' using errcode = '22023'; end if;
  if public.is_sanctioned(auth.uid()) then raise exception 'sanctioned' using errcode = '42501'; end if;
  if public.blocked_between(me, p_to) then raise exception 'blocked' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_to) then
    raise exception 'no_such_profile' using errcode = '22023';
  end if;

  select status into existing from public.match_requests
   where from_profile = me and to_profile = p_to;

  -- An accepted match is not re-opened by tapping send again.
  if existing = 'accepted' then
    select id into rid from public.match_requests where from_profile = me and to_profile = p_to;
    return rid;
  end if;

  -- They already asked me: that is a match, not a second queue entry. The
  -- opposite row is settled by tg_match_mutual.
  select status into reverse_status from public.match_requests
   where from_profile = p_to and to_profile = me;
  new_status := case when reverse_status = 'pending' then 'accepted' else 'pending' end;

  insert into public.match_requests (from_profile, to_profile, note, status)
  values (me, p_to, nullif(btrim(coalesce(p_note, '')), ''), new_status)
  on conflict (from_profile, to_profile) do update
     set status = new_status,
         note = excluded.note,
         created_at = now()
  returning id into rid;

  return rid;
end $function$;
