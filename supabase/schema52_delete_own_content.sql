-- ============================================================================
-- SPOT · schema52_delete_own_content.sql
--
-- schema40 keeps the person's videos and posts and only detaches the author
-- (`ON DELETE SET NULL`). The reasoning was sound for gyms and programs — other
-- members depend on those. It is NOT sound for feed videos and community posts,
-- and now it is actively broken:
--
--   · schema51 fixed the storage cleanup, so the account's video FILES are now
--     really deleted. A kept `feed_videos` row therefore points at a URL that
--     404s: the feed shows a permanently dead card credited to «SPOT
--     istifadəçisi».
--   · the confirmation the person taps says «videoların, şəkillərin, şərhlərin …
--     serverdən silinir». Keeping them makes that sentence false, and it is the
--     sentence somebody reads before an irreversible decision.
--
-- So the person's OWN content goes with them:
--
--   feed_videos, community_posts   · deleted. Theirs, and the file is gone.
--   comments                        · deleted. Theirs.
--   reviews                         · KEPT, author detached. A review is a fact
--                                     about a gym that other people acted on;
--                                     removing it rewrites the gym's rating
--                                     behind their backs. It becomes anonymous.
--   gyms, programs                  · KEPT, owner detached. A place and a plan
--                                     other members are using.
--
-- The privacy screen's text is updated in the same change to say exactly this.
--
-- Apply AFTER schema51_my_storage.sql.
-- ============================================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare uid uuid; pid uuid;
begin
  uid := auth.uid();
  if uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select p.id into pid from public.profiles p where p.user_id = uid;

  -- Storage is NOT touched here: Supabase refuses a direct DELETE on
  -- `storage.objects`. The client removes the files first, through
  -- `my_storage_objects()` + `storage.remove()` (schema51), so a failure there
  -- stops the deletion rather than orphaning the files.

  if pid is not null then
    -- The person's own content. Their video files have just been deleted, so
    -- keeping the rows would leave dead cards in the feed.
    delete from public.feed_videos     where author_id = pid;
    delete from public.community_posts where author_id = pid;
    delete from public.comments        where author_id = pid;

    -- Not covered by a CASCADE from `profiles`: a block row where this account
    -- is the BLOCKED side is keyed on the other person's blocker_id.
    delete from public.blocks where blocked_id = pid or blocker_id = pid;
    delete from public.profiles where id = pid;
  end if;

  delete from auth.users where id = uid;
end $$;

comment on function public.delete_my_account is
  'Deletes the caller''s own account: their profile (with every CASCADE it owns), their feed videos, community posts and comments, and their auth user. Reviews, gyms and programs survive with the author detached, because other people depend on them. Storage files are removed by the client first. Irreversible.';
