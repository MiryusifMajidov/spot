-- schema76 — a program day carries what its author wrote
--
-- THE BUG THIS FIXES.
--
-- `programs.days` was `[{title, focus, exercise_ids[]}]` — a list of library ids
-- and nothing else. Both readers then rebuilt the numbers from the library:
-- src/lib/hooks.ts mapDayExercises took `defaultSets`/`reps` from
-- `exerciseLibrary`, and src/store/db.ts programDayExercises preferred the
-- library entry over the author's (`known ?? {...}`).
--
-- So an author's sets and reps could not survive a save. The create screen even
-- rendered them — «3 set × 8-10» under every move — while the shape had nowhere
-- to put a different answer. A coach writing «5 set × 5» for a student got the
-- library's «3 set × 8-10» back, under their own name.
--
-- The day now carries `items`:
--
--   {"title": "…", "focus": "…", "items": [
--      {"name": "Skvat", "exercise_id": "squat", "sets": 5, "reps": "5",
--       "video_url": "https://…/storage/v1/object/public/videos/…"}]}
--
-- `reps` is one text field on purpose. The session logger already reads a value
-- containing «san» as a timed exercise (src/app/(tabs)/workout/session.tsx
-- isTimed), so «45 san» and «8-10» travel down the same wire and the builder
-- only has to offer the person a choice between them. One field, no second
-- column, and the logger did not have to change to understand a plank.
--
-- `exercise_id` is optional — an author may type a move SPOT's library has
-- never heard of. `exercise_ids` is still written alongside for the moves that
-- do resolve, so a phone running the previous build still sees those days
-- instead of an empty program.
--
-- No DDL: `days` is jsonb and schema34 already grants it on insert and update.
-- What is missing is a limit, which is what this file adds.

/*
 * Why a trigger and not a check constraint: the interesting rule is about a URL
 * inside a nested array, and it has to say WHY it refused in a language the app
 * can translate.
 *
 * `video_url` is the sharp edge. Anything in that field is played inside SPOT,
 * by the person following the program, under the author's name — so it must be
 * a file this project is hosting, not a link an author chose. Without this, a
 * program day is a place to put an arbitrary URL in front of a member.
 */
create or replace function public.tg_programs_validate_days()
returns trigger
language plpgsql
as $$
declare
  d           jsonb;
  it          jsonb;
  n_days      int := 0;
  n_items     int;
  v           text;
begin
  if new.days is null then
    return new;
  end if;

  if jsonb_typeof(new.days) <> 'array' then
    raise exception 'program_days_shape' using errcode = '22023';
  end if;

  if jsonb_array_length(new.days) > 14 then
    raise exception 'program_too_many_days' using errcode = '22023';
  end if;

  for d in select * from jsonb_array_elements(new.days) loop
    n_days := n_days + 1;

    if jsonb_typeof(d) <> 'object' then
      raise exception 'program_days_shape' using errcode = '22023';
    end if;

    if coalesce(jsonb_typeof(d->'items'), 'null') not in ('array', 'null') then
      raise exception 'program_days_shape' using errcode = '22023';
    end if;

    n_items := coalesce(jsonb_array_length(nullif(d->'items', 'null'::jsonb)), 0);
    if n_items > 40 then
      raise exception 'program_too_many_items' using errcode = '22023';
    end if;

    for it in select * from jsonb_array_elements(coalesce(nullif(d->'items', 'null'::jsonb), '[]'::jsonb)) loop
      if jsonb_typeof(it) <> 'object' then
        raise exception 'program_days_shape' using errcode = '22023';
      end if;

      -- A row with no name is not an exercise; it renders as a blank line the
      -- person following the program cannot act on.
      if coalesce(trim(it->>'name'), '') = '' then
        raise exception 'program_item_unnamed' using errcode = '22023';
      end if;
      if length(it->>'name') > 80 then
        raise exception 'program_item_name_long' using errcode = '22023';
      end if;
      if length(coalesce(it->>'reps', '')) > 40 then
        raise exception 'program_item_reps_long' using errcode = '22023';
      end if;
      if coalesce((it->>'sets')::numeric, 1) not between 1 and 20 then
        raise exception 'program_item_sets_range' using errcode = '22023';
      end if;

      v := nullif(trim(coalesce(it->>'video_url', '')), '');
      if v is not null and v not like '%/storage/v1/object/public/videos/%' then
        -- Whatever is here is played to a member, inside SPOT, credited to the
        -- author. It has to be a file SPOT is hosting.
        raise exception 'program_item_bad_video' using errcode = '22023';
      end if;
    end loop;
  end loop;

  return new;
end $$;

drop trigger if exists programs_validate_days on public.programs;
create trigger programs_validate_days
  before insert or update of days on public.programs
  for each row execute function public.tg_programs_validate_days();

comment on function public.tg_programs_validate_days() is
  'schema76. A day carries its author''s own sets/reps/video (items[]), not ids the reader re-derives from the library. This bounds the blob and pins video_url to SPOT''s own videos bucket — the field is played to a member under the author''s name, so it may not be a link the author chose.';
