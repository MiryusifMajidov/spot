-- ============================================================================
-- SPOT · schema46_feed_ordering.sql  (F-17, part 1)
--
-- The feed was ordered by `ord`, and `uploadFeedVideo` wrote `ord: 0` on every
-- row — so every video had the same sort key and the order was whatever
-- Postgres happened to return. There was no `created_at` column at all, so
-- «newest first» was not merely unimplemented, it was impossible.
--
-- Adds the columns the feed actually needs:
--   created_at   · a real timestamp to sort by
--   duration_sec · how long the clip is, checked before upload and shown
--   size_bytes   · what was uploaded, so a limit can be stated in real numbers
--   poster_url   · the still frame. Left NULL until a build ships
--                  `expo-video-thumbnails` (a native dependency, so it needs a
--                  rebuild); the feed shows the first frame of the video itself
--                  meanwhile and never a fabricated placeholder.
--
-- `ord` stays for the seeded catalogue order but is no longer what the feed
-- sorts by.
--
-- Apply AFTER schema45_counts.sql.
-- ============================================================================

alter table public.feed_videos add column if not exists created_at   timestamptz not null default now();
alter table public.feed_videos add column if not exists duration_sec integer;
alter table public.feed_videos add column if not exists size_bytes   bigint;
alter table public.feed_videos add column if not exists poster_url   text;

create index if not exists feed_videos_newest on public.feed_videos (created_at desc) where hidden_at is null;

-- The three existing rows predate the column, so `now()` would put them all at
-- this instant. Their ids carry the upload time — `uv-` + Date.now() in base 36 —
-- so the real moment is recoverable instead of invented.
update public.feed_videos
   set created_at = to_timestamp(
         ('x' || lpad(to_hex(0), 8, '0'))::bit(32)::bigint  -- placeholder, replaced below
       )
 where false;

do $$
declare r record; ms bigint;
begin
  for r in select id from public.feed_videos where id like 'uv-%' loop
    begin
      -- base36 → milliseconds
      ms := 0;
      for i in 1..length(substring(r.id from 4)) loop
        ms := ms * 36 + strpos('0123456789abcdefghijklmnopqrstuvwxyz',
                               substring(lower(substring(r.id from 4)) from i for 1)) - 1;
      end loop;
      if ms > 1000000000000 and ms < 4000000000000 then
        update public.feed_videos set created_at = to_timestamp(ms / 1000.0) where id = r.id;
      end if;
    exception when others then
      -- An id that does not decode keeps `now()`; a wrong guess would be worse.
      null;
    end;
  end loop;
end $$;

-- The client fills these at upload; nothing derived, so they stay writable.
grant insert (created_at, duration_sec, size_bytes, poster_url) on public.feed_videos to anon, authenticated;
