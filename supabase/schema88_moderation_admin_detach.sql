-- schema88: the admin can delete their own account too.
--
-- `moderation_actions.admin_id` is ON DELETE RESTRICT against `auth.users`, and
-- `delete_my_account()` ends with `delete from auth.users`. So from the moment
-- the owner's account — the one row in `public.admins` — resolves its first
-- report, «Hesabı sil» starts failing for it with a foreign-key error and the
-- app says «Hesab silinmədi». Latent today only because `moderation_actions`
-- has no rows yet; `store/legal/delete-account.html` promises deletion with no
-- qualification, and both stores require it to work for every account.
--
-- This is the same shape as the review bug schema87 fixed: a record that must
-- OUTLIVE the person keeps the row and loses the person. A moderation log that
-- disappeared with its admin would be worse than useless — it is the evidence
-- of why somebody was silenced or a post removed, and the reported person can
-- ask about it. So the action, its target, its reason and its date stay; only
-- «who did it» goes, exactly as `audit_log.admin_id` already does (SET NULL, a
-- nullable column).
--
-- Nothing reads admin_id back into a name: the admin panel lists actions by
-- date and target.

alter table public.moderation_actions
  alter column admin_id drop not null;

alter table public.moderation_actions
  drop constraint moderation_actions_admin_id_fkey;

alter table public.moderation_actions
  add constraint moderation_actions_admin_id_fkey
  foreign key (admin_id) references auth.users(id) on delete set null;

comment on column public.moderation_actions.admin_id is
  'Who took the action, or NULL when that account has since been deleted (schema88). The action itself is never deleted: it is the record of why a post or a person was acted on.';
