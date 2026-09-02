-- ============================================================================
-- SPOT · schema44_counter_grants.sql
--
-- schema43 tried to protect the new counters with
--
--   revoke update (likes) on public.feed_videos from anon, authenticated;
--
-- which does nothing while a TABLE-level UPDATE grant is still in place: in
-- Postgres the table privilege covers every column, and revoking one column
-- from underneath it is a no-op. The test caught it — a normal account could
-- still set `likes = 9999` and `participants = 500`.
--
-- schema27 got this right for `trainers` and `gyms` (revoke the table, then
-- grant the columns back). Same shape here.
--
-- What clients legitimately update on these three tables:
--   feed_videos      · nothing, except a MODERATOR stamping `hidden_at`
--   community_posts  · the same
--   challenges       · admin edits (the admin panel), never `participants`
--
-- The RLS policies already decide WHO; these grants decide WHAT.
--
-- Apply AFTER schema43_social_graph.sql.
-- ============================================================================

revoke update on public.feed_videos     from anon, authenticated;
revoke update on public.community_posts from anon, authenticated;
revoke update on public.challenges      from anon, authenticated;

-- Only the takedown stamp. `feed_videos_admin_hide` / `community_posts_admin_hide`
-- (schema18) limit it to a moderator.
grant update (hidden_at) on public.feed_videos     to authenticated;
grant update (hidden_at) on public.community_posts to authenticated;

-- The admin panel edits a challenge; `participants` is now a count, so it is not
-- in the list. `challenges_admin_update` limits this to an admin.
grant update (
  title, scope, scope_label, description, target, unit,
  days_left, reward, active, progress, leaderboard, day_cells
) on public.challenges to authenticated;
