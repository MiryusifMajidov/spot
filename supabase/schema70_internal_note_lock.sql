-- ============================================================================
-- SPOT · schema70_internal_note_lock.sql
--
-- schema68 revoked SELECT on `trainer_verifications.internal_note` and the
-- trainer could still read it. Verified live, as `authenticated`, under the
-- applicant's own JWT: the note came straight back.
--
-- WHY THE REVOKE DID NOTHING. `trainer_verifications` carries a TABLE-level
-- SELECT grant to `authenticated`, and in Postgres a table-level privilege
-- covers every column — a column-level revoke on top of it changes nothing at
-- all. The only way to withhold one column is to take the table grant away and
-- grant the columns back individually.
--
-- This project has now hit that trap three times (schema45's counter columns,
-- schema47's rebuild, and this). It is written down here in the file, not just
-- in a commit message, so the next person reaching for `revoke select (col)`
-- sees why it silently succeeds and silently does nothing.
--
-- WHAT IS AT STAKE. `tv_admin_read` is `(is_admin(auth.uid()) OR auth.uid() =
-- user_id)`, so the applicant reads their own verification row. The panel
-- labelled this field «Qərar üçün qeyd · daxili» and told moderators it goes to
-- the audit log — while the person being judged read every word. A field
-- somebody believes is private is worse than no field: it invites the note that
-- must never be written.
--
-- Apply AFTER schema69_storage_listing.sql.
-- ============================================================================

revoke select on public.trainer_verifications from anon, authenticated;

grant select (
  id, trainer_id, user_id, status, doc_id_url, doc_cert_url, gym_confirm,
  intro_video_url, reviewer_id, reject_reason, sla_due_at, created_at
) on public.trainer_verifications to authenticated;

-- `reject_reason` stays readable on purpose: it is the answer the applicant is
-- owed, and the panel has a «Səbəbi müəllimə göndər» control that writes it.
-- `internal_note` is the moderator's own working note and is read through
-- `admin_verification_note()` (schema68).

comment on column public.trainer_verifications.internal_note is
  'Moderator-only, enforced by the ABSENCE of a column grant (schema70). A column-level revoke does nothing while a table-level SELECT grant exists — which is why schema68''s revoke looked applied and was not. Read it with admin_verification_note().';
