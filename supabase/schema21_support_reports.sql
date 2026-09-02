-- ============================================================================
-- SPOT · schema21_support_reports.sql
--
-- «Kömək və dəstək» (src/app/(tabs)/profile/settings.tsx) files its message
-- through `createReport` as `target_type = 'user'`, `target_id = 'support'`.
-- There is no user called `support`. So in the admin panel each support message
-- arrives as a REPORT AGAINST A PERSON: it is labelled «İstifadəçi · support»,
-- and because `accountRungs` is true for the `user` type, the moderator is shown
-- working Xəbərdarlıq / Səsini kəs / Dayandır / Blokla buttons aimed at nobody.
-- Two such rows are already in the table, both from a real reporter.
--
-- A support message is not a report about a person. It gets its own type, so it
-- lands in its own bucket and the sanction ladder is off by construction.
--
-- Also removes three fabricated reports written at 2026-08-31 10:35 — the same
-- minute as the eleven invented profiles — pointing at rows that no longer
-- exist: two at deleted profile ids and one at the deleted seed video `v2`.
-- They are un-actionable by definition and only inflate the open-report queue.
--
-- Apply AFTER schema20_real_profile_stats.sql.
-- ============================================================================

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type = any (array['user','content','gym','trainer','message','support']));

-- The two real support messages, moved to where they belong. `target_id` becomes
-- 'app' because that is what they are about — the app, not a person.
update public.reports
   set target_type = 'support', target_id = 'app'
 where target_type = 'user' and target_id = 'support';

-- The fabricated three. Matched on target rather than on time, so the statement
-- says exactly what makes them removable: nothing they point at exists.
delete from public.reports r
 where r.reporter_id is null
   and r.note = 'İstifadəçi tərəfindən bildirildi.'
   and (
     (r.target_type = 'user'
       and not exists (select 1 from public.profiles p where p.id::text = r.target_id))
     or (r.target_type = 'content'
       and not exists (select 1 from public.feed_videos v where v.id = r.target_id)
       and not exists (select 1 from public.community_posts c where c.id::text = r.target_id))
   );
