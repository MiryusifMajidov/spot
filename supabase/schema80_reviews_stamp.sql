-- APPLIED 2026-09-22. Proved (rolled back): an insert forging name, tenure
-- «500 check-in edib», a gym reply and a 2020 date came back with the profile's
-- name, «3 check-in edib» (the real count), no reply and now(); an author edit kept
-- name/tenure and changed the body; the gym owner's reply still saved; a member's
-- reply was refused (only_the_gym_may_reply).
-- schema80: a review's facts are stamped by the server, not written by the author.
--
-- reviews_guard (BEFORE UPDATE) already keeps the gym's reply to the gym and the
-- review to its author — but nothing guarded INSERT, and the authenticated role
-- holds INSERT on every column. So the author of a new review could write:
--   · `reply` / `reply_at` — a fake «official answer from the gym», rendered
--     under the gym's name on the public page;
--   · `name`   — any display name, e.g. someone else's;
--   · `tenure` — «500 check-in edib» under the shield icon, or edit it later
--     (UPDATE tenure is granted and reviews_guard lets the author change it);
--   · `created_at` — any date.
-- The app writes honest values; a direct API call did not have to.
--
-- Stamped now:
--   INSERT: reply/reply_at cleared, name from the author's profile, tenure from
--           the author's real check-ins at this gym, created_at = now().
--   UPDATE: name, tenure and created_at keep the values stamped at posting —
--           «Rəy yazanda {n} check-in etmişdi» is a snapshot of that moment.
-- The trigger runs AFTER reviews_guard_edits (BEFORE triggers fire in name
-- order), so the guard still judges what the caller asked for.

create or replace function public.reviews_stamp()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  if tg_op = 'INSERT' then
    new.reply      := null;
    new.reply_at   := null;
    new.created_at := now();
    -- reviews_insert already requires author_id to be the caller's own profile.
    new.name := coalesce((select nullif(btrim(p.name), '') from public.profiles p where p.id = new.author_id), new.name);
    select count(*) into n from public.check_ins c
     where c.gym_id = new.gym_id and c.profile_id = new.author_id;
    -- The exact shape the app renders (src/lib/format.ts tenureLabel).
    new.tenure := n || ' check-in edib';
  else
    new.name       := old.name;
    new.tenure     := old.tenure;
    new.created_at := old.created_at;
  end if;
  return new;
end $function$;

drop trigger if exists reviews_stamp on public.reviews;
create trigger reviews_stamp
  before insert or update on public.reviews
  for each row execute function public.reviews_stamp();
