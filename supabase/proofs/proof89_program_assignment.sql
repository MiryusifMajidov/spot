-- schema89 proof, rolled back: a stranger cannot push a program into somebody
-- else's «Məşq» tab, and a real coach still can.
--
-- Everything happens as the CLIENT does it — `set local role authenticated` plus
-- the person's own JWT claims — so the policies are the only thing being tested.
-- The block ends in an exception, so nothing here survives.
do $$
declare
  atk_p uuid; atk_u uuid; vic_p uuid; res text;
  blocked text := 'NOT BLOCKED — the hole is still open';
  allowed text := 'refused';
begin
  -- Two real accounts: the attacker (who will make themselves a coach) and the victim.
  select id, user_id into atk_p, atk_u from public.profiles
   where user_id is not null order by id limit 1;
  select id into vic_p from public.profiles
   where user_id is not null and id <> atk_p order by id desc limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', atk_u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Step 1: become a coach. This is self-service by design and must still work.
  -- Exactly the columns `authenticated` is granted (schema27 withholds `listed`
  -- and the badge columns), i.e. exactly what the app's «Məşqçi ol» sends.
  insert into public.trainers (id, owner_id, name, specialty, price_from, bio)
  values (atk_p::text, atk_p, 'TEST hücumçu', 'TEST', 0, '')
  on conflict (id) do nothing;

  -- Step 2: the attack — assign a program to somebody who never asked.
  begin
    insert into public.student_programs (trainer_id, student_id, title, note)
    values (atk_p::text, vic_p, 'TEST zorla göndərilmiş proqram', 'TEST mətn');
    -- reached only if the policy let it through
  exception when insufficient_privilege then
    blocked := 'blocked by RLS (42501)';
  end;

  -- Step 3: the legitimate path — the student accepts, then the same insert works.
  reset role;
  insert into public.trainer_requests (trainer_id, from_profile, status, decided_at)
  values (atk_p::text, vic_p, 'accepted', now())
  on conflict (trainer_id, from_profile) do update set status = 'accepted';

  perform set_config('request.jwt.claims',
    json_build_object('sub', atk_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.student_programs (trainer_id, student_id, title, note)
    values (atk_p::text, vic_p, 'TEST qəbul edilmiş proqram', 'TEST mətn');
    allowed := 'accepted student: the assignment lands';
  exception when insufficient_privilege then
    allowed := 'BROKEN — a real coach can no longer assign to an accepted student';
  end;
  reset role;

  res := format('stranger=%s | %s', blocked, allowed);
  raise exception 'RESULTS %', res;
end $$;
