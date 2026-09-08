-- ============================================================================
-- SPOT · schema60_challenges_real.sql
--
-- Today is 8 September 2026. The challenge the app shows as the live one is
-- «Avqust · 12 məşq» — id `aug-12` — with `days_left = 11`, `progress = 8` and a
-- reward of «1 aylıq üzvlük». Every part of that is wrong, and each part is wrong
-- for its own reason:
--
-- 1. NOTHING CAN END A CHALLENGE. The table stores `days_left int`. An integer
--    cannot count down, so it stays at whatever it was written as, forever. An
--    August challenge is still «active» in September because there is no date
--    anywhere in the schema that says when it stopped.
--
-- 2. THE ADMIN'S «DAYANDIR» IS NOT READ. `web/admin/src/screens/Challenges.tsx`
--    writes `active = false` and logs the reason to the audit trail — and
--    `src/lib/hooks.ts:300` picks the featured challenge with
--    `all.find(c => c.id === 'aug-12')`, hardcoded. A moderator can stop a
--    challenge, watch the confirmation, see the audit row, and the challenge
--    stays on every user's screen. Newly activated ones can never be featured.
--
-- 3. THE PROGRESS AND THE RANKING WERE INVENTED. `progress` holds 8, 68 and 2 for
--    three challenges nobody has ever joined (`challenge_members` is empty).
--    `leaderboard` and `day_cells` hold seeded JSON. The app already refuses to
--    render them — «Uydurma sıralama göstərmirik» is on the detail screen — so
--    they are fabricated numbers sitting in a table waiting for one careless
--    render. Progress per participant is now computable for real: `workouts` has
--    lived on the server since schema2.
--
-- 4. THE REWARD HAD NO WINNER. «1 aylıq üzvlük» is a month of gym membership
--    promised to whoever wins — and there was no ranking, so nobody could ever be
--    identified as the winner, and no screen anywhere could award it.
--    `challenge_standings()` below is what makes a winner determinable at all.
--
-- WHAT THIS DOES
--   · `starts_at` / `ends_at` replace `days_left`, so a challenge has a real
--     window and expiry is a fact rather than a stored guess.
--   · `progress`, `leaderboard` and `day_cells` are dropped — invented data.
--   · `challenge_standings(cid)` ranks the people who OPTED IN, from their real
--     workout rows, inside the challenge window.
--   · The three seed challenges are deleted. None was ever published by a human,
--     none has a single participant, and their titles and progress are fiction.
--     Real ones are created from the admin panel.
--
-- PRIVACY. `challenge_standings` returns a name, a handle, an avatar and ONE
-- number: how many sessions (or how many tonnes) that person logged inside the
-- window. No exercise, no weight, no duration, no date, no photo — nothing that
-- would cross the line in the product rules. It only covers people who inserted
-- their own `challenge_members` row, which is a deliberate public act: that table
-- has been world-readable since schema43. Somebody who never joins appears
-- nowhere.
--
-- Apply AFTER schema59_day_pass.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A challenge gets a real window
-- ----------------------------------------------------------------------------
alter table public.challenges add column if not exists starts_at timestamptz;
alter table public.challenges add column if not exists ends_at   timestamptz;

comment on column public.challenges.ends_at is
  'When the challenge stops. Replaces days_left, which was an int nothing ever decremented — that is why an August challenge was still live in September. NULL means open-ended.';
comment on column public.challenges.active is
  'Published. The admin panel''s «Dayandır» writes false here, and the app now READS it (it used to hardcode the featured challenge to id aug-12).';

-- ----------------------------------------------------------------------------
-- 2. Invented columns go
--
-- `progress` was a per-challenge number with no owner — there is no such thing as
-- "the" progress of a challenge, only each participant's. `leaderboard` and
-- `day_cells` held seeded JSON the app already refuses to draw. `days_left` is
-- replaced by ends_at.
-- ----------------------------------------------------------------------------
alter table public.challenges drop column if exists progress;
alter table public.challenges drop column if exists leaderboard;
alter table public.challenges drop column if exists day_cells;
alter table public.challenges drop column if exists days_left;

