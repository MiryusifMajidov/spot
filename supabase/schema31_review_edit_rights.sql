-- ============================================================================
-- SPOT · schema31_review_edit_rights.sql
--
-- Two findings on `reviews`, from testing the whole review lifecycle live:
--
-- 1. A MEMBER COULD NOT EDIT THEIR OWN REVIEW. `authenticated` holds UPDATE on
--    `(reply, reply_at)` only — schema9 narrowed it so a gym owner could not
--    rewrite a member's words — but that also locked out the author, who has an
--    edit affordance on screen. The update failed with «permission denied for
--    table reviews», which is not a message the app can explain.
--
-- 2. `anon` still holds UPDATE on EVERY column of reviews, `author_id` included.
--    It is inert today because all three UPDATE policies are `to authenticated`,
--    so RLS refuses an anonymous request whatever the grant says. It is left in
--    place only until someone adds a PUBLIC policy — then it is a review table
--    anyone can rewrite. Revoked.
--
-- Widening the grant back to the author's columns re-opens schema9's hole,
-- because policies are OR'd: the gym owner satisfies `reviews_owner_reply` and
-- would then have the columns to change `body` and `rating` too. RLS cannot
-- restrict columns and the grant cannot tell the two roles apart — both are
-- `authenticated`. So a trigger draws the line, the same way schema28 does for
-- who may decide a trainer request:
--
--   · the AUTHOR may change what they wrote (body, rating, name, tenure) and
--     nothing else;
--   · the GYM OWNER may change the official reply and nothing else.
--
-- Apply AFTER schema30_review_eligibility.sql.
-- ============================================================================

revoke update on public.reviews from anon;

grant update (body, rating, name, tenure) on public.reviews to authenticated;
-- (reply, reply_at stay granted from schema9 — the owner's half.)

create or replace function public.reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare is_author boolean; is_owner boolean;
begin
  is_author := exists (
    select 1 from public.profiles p
     where p.id = old.author_id and p.user_id = auth.uid()
  );
  is_owner := exists (
    select 1 from public.gyms g
     join public.profiles p on p.id = g.owner_id
     where g.id = old.gym_id and p.user_id = auth.uid()
  );

  -- The reply belongs to the gym.
  if (new.reply is distinct from old.reply or new.reply_at is distinct from old.reply_at)
     and not is_owner then
    raise exception 'only_the_gym_may_reply' using errcode = '42501';
  end if;

  -- The review belongs to the member who wrote it.
  if (new.body    is distinct from old.body
   or new.rating  is distinct from old.rating
   or new.name    is distinct from old.name
   or new.tenure  is distinct from old.tenure)
     and not is_author then
    raise exception 'only_the_author_may_edit' using errcode = '42501';
  end if;

  -- Neither of them may change whose review it is, or which gym it is about.
  if new.author_id is distinct from old.author_id or new.gym_id is distinct from old.gym_id then
    raise exception 'review_identity_is_fixed' using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists reviews_guard_edits on public.reviews;
create trigger reviews_guard_edits
  before update on public.reviews
  for each row execute function public.reviews_guard();
