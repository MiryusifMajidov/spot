-- schema89: a coach may only put a program in the workout tab of somebody who
-- actually accepted them.
--
-- THE HOLE (found by the launch audit, 25.09.2026, confirmed against the live
-- policy). `sp_write` was:
--
--   using (owns_trainer(trainer_id))  with check (owns_trainer(trainer_id))
--
-- — nothing at all about `student_id`. And becoming a coach is self-service:
-- `trainers_insert` only asks that `owner_id = my_profile_id()`. So ANY account
-- could create a trainer listing for itself and then insert a `student_programs`
-- row naming any profile in the database. The victim's «Məşq» tab would show a
-- program, with its title and its free-text notes, from somebody they never
-- heard of. It walks straight past the request/accept flow AND past the chat
-- gate (`open_thread` refuses `no_relationship`, and `messages_gate` allows one
-- message until the other side answers) — which is exactly the gate this app
-- built to stop unsolicited contact.
--
-- THE RULE, which is what the app has always done anyway: the student must have
-- an ACCEPTED `trainer_requests` row with this coach. `trainer_requests` is
-- where consent lives — the student sends it, `trainer_requests_guard` lets only
-- the trainer decide it, and ending a student sets it to 'ended'.
--
-- What each command may do now:
--   INSERT  — coach owns the listing AND the student accepted. (The assignment.)
--   UPDATE  — the row must still end up pointing at an accepted student, so a
--             coach cannot edit an old row into a stranger's tab. Editing an
--             ENDED student's program stops working, which is not a flow the app
--             has; re-accepting them makes it work again.
--   DELETE  — the coach who owns the listing, with no relationship test: a
--             mistake must always be removable, and removing a row can never be
--             a way to reach somebody.
-- The student's own read is untouched (`sp_read`), so a student KEEPS the program
-- they were given after the coach ends them — which the live simulation checks.

create or replace function public.trainer_has_student(p_trainer text, p_student uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.trainer_requests r
     where r.trainer_id = p_trainer
       and r.from_profile = p_student
       and r.status = 'accepted'
  );
$function$;

comment on function public.trainer_has_student is
  'True when this student has an ACCEPTED request with this coach — the consent test for assigning a program (schema89).';

revoke all on function public.trainer_has_student(text, uuid) from public;
grant execute on function public.trainer_has_student(text, uuid) to authenticated, anon;

drop policy if exists sp_write on public.student_programs;

create policy sp_assign on public.student_programs
  for insert
  with check (public.owns_trainer(trainer_id) and public.trainer_has_student(trainer_id, student_id));

create policy sp_edit on public.student_programs
  for update
  using (public.owns_trainer(trainer_id))
  with check (public.owns_trainer(trainer_id) and public.trainer_has_student(trainer_id, student_id));

create policy sp_unassign on public.student_programs
  for delete
  using (public.owns_trainer(trainer_id));
