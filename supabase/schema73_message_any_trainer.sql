-- schema73 — anybody may write to a listed trainer
--
-- Reserving a session and asking a question are two different things, and until
-- now the app only allowed the first. `open_thread` required
-- `has_relationship_with`: an ACCEPTED partner match, or an ACCEPTED trainer
-- request. So a person looking at a coach's listing could send a reservation
-- request and then wait — with no way to ask «do you train beginners?», «which
-- gym are you at on Saturdays?», or anything else that decides whether a
-- reservation is even worth sending. The one screen built for asking (the chat)
-- refused to open until after the thing it was supposed to help decide.
--
-- A listed trainer is a professional advertising a service. The listing IS the
-- invitation to make contact, and `listed` is the trainer's own switch — taking
-- it down closes this door with it.
--
-- `has_relationship_with` is deliberately NOT touched: it also decides
-- `profiles_read` (schema39), so widening it would widen who can read whose
-- profile. The new rule lives in `open_thread` alone.
--
-- What does NOT change:
--   · the block check still runs first, and still wins;
--   · nothing here lets the trainer write first — `open_thread` is called by
--     whoever sends the message, and a trainer opening a stranger's thread is
--     still refused unless that person wrote to them;
--   · reading somebody's profile is unaffected.

create or replace function public.is_listed_trainer(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  -- `trainers.id` is text and holds the profile's uuid (becomeTrainer/publishTrainer
  -- write `id = me.id`); `owner_id` is the uuid. Either match counts, so a legacy
  -- row that carries only one of the two still resolves.
  select exists (
    select 1 from public.trainers t
     where t.listed = true
       and (t.owner_id = other or t.id = other::text)
  );
$$;

revoke all on function public.is_listed_trainer(uuid) from public, anon;
grant execute on function public.is_listed_trainer(uuid) to authenticated;

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

  -- An accepted partner match, an accepted trainer link in either direction, or
  -- a trainer whose listing is up.
  if not (public.has_relationship_with(other) or public.is_listed_trainer(other)) then
    raise exception 'no_relationship' using errcode = '42501';
  end if;

  lo := least(me, other); hi := greatest(me, other);
  select id into tid from public.chat_threads where a_profile = lo and b_profile = hi;
  if tid is null then
    insert into public.chat_threads (a_profile, b_profile) values (lo, hi) returning id into tid;
  end if;
  return tid;
end $$;

revoke all on function public.open_thread(uuid) from public, anon;
grant execute on function public.open_thread(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- RUN THIS BLOCK ON ITS OWN, AFTER the DDL above has been applied.
-- `supabase db query` sends the whole file as one transaction, so the closing
-- `raise exception` — which is what rolls the probe's writes back — takes the
-- CREATE FUNCTIONs with it. Applying the file in one go leaves a database that
-- reports «t, t» and contains neither function. Ask me how I know.
-- --------------------------------------------------------------------------
-- Proof, rolled back: a stranger may open a thread with a LISTED trainer and
-- must still be refused for an unlisted one.
-- --------------------------------------------------------------------------
do $$
declare
  me uuid; me_uid uuid; t_profile uuid; t_id text; was_listed boolean; opened uuid; refused boolean := false;
begin
  select p.id, p.user_id into me, me_uid
    from public.profiles p where p.user_id is not null order by p.created_at limit 1;

  select t.owner_id, t.id, t.listed into t_profile, t_id, was_listed
    from public.trainers t where t.owner_id is not null and t.owner_id <> me limit 1;

  if t_profile is null then
    raise exception 'RESULTS: skipped — no trainer owned by somebody other than the test account';
  end if;

  update public.trainers set listed = true where id = t_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', me_uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  opened := public.open_thread(t_profile);
  reset role;

  update public.trainers set listed = false where id = t_id;
  perform set_config('request.jwt.claims',
    json_build_object('sub', me_uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.open_thread(t_profile);
  exception when others then refused := true;
  end;
  reset role;

  raise exception 'RESULTS: listed trainer thread opened = %, unlisted refused = %',
    (opened is not null), refused;
end $$;
