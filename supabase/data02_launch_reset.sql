-- data02 (25.09.2026): empty the app of everything that was made while building
-- it, so the first real person opens a clean SPOT.
--
-- WHAT IS NOT TOUCHED, and why:
--   · public.exercises      — SPOT's own exercise library (18 rows). Content, not test data.
--   · public.admins         — the owner's admin row. Deleting it locks the admin panel.
--   · public.profiles / auth.users — REAL accounts (13), including the owner's own and
--     two other people's. Wiping identities is a separate decision, asked separately.
--   · public.gyms / trainers / gym_checkin_codes — the owner's own rows, already
--     unlisted by data01. Also a separate decision.
--   · spatial_ref_sys       — PostGIS's own table, not ours.
--
-- Storage files are removed separately with the CLI: the database cannot delete
-- from storage.objects, and leaving the four mp4s behind would keep them
-- downloadable at their public URLs after the rows are gone.
--
-- Counted before running (live): comments 15, notifications 15, push_tokens 8,
-- video_likes 6, workouts 6, reports 5, audit_log 4, comment_likes 4,
-- feed_videos 4, programs 4, trainer_verifications 4, meals 4, shop_items 7,
-- follows 3, trainer_requests 3, video_saves 3, prs 2, chat_threads 1,
-- community_posts 1, day_passes 1, messages 1, post_likes 1, progress 1,
-- student_programs 1.

-- Children first: each of these has a foreign key into something below it.
delete from public.comment_likes;
delete from public.comments;
delete from public.post_likes;
delete from public.video_likes;
delete from public.video_saves;
delete from public.follows;
delete from public.messages;
delete from public.chat_threads;
delete from public.notifications;
delete from public.report_messages;
delete from public.reports;
delete from public.feed_videos;
delete from public.community_posts;
delete from public.student_programs;
delete from public.programs;
delete from public.trainer_requests;
delete from public.match_requests;
delete from public.workouts;
delete from public.prs;
delete from public.progress;
delete from public.check_ins;
delete from public.day_passes;
delete from public.blocks;

/* Push tokens: every one belongs to a test install. A stale token is worse than
   no token — a notification meant for a new account can arrive on a phone that
   is no longer signed into it. */
delete from public.push_tokens;

-- The moderation trail of the build itself: 4 audit rows and 5 reports, all
-- about test content that is being deleted in the same breath.
delete from public.audit_log;

/* Verification rows with NO documents at all — every document column is NULL —
   two of which carry an approved badge. A blue tick that never had evidence
   behind it is exactly what the app's own rules forbid, so the queue is emptied
   and the badges come off with it. Re-apply from inside the app with real
   documents; the trigger puts the row back as «pending». */
delete from public.trainer_verifications;
update public.trainers set verified = false, verify_status = 'unverified'
 where verified or verify_status is distinct from 'unverified';

/* Seed content for two features that were deleted from the app. The tables are
   still granted to anon, so `GET /rest/v1/meals` answers with rows to anybody
   holding the public key — data describing a product that does not exist. */
delete from public.meals;
delete from public.shop_items;
revoke all on public.meals from anon, authenticated;
revoke all on public.shop_items from anon, authenticated;

-- What is left, so the result can be read at a glance.
select 'feed_videos' as t, count(*) n from public.feed_videos
union all select 'community_posts', count(*) from public.community_posts
union all select 'comments', count(*) from public.comments
union all select 'notifications', count(*) from public.notifications
union all select 'messages', count(*) from public.messages
union all select 'workouts', count(*) from public.workouts
union all select 'reports', count(*) from public.reports
union all select 'push_tokens', count(*) from public.push_tokens
union all select 'trainer_verifications', count(*) from public.trainer_verifications
union all select 'meals', count(*) from public.meals
union all select 'KEPT exercises', count(*) from public.exercises
union all select 'KEPT admins', count(*) from public.admins
union all select 'KEPT profiles', count(*) from public.profiles
order by 1;
