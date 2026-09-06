-- ============================================================================
-- SPOT · schema55_trainer_evidence.sql
--
-- A trainer cannot attach their certificate to their own verification request,
-- so the reviewer's queue always says «Sənəd yoxdur» and no trainer can be
-- verified through the normal path.
--
-- `trainer_verifications` has three policies:
--   tv_insert        INSERT  auth.uid() = user_id
--   tv_admin_read    SELECT  is_admin(...) OR auth.uid() = user_id
--   tv_admin_update  UPDATE  admin_at_least(..., 'ops')
--
-- and no UPDATE path for the trainer at all. `src/app/trainer/verify.tsx`
-- uploads the file into the private `certs` bucket, appends it to
-- `trainers.cert_urls`, then tries to point the open request at it:
--
--   update trainer_verifications set doc_cert_url = newest where id = row.id
--
-- RLS filters that to zero rows with NO error — the screen is already honest
-- about it and shows «Sertifikat saxlancda saxlanıldı, amma açıq sorğuna əlavə
-- olunmadı — dəstəyə yaz». Every trainer, every time. And support cannot fix it
-- either: `doc_cert_url` is what the admin panel reads.
--
-- The trainer may now attach evidence to their OWN request while it is still
-- pending. What they may not touch: `status`, `internal_note`, `reject_reason`,
-- `gym_confirm`, `sla_due_at` — the decision and the moderator's notes stay the
-- moderator's.
--
-- Apply AFTER schema54_match_note.sql.
-- ============================================================================

drop policy if exists tv_own_evidence on public.trainer_verifications;
create policy tv_own_evidence on public.trainer_verifications
  for update to authenticated
  using (
    auth.uid() = user_id
    -- Only an open request. Once a decision exists, the evidence behind it is
    -- frozen: a trainer must not be able to swap the document after approval.
    and status = 'pending'
  )
  with check (
    auth.uid() = user_id
    and status = 'pending'
  );

-- RLS decides WHICH row; the column grant decides WHICH FIELDS. Without this the
-- policy alone would still not let the write through — and a table-level grant
-- would hand the trainer `status` as well, which is the whole thing being
-- protected. Same trap as schema44/47.
revoke update on public.trainer_verifications from anon, authenticated;
grant update (doc_id_url, doc_cert_url, intro_video_url) on public.trainer_verifications to authenticated;

comment on policy tv_own_evidence on public.trainer_verifications is
  'A trainer may attach their own ID, certificate and intro video to their own request while it is still pending. The decision fields stay with the moderator (tv_admin_update).';
