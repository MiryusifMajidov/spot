-- schema71 — a «rəyinə cavab gəldi» notification that knows which gym it means
--
-- `tg_notify_review_reply` (schema35 §4h) wrote the REVIEW's id into `entity_id`
-- and left `target_key` null. But the screen a person needs to land on is the
-- GYM's page, on its Rəylər segment — the review id is not a destination. The
-- app worked around it by reading `reviews` again on every tap just to turn the
-- review id back into a gym id, which is a whole round trip the notification
-- could have carried, and which fails (and then says so) whenever the network
-- does.
--
-- The gym id now travels in `target_key`. `entity_id` keeps the review id, so
-- the client can still highlight the exact review and so nothing that already
-- reads it breaks — and rows written before today still have a null target_key,
-- which is why the lookup stays in the app as a fallback rather than being
-- deleted.

create or replace function public.tg_notify_review_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_profile uuid;
begin
  if new.reply is not null and new.reply is distinct from old.reply then
    select g.owner_id into owner_profile from public.gyms g where g.id = new.gym_id;
    -- target_key = the gym (where to go), entity_id = the review (what it is about).
    perform public.notify(
      new.author_id, owner_profile, 'review_reply', new.gym_id::text, new.id::text
    );
  end if;
  return new;
end $$;

-- schema63 removed the default EXECUTE grant on new public functions, and this
-- one is only ever called by the trigger, so no grant is added here.
revoke execute on function public.tg_notify_review_reply() from public, anon, authenticated;

drop trigger if exists reviews_notify_reply on public.reviews;
create trigger reviews_notify_reply after update on public.reviews
  for each row execute function public.tg_notify_review_reply();
