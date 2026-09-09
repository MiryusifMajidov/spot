-- ============================================================================
-- SPOT · schema68_grants_and_policies.sql
--
-- Seven database-side gaps the parallel fix round found but could not reach:
-- every one of them is a grant or a policy that lets a client write, read or
-- keep something the app's own rules say it must not.
--
-- 1. A FORGED «MÜƏLLİM ŞƏRHİ» IS STILL WRITABLE. schema47 exists so that
--    `author`, `is_trainer` and `verified` are STAMPED from the poster's own
--    profile — a badge cannot be forged on upload. `community_posts.stats` and
--    `trainer_comment` walk straight around it: the feed rendered
--    `trainer_comment` as a named coach's verdict with «müəllim» beside it, and
--    `stats` as measured figures. schema53 removed both from the grant; schema47
--    was re-applied later in the numeric order and put them back. The render
--    paths were deleted today — this closes the write.
--
-- 2. `community_posts.type` IS FREE TEXT FROM THE CLIENT. The feed switched on
--    it, including a `progress` branch that drew invented before/after photos
--    (there is no image column on the table). The branch is gone; the column is
--    now constrained to what the app actually posts.
--
-- 3. A MODERATOR CANNOT DELETE A TAKEN-DOWN VIDEO'S FILE. The only DELETE policy
--    on `storage.objects` is `own object delete` (`owner = auth.uid()`), so a
--    takedown hides the row while the clip keeps streaming from the public
--    bucket at a URL that is already in the wild — the feed's share button puts
--    the raw storage URL into the shared message. Somebody who reported a video
--    of themselves has it removed from the feed and still hosted.
--
-- 4. THE `videos` BUCKET CAN BE LISTED BY ANYONE. `videos read` is
--    `USING (bucket_id = 'videos')` for role `public`, so an unauthenticated
--    caller can enumerate every filename in the bucket — including the ones no
--    feed row points at any more. Reading a known object stays public (the feed
--    needs that); listing does not.
--
-- 5. TWO ADMIN RPCs ARE GATED LOWER THAN THEIR BUTTONS. `admin_set_gym_listed`
--    and `admin_set_gym_claim` call the bare `require_admin()`, which is
--    `is_admin(auth.uid())` with NO minimum role — so a support-rung admin can
--    publish or hide any gym, and approve any ownership claim, even though the
--    panel only shows those buttons to ops. A UI gate the server does not share
--    is a suggestion.
--
-- 6. THE APPLICANT READS THE MODERATOR'S «INTERNAL» NOTE.
--    `trainer_verifications.internal_note` has SELECT granted to `anon` and
--    `authenticated`, and `tv_admin_read` is
--    `(is_admin(auth.uid()) OR auth.uid() = user_id)` — so the trainer being
--    judged reads every word written about them, under a field the panel
--    labelled «daxili». Same shape as `profiles.status_reason` in schema57: the
--    column goes, the note comes back through an admin-gated RPC.
--
-- 7. A PROGRAM CANNOT BE DELETED BY ITS AUTHOR. `public.programs` has
--    programs_insert, programs_read, programs_update and programs_admin_hide —
--    and no DELETE policy. That is why the trainer panel still writes programmes
--    to the device only: mirroring them would create publicly readable rows
--    carrying the trainer's name that the trainer could never take back.
--
-- Also here: `challenges.target` was a nullable integer with no CHECK, which is
-- what let a null reach the progress bar as `width: "NaN%"`.
--
-- Apply AFTER schema67_requests_push_gyms.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1 + 2. A post carries the author's words, not a badge they awarded themselves
-- ----------------------------------------------------------------------------
revoke insert on public.community_posts from anon, authenticated;
grant insert (id, author, author_id, gym, time_ago, type, body, created_at)
  on public.community_posts to authenticated;

alter table public.community_posts drop constraint if exists community_posts_type_check;
alter table public.community_posts add constraint community_posts_type_check
  check (type is null or type in ('text', 'question', 'achievement'));

