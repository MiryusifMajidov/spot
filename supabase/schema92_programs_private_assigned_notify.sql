-- schema92 — private programs, the day a workout was, and «program_assigned»
--
-- Three findings of the 29.09.2026 business-logic audit, one file:
--
-- 1. EVERY PROGRAM WAS PUBLIC. `programs_read` was `using (true)`, so a
--    program somebody wrote for themselves went into everybody's library the
--    moment it was saved — while the Məşq tab told them «istəsən paylaş». Now a
--    program has `is_public`, false unless the author turns it on. Readable:
--    public ones, your own, one a trainer assigned to you (student_programs),
--    and moderators (the admin panel hides programs). Trainer programs that
--    already exist stay public: trainers write them to publish.
--
-- 2. THE NEXT DAY WAS GUESSED. The app now picks «the day after the last one
--    done», which needs the day on the workout. A workout restored on another
--    phone came back without it and fell back to counting sessions.
--
-- 3. A STUDENT WAS NEVER TOLD. A trainer assigning a program wrote
--    student_programs and nothing else: no row in the notification centre, no
--    push. Now it goes through notify() like every other event — the same block
--    check, the same per-type switch (a new «program_assigned» in the app's
--    notification settings), the same push.

-- ----------------------------------------------------------------- 1. programs
alter table public.programs add column if not exists is_public boolean not null default false;

update public.programs set is_public = true where creator_type = 'trainer' and is_public = false;

grant insert (is_public), update (is_public) on public.programs to authenticated;

drop policy if exists programs_read on public.programs;
create policy programs_read on public.programs
  for select
  using (
    is_public
    or owner_id = public.my_profile_id()
    or exists (
      select 1 from public.student_programs sp
       where sp.program_id = programs.id
         and sp.student_id = public.my_profile_id()
    )
    or public.admin_at_least(auth.uid(), 'moderator')
  );

comment on column public.programs.is_public is
  'Listed in everybody''s library. False unless the author turns it on (schema92): a program written for yourself is yours. Owners, assigned students and moderators read it regardless.';

-- ----------------------------------------------------------------- 2. workouts
alter table public.workouts add column if not exists day_index int
  check (day_index is null or day_index between 0 and 99);

grant insert (day_index), update (day_index) on public.workouts to authenticated;

comment on column public.workouts.day_index is
  'Which day of program_id this session was (0-based). The Məşq tab offers the day after the last one done (schema92).';

-- ----------------------------------------------------------------- 3. notify
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'comment_like', 'comment_reply', 'mention', 'match_request', 'match_accepted',
  'trainer_request', 'trainer_decided', 'review_reply', 'message', 'video_like',
  'post_like', 'follow', 'program_assigned'
]));

create or replace function public.push_text(p_type text, p_actor_name text)
returns text[]
language sql
immutable
as $$
  select case p_type
    when 'message'          then array['Yeni mesaj',        coalesce(p_actor_name,'Kimsə') || ' sənə mesaj yazdı']
    when 'match_request'    then array['Məşq təklifi',      coalesce(p_actor_name,'Kimsə') || ' səninlə məşq etmək istəyir']
    when 'match_accepted'   then array['Təklif qəbul edildi', coalesce(p_actor_name,'Yoldaşın') || ' təklifini qəbul etdi']
    when 'trainer_request'  then array['Yeni şagird sorğusu', coalesce(p_actor_name,'Kimsə') || ' səninlə işləmək istəyir']
    when 'trainer_decided'  then array['Müəllim cavab verdi', coalesce(p_actor_name,'Müəllim') || ' sorğuna cavab verdi']
    when 'comment_reply'    then array['Şərhinə cavab',     coalesce(p_actor_name,'Kimsə') || ' şərhinə cavab yazdı']
    when 'comment_like'     then array['Şərhini bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' şərhini bəyəndi']
    when 'mention'          then array['Səni qeyd etdilər', coalesce(p_actor_name,'Kimsə') || ' səni şərhdə qeyd etdi']
    when 'review_reply'     then array['Rəyinə cavab',      coalesce(p_actor_name,'Zal') || ' rəyinə cavab yazdı']
    when 'video_like'       then array['Videonu bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' videonu bəyəndi']
    when 'post_like'        then array['Paylaşımını bəyəndilər', coalesce(p_actor_name,'Kimsə') || ' paylaşımını bəyəndi']
    when 'follow'           then array['Yeni izləyici',     coalesce(p_actor_name,'Kimsə') || ' səni izləməyə başladı']
    when 'program_assigned' then array['Yeni proqram',      coalesce(p_actor_name,'Müəllimin') || ' sənə proqram təyin etdi']
    else array['SPOT', 'Yeni bildiriş var']
  end;
$$;

create or replace function public.tg_notify_program_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare coach uuid;
begin
  -- A changed note is not a new program; only a new assignment, or a different
  -- program or title on an existing one, is news for the student.
  if tg_op = 'UPDATE'
     and new.program_id is not distinct from old.program_id
     and new.title is not distinct from old.title then
    return new;
  end if;
  select t.owner_id into coach from public.trainers t where t.id = new.trainer_id;
  perform public.notify(new.student_id, coach, 'program_assigned', null, new.id::text);
  return new;
end $$;

revoke all on function public.tg_notify_program_assigned() from public, anon, authenticated;

drop trigger if exists student_programs_notify on public.student_programs;
create trigger student_programs_notify
  after insert or update on public.student_programs
  for each row execute function public.tg_notify_program_assigned();
