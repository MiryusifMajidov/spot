-- ============================================================================
-- SPOT · schema25_lock_chats.sql
--
-- `public.chats` is the server-side half of the fake inbox that was removed from
-- src/data/chats.ts. That file now reads:
--
--   «This held four invented conversations — complete with "online" dots, unread
--    badges and message previews from people who do not exist.»
--
-- The client array was emptied. The four rows behind it were not, and they are
-- still here:
--
--   tural          «Tural M.»                    partner  online=true, unread=true
--   elvin          «Elvin Qasımov»               trainer
--   gym-challenge  «Iron Bay · Avqust challenge» gym
--   sebine         «Səbinə Q.»                   partner
--
-- each with a `last` message preview written in that person's voice. None of
-- them has a profile.
--
-- They are not on screen today: `useChats()` is the only reader and nothing
-- calls it — src/app/chat/index.tsx builds its list from the device's own
-- threads and shows an honest empty state. That is precisely why they are
-- dangerous: a fabricated inbox sitting one wire-up away from the screen, which
-- is how it shipped the first time.
--
-- The table also has no per-user model at all — no owner, no participants, just
-- an `ord` column — so it could only ever show the same four conversations to
-- everybody. And like `messages` it was `SELECT USING (true)` to PUBLIC with
-- full INSERT/UPDATE/DELETE granted to `anon`, meaning anyone with the key
-- shipped in the APK could add a conversation to it.
--
-- Rows deleted, table closed. The two dead hooks (`useChats`, `useMessages`) are
-- removed from src/lib/hooks.ts in the same change.
--
-- ---------------------------------------------------------------------------
-- A real inbox needs the same three things `messages` needs (schema24): an owner
-- or participant model, per-row membership, and policies written against it.
-- ---------------------------------------------------------------------------
--
-- Apply AFTER schema24_lock_messages.sql.
-- ============================================================================

delete from public.chats;

drop policy if exists chats_read on public.chats;
drop policy if exists chats_write on public.chats;

alter table public.chats enable row level security;

revoke all on public.chats from anon, authenticated;

comment on table public.chats is
  'CLOSED to all clients (schema25). Held four fabricated conversations with invented people and message previews written in their voice; was world-readable and world-writable. Has no owner/participant column, so it cannot express a real inbox. Needs a membership model before any client may read it.';