-- ----------------------------------------------------------------------------
-- 3. The three fabricated challenges
--
-- «Avqust · 12 məşq» (progress 8/12), «Zallar arası: 100 ton» (68/100) and
-- «İlk 5 dartma» (2/5) came from schema2's seed block. Nobody authored them,
-- nobody joined them, and their progress bars described a user who did not exist.
-- Guarded: if anybody HAS joined one, this migration stops instead of deleting
-- somebody's participation.
-- ----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.challenge_members
   where challenge_id in ('aug-12','cross-100t','first-5-pullups');
  if n > 0 then
    raise exception 'REFUSING: % participants in the seed challenges — do not delete somebody''s participation', n;
  end if;
  delete from public.challenges where id in ('aug-12','cross-100t','first-5-pullups');
end $$;

-- ----------------------------------------------------------------------------
-- 4. A ranking that is counted, not written
--
-- `unit` decides what is being counted, mirroring the client's
-- computeChallengeProgress:
--   məşq / default → number of logged sessions
--   t              → tonnes lifted (volume_kg / 1000)
--   kq             → kilos lifted
-- Anything else returns NULL for `done`: the honest answer for a target SPOT
-- cannot measure (a «5 dartma» goal is not in any workout row), so the app can
-- say so instead of showing a session count under a pull-up label.
--
-- The window starts at the later of the challenge start and the person's own
-- join time — nobody is credited for work they did before entering — and ends at
-- the challenge end or now, whichever is earlier.
-- ----------------------------------------------------------------------------
create or replace function public.challenge_standings(cid text)
returns table (
  profile_id uuid,
  name       text,
  username   text,
  avatar_url text,
  done       numeric,
  is_me      boolean
)
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  with c as (
    select id, unit, starts_at, ends_at from public.challenges where id = cid and active
  )
  select
    p.id,
    p.name,
    p.username,
    p.avatar_url,
    case
      when lower(coalesce(c.unit,'')) = 't'
        then round(coalesce(sum(w.volume_kg), 0) / 1000.0, 1)
      when lower(coalesce(c.unit,'')) = 'kq'
        then round(coalesce(sum(w.volume_kg), 0), 0)
      when lower(coalesce(c.unit,'')) in ('məşq','mesq','')
        then count(w.id)::numeric
      else null
    end as done,
    p.id = public.my_profile_id() as is_me
  from c
  join public.challenge_members m on m.challenge_id = c.id
  join public.profiles p          on p.id = m.profile_id
  left join public.workouts w
         on w.profile_id = p.id
        and w.created_at >= greatest(m.joined_at, coalesce(c.starts_at, m.joined_at))
        and w.created_at <= least(now(), coalesce(c.ends_at, now()))
  group by p.id, p.name, p.username, p.avatar_url, c.unit
  order by done desc nulls last, p.name asc;
$$;

revoke all on function public.challenge_standings(text) from public;
grant execute on function public.challenge_standings(text) to authenticated;

comment on function public.challenge_standings is
  'Ranking for one published challenge, counted from real workout rows for the people who opted in. Returns exactly one number per person — sessions or tonnes — and nothing else about their training. NULL done means the unit is not something SPOT can measure, so the app must say so rather than print a substitute.';

-- ----------------------------------------------------------------------------
-- 5. The admin writes the window; nobody writes a ranking
-- ----------------------------------------------------------------------------
revoke insert, update on public.challenges from anon, authenticated;
grant insert (id, title, scope, scope_label, description, target, unit, reward,
              active, starts_at, ends_at) on public.challenges to authenticated;
grant update (title, scope, scope_label, description, target, unit, reward,
              active, starts_at, ends_at) on public.challenges to authenticated;

create index if not exists challenges_live_idx on public.challenges (ends_at) where active;
create index if not exists workouts_profile_time_idx on public.workouts (profile_id, created_at);