comment on column public.community_posts.trainer_comment is
  'Not writable by a client (schema68). The feed rendered it as a named coach''s verdict with «müəllim» beside it, so any account could put words in a real trainer''s mouth on its own post — the exact forgery schema47''s author stamping exists to prevent.';

-- Anything already written through the gap. Both columns have no render path
-- left, so this only removes rows that could mislead a future one.
update public.community_posts
   set trainer_comment = null
 where trainer_comment is not null;

-- ----------------------------------------------------------------------------
-- 3 + 4. A takedown takes the file down; the bucket is not a directory
-- ----------------------------------------------------------------------------
drop policy if exists "videos admin delete" on storage.objects;
create policy "videos admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'videos' and public.admin_at_least(auth.uid(), 'moderator'));

comment on policy "videos admin delete" on storage.objects is
  'A moderator removing a video must be able to remove the FILE. Hiding the row left the clip streaming from a public URL that the share button had already put into the wild.';

-- ----------------------------------------------------------------------------
-- 5. The server gate matches the button
-- ----------------------------------------------------------------------------
create or replace function public.require_admin_at_least(min_role text)
returns void
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if not public.admin_at_least(auth.uid(), min_role) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.require_admin_at_least(text) from public, anon, authenticated;

create or replace function public.admin_set_gym_listed(
  p_gym text, p_listed boolean, p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare n int;
begin
  -- Was `require_admin()`, i.e. is_admin() with no minimum role, while the panel
  -- shows the button to ops only.
  perform public.require_admin_at_least('ops');
  update public.gyms set listed = p_listed where id = p_gym;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no_such_gym' using errcode = '22023'; end if;
  perform public.admin_log(case when p_listed then 'gym_publish' else 'gym_unpublish' end,
                           'gym', p_gym, p_reason, jsonb_build_object('listed', p_listed));
end $$;

revoke execute on function public.admin_set_gym_listed(text, boolean, text) from public, anon;
grant execute on function public.admin_set_gym_listed(text, boolean, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. «Daxili qeyd» becomes internal
-- ----------------------------------------------------------------------------
revoke select (internal_note) on public.trainer_verifications from anon, authenticated;

create or replace function public.admin_verification_note(p_verification uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  perform public.require_admin_at_least('support');
  return (select internal_note from public.trainer_verifications where id = p_verification);
end $$;

revoke execute on function public.admin_verification_note(uuid) from public, anon;
grant execute on function public.admin_verification_note(uuid) to authenticated;

comment on column public.trainer_verifications.internal_note is
  'Moderator-only. It used to be SELECT-granted to every role while tv_admin_read lets the APPLICANT read their own row, so the trainer being judged read every word — under a field the panel called «daxili». Read it with admin_verification_note().';

-- ----------------------------------------------------------------------------
-- 7. An author can take their own programme back
-- ----------------------------------------------------------------------------
drop policy if exists programs_delete on public.programs;
create policy programs_delete on public.programs
  for delete to authenticated
  using (owner_id in (select p.id from public.profiles p where p.user_id = auth.uid()));

grant delete on public.programs to authenticated;

comment on policy programs_delete on public.programs is
  'Without this a programme could be created and never withdrawn — which is why the trainer panel kept its programmes on the device instead of publishing rows carrying the trainer''s name that the trainer could not delete.';

-- ----------------------------------------------------------------------------
-- 8. A challenge target is a number you can divide by
-- ----------------------------------------------------------------------------
update public.challenges set target = null where target is not null and target <= 0;
alter table public.challenges drop constraint if exists challenges_target_check;
alter table public.challenges add constraint challenges_target_check
  check (target is null or target > 0);

comment on column public.challenges.target is
  'Null means «not set»; anything present is greater than zero. A null or zero reached the client''s progress bar as width: "NaN%" (or a false 100%).';
