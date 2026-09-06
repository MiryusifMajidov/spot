-- ============================================================================
-- SPOT · schema54_match_note.sql
--
-- The whole point of a match in this product is a TIME, not a chat. The design
-- says «match söhbətə yox, vaxta aparır», and the app asks for exactly that: the
-- match screen makes the sender pick a slot and a gym before the request goes
-- out.
--
-- Then it throws the answer away. `match.tsx:186` calls
-- `sendMatchRequest(partner.id)` — id only — while the chosen slot is written to
-- the DEVICE store one line below:
--
--   sendRequest(partner.id, `Məşq təklifi: ${slot.label} · ${gym.name}`)
--
-- `match_requests` has no column for it (id, from_profile, to_profile, status,
-- created_at). So the recipient opens their requests and reads «Birlikdə məşq
-- etmək istəyir» with no time, no gym, and nothing to accept or counter — and
-- the sender believes they proposed Wednesday at 19:00 at Iron Bay.
--
-- One column, written by the sender, read by the recipient.
--
-- Apply AFTER schema53_listing_ownership.sql.
-- ============================================================================

alter table public.match_requests
  add column if not exists note text;

-- Short on purpose: this is a proposal, not a message. The «sual = 1 mesaj»
-- channel is a separate thing.
alter table public.match_requests drop constraint if exists match_requests_note_len;
alter table public.match_requests add constraint match_requests_note_len
  check (note is null or char_length(note) <= 200);

-- Written once, by whoever sends the request. It is part of the insert, so it
-- rides the existing `match_requests_insert` policy — nobody can add a note to
-- somebody else's request, and nobody can edit one afterwards (there is no
-- UPDATE grant on this column).
grant insert (note) on public.match_requests to authenticated;

comment on column public.match_requests.note is
  'The workout the sender proposed, in their own words («Ç.a 19:00 · Iron Bay»). Shown to the recipient with the request. Never edited after it is sent.';
