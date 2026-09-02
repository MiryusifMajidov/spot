-- ============================================================================
-- SPOT · schema22_drop_dead_counters.sql
--
-- Removes the four columns schema20 replaced. Every one of them was zero on all
-- 13 profiles and written by no code in either the app or the admin panel; they
-- existed only to be read as if they meant something. The admin panel now takes
-- these numbers from `public.admin_profile_stats()`, which counts the rows that
-- actually exist.
--
-- Verified before dropping: no view, index, constraint, trigger, policy or
-- function references them, and the panel's profile SELECT no longer names them.
--
-- Leaving them in place is the worse option: a dead column that looks like a
-- measurement is exactly what put «0 şikayət» on a reported account.
--
-- Apply AFTER schema21_support_reports.sql, and only once the admin panel
-- carrying the schema20 change is the one being served.
-- ============================================================================

alter table public.profiles drop column if exists reports_count;
alter table public.profiles drop column if exists requests_sent;
alter table public.profiles drop column if exists requests_answered;
alter table public.profiles drop column if exists streak_current;

-- `last_active_at` stays: schema20's `touch_last_active()` now writes it on every
-- app launch, so from here on it is a real observation rather than a NULL.
comment on column public.profiles.last_active_at is
  'Written only by public.touch_last_active(), once per app launch. NULL means the account has not opened the app since 2026-09-02, not that it is inactive.';
