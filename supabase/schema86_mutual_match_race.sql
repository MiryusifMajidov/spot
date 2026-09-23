-- schema86: the mutual-match check must also hold when both asks land in the
-- same instant.
--
-- schema84 made «you ask somebody who already asked you» a match by reading the
-- opposite row inside send_match_request. The live run eb6evp (2026-09-23) shows
-- the hole: when the two asks are truly simultaneous, each transaction reads the
-- other direction BEFORE the other has committed, both see nothing to answer,
-- and both rows stay «pending» — exactly the half-open pair schema84 was written
-- to end (one accept then leaves the other direction pending, and the next
-- launch shows «accepted» or «incoming» depending on which row comes back last).
--
-- The two transactions now queue on the PAIR. pg_advisory_xact_lock takes no row
-- lock, so it cannot collide with the FOR KEY SHARE lock a foreign-key check
-- takes on profiles (the mistake schema82's first version made); it is released
-- when the transaction ends. The key is built from the two profile ids in a
-- fixed order, so both directions hash to the same lock.
--
-- The second transaction then re-reads on a fresh snapshot (READ COMMITTED gives
-- every statement its own), sees the first row, and writes its own as accepted;
-- tg_match_mutual settles the first one.

create or replace function public.send_match_request(p_to uuid, p_note text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare me uuid; rid uuid; existing text; reverse_status text; new_status text; lo uuid; hi uuid;
begin
  me := public.my_profile_id();
  if me is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_to is null or p_to = me then raise exception 'bad_target' using errcode = '22023'; end if;
  if public.is_sanctioned(auth.uid()) then raise exception 'sanctioned' using errcode = '42501'; end if;
  if public.blocked_between(me, p_to) then raise exception 'blocked' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_to) then
    raise exception 'no_such_profile' using errcode = '22023';
  end if;

  -- One pair, one queue: the same two people in either direction take the same
  -- lock, so a simultaneous crossing ask is read in order instead of both
  -- transactions seeing an empty table.
  lo := least(me, p_to); hi := greatest(me, p_to);
  perform pg_advisory_xact_lock(hashtextextended(lo::text || ':' || hi::text, 0));

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

-- Pairs already left half-open by the race (both directions exist, one accepted,
-- the other not): the accepted side is the decision, so the other follows it.
update public.match_requests a
   set status = 'accepted'
 where a.status is distinct from 'accepted'
   and exists (select 1 from public.match_requests b
                where b.from_profile = a.to_profile and b.to_profile = a.from_profile
                  and b.status = 'accepted');
