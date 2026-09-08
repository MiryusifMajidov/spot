-- ============================================================================
-- SPOT · schema58_admin_dashboard.sql
--
-- `admin_dashboard()` has been dead since schema27. It still ends with
--
--   'revenue_commission', (select coalesce(sum(commission),0) from public.day_passes ...)
--
-- while schema27_trust_columns.sql:194 dropped that column — deliberately, with
-- a comment saying a commission column "is a place for a number to appear
-- later". The function was never redefined, so every call returns
--
--   ERROR 42703: column "commission" does not exist
--
-- and because a LANGUAGE sql body is parse-analysed as a whole, even the
-- non-admin `else '{}'::jsonb` branch never runs. The function has no working
-- path at all.
--
-- WHAT THE ADMIN ACTUALLY SEES. Both call sites discard the error:
--   web/admin/src/App.tsx:35        → every sidebar badge becomes ''
--   web/admin/src/screens/Dashboard.tsx:36 → the queue cards print `?? 0`
-- so today, with 5 open reports and 1 pending trainer verification on this
-- database, a moderator opens the dashboard and reads «Şikayətlər 0» — with
-- those five reports listed in the rows directly underneath. That is the path
-- abuse reports get dropped on.
--
-- The revenue key does NOT come back. SPOT takes no money (product rule 1), a
-- day-pass price is the gym's own informational figure paid at the door, and
-- summing them into a dashboard total would recreate exactly the revenue
-- surface that column was removed to prevent. `DashboardKpis` in
-- web/admin/src/lib/types.ts already has no field for it.
--
-- `daypass_active` also goes, for a different reason: nothing ever moves a pass
-- out of 'active' (no expiry job, no redemption), so the number counts every
-- pass ever created and calling it «Aktiv day-pass · canlı» states a fact
-- nobody measured. It comes back when a pass can actually expire.
--
-- Apply AFTER schema57_owner_privacy.sql.
-- ============================================================================

create or replace function public.admin_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin(auth.uid()) then jsonb_build_object(
    'users_total',      (select count(*) from public.profiles),
    'trainers_pending', (select count(*) from public.trainer_verifications where status = 'pending'),
    'reports_open',     (select count(*) from public.reports where status = 'open'),
    'reports_overdue',  (select count(*) from public.reports where status = 'open' and sla_due_at < now()),
    'claims_pending',   (select count(*) from public.gym_claims where status = 'pending'),
    'gyms_total',       (select count(*) from public.gyms)
  ) else '{}'::jsonb end;
$$;

comment on function public.admin_dashboard is
  'Moderation queue counts for the admin panel. No revenue key: SPOT takes no money. No daypass_active: nothing expires a pass, so the count would not mean what it says.';
