-- ============================================================================
-- SPOT · schema36_notif_prefs_read.sql
--
-- schema35 granted UPDATE on `profiles.notif_prefs` and forgot SELECT.
--
-- schema9 revoked table-wide SELECT on `profiles` and grants it column by column
-- (that is how `phone` stays unreadable), so a column with no SELECT grant
-- cannot be read at all — `select('notif_prefs')` failed outright. The settings
-- screen caught it and said «Ayarlar yüklənmədi» rather than drawing eight
-- switches in a state it had not read, which is right, but the switches were
-- unreachable.
--
-- Apply AFTER schema35_notifications.sql.
-- ============================================================================

grant select (notif_prefs) on public.profiles to anon, authenticated;
