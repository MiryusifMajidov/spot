-- schema72 — a workout the person logged by mistake can be taken back
--
-- Until now nothing in SPOT could remove a logged workout. A mistyped weight —
-- 720 kg instead of 72 — stayed in the history forever, kept counting toward
-- the volume total on the profile, and if it beat the previous best it also
-- wrote a personal record that no workout the person recognises stands behind.
--
-- The permissions were already half there: `workouts_write` and `prs_write` are
-- both `for all` scoped to the owner, and `authenticated` already holds DELETE
-- on `public.workouts`. It does NOT hold it on `public.prs` — schema62's
-- hardening granted only SELECT/INSERT/UPDATE there — so the record a deleted
-- workout wrote could not be taken back with it. That one grant is what this
-- migration adds.
--
-- DELETE stays row-scoped by the existing policy: `prs_write` is
--   profile_id in (select id from profiles where user_id = auth.uid())
-- so this grant lets a person delete their own records and nobody else's. It is
-- verified below rather than assumed.

grant delete on public.prs to authenticated;

-- --------------------------------------------------------------------------
-- Proof, in one transaction that is rolled back: as an authenticated user,
-- a DELETE aimed at somebody else's record must remove nothing.
-- --------------------------------------------------------------------------
do $$
declare
  a uuid; a_uid uuid; other uuid; victim uuid; removed int;
begin
  -- The signed-in person.
  select id, user_id into a, a_uid
    from public.profiles where user_id is not null order by created_at limit 1;
  if a is null then
    raise exception 'RESULTS: skipped — no profile with a user_id to sign in as';
  end if;

  -- Somebody else's record. The second profile is created here rather than
  -- borrowed, because this database currently holds one real account and a test
  -- that quietly skips itself is worse than no test. `user_id` is null, so
  -- `prs_write` cannot match it against anyone's auth.uid().
  insert into public.profiles (name) values ('__schema72_probe__') returning id into other;
  insert into public.prs (profile_id, lift, value) values (other, '__schema72_probe__', 1)
    returning id into victim;

  perform set_config('request.jwt.claims',
    json_build_object('sub', a_uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.prs where id = victim;
  get diagnostics removed = row_count;
  reset role;

  -- The exception is the point: it reports the result AND rolls the probe rows
  -- back, so nothing this test created survives it.
  raise exception 'RESULTS: rows another user could delete = % (must be 0)', removed;
end $$;
