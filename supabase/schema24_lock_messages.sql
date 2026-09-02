-- ============================================================================
-- SPOT · schema24_lock_messages.sql
--
-- PRIVACY. `public.messages` was readable by everyone:
--
--   messages_read   SELECT  to PUBLIC  USING (true)
--   messages_insert INSERT  to authenticated  WITH CHECK (not is_sanctioned(auth.uid()))
--
-- PUBLIC includes `anon`, and the anon key ships inside the APK. So anybody
-- holding that key could read every private conversation in the app, and any
-- signed-in account could write a row into any `chat_id` at all. The table has
-- no sender column — only `from_me boolean`, decided by the client — so an
-- inserted row is attributed to whichever side the writer chooses.
--
-- This contradicts the product's stated red line directly: nobody, not an admin
-- and not a gym owner, may read a member's chat archive. Here it was not even
-- limited to them.
--
-- It also holds nothing real. All four rows are one seeded demo conversation,
-- `chat_id = 'tural'`, written 2026-08-22, and two of them carry `from_me =
-- false` — invented words attributed to a person who has no profile. That is the
-- same fabrication already removed from src/data/chats.ts, which now documents
-- why: «SPOT never writes a message and puts someone else's name on it.»
--
-- And nothing uses the table. `useMessages()` in src/lib/hooks.ts is its only
-- reference and is called from nowhere; the chat screen reads `useDb.threads`,
-- which is device-local. There is no writer at all.
--
-- So this closes the table completely rather than guessing at a membership rule
-- that does not exist yet.
--
-- ---------------------------------------------------------------------------
-- BEFORE CHAT GOES SERVER-SIDE, THIS TABLE NEEDS:
--   · a real sender column (`sender_id uuid references profiles(id)`), because
--     `from_me` is a client-controlled boolean and cannot identify anyone;
--   · a membership model — a `chat_members` table, or participant columns on a
--     `chats` table — so "may I read this thread" is an answerable question;
--   · SELECT and INSERT policies written against that membership.
-- Re-granting access without all three re-opens exactly this hole.
-- ---------------------------------------------------------------------------
--
-- Apply AFTER schema23_real_trainer_counts.sql.
-- ============================================================================

delete from public.messages where chat_id = 'tural';

drop policy if exists messages_read on public.messages;
drop policy if exists messages_insert on public.messages;

alter table public.messages enable row level security;

revoke all on public.messages from anon, authenticated;

comment on table public.messages is
  'CLOSED to all clients (schema24). Was world-readable via `messages_read USING (true)` to PUBLIC. Needs sender_id + a membership model + membership-based policies before any client may touch it again. The chat UI currently keeps threads on-device (useDb.threads).';
