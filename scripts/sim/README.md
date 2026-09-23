# scripts/sim — ten people using SPOT at the same instant

One phone can only be one person. This harness is the other ten: **5 users
(u1–u5), 3 trainers (t1–t3) and 2 gym owners (g1–g2)**, each a separate
anonymous session in one Node process, each sending **exactly the requests the
app sends**, released together behind a barrier so the server really sees them
at the same moment. The owner's own phone can join as an 11th participant.

It exists to find the bugs a single tester can never produce: two people taking
the same @username, a coach deciding four requests at once, a gym rotating its
door code while members scan it, a day pass bought while the owner switches
passes off.

```bash
npm run sim:dry                          # plan + wiring check, ZERO network
node scripts/sim/run.mjs                 # full live run, cleans up after itself
node scripts/sim/run.mjs --only daypass  # setup + that phase (+ what it builds on) + cleanup
```

Always run `--dry` first. It prints every phase, every actor's «TEST …» name
and @sim handle, and what a live run leaves behind, then checks the wiring and
exits non-zero if anything is off. It blocks `fetch` and `WebSocket` and prints
how many calls were attempted — it must say 0.

## Phases

| phase | what happens at the same instant | what must hold |
|---|---|---|
| `setup` | 10 first launches (anonymous sign-in); 10 registrations; t1–t3 publish listings; g1–g2 create gyms and door codes | every write proven by its returned row; the publish lands (listed=true), then the TEST coaches switch «Kəşfdə görün» off again; gym ids unique |
| `race-username` | u4 and u5 save the same @username | exactly one wins; the loser is told «Bu istifadəçi adı tutulub»; a save that never reached the server counts as neither |
| `race-requests` | u1–u5 request t1 (u1 double-taps) | t1 sees exactly 5 pending, no duplicates; t2/t3 see none |
| `decide-concurrently` | t1 accepts u1–u3 and declines u4 | every user reads their true state; public `clients` = 3; an accepted student re-sending the request must not reopen it to pending |
| `program-chat` | t1–t3 save a program; t1 and u1 send their first message; u3 sends two first messages | program ids distinct; u1 opens t1's own program; one thread; the refusal is shown as the person sees it; live delivery to u1, nothing to u2; the one-until-reply gate lets one through |
| `checkins-vs-rotate` | u1–u5 scan g1's code while g1 rotates it | old code dead, occupancy = real successes, one check-in per gym-day; not run within 5 min of 00:00 / 04:00 Baku |
| `daypass` | g2 switches passes off while u4 asks for one | u3 refused `day_pass_off`, u2's pass still valid at reception |
| `privacy` | g1 reads u1's workouts, PRs, weight, messages…; u1 edits g1 / t1's listing; server-rule review probes | all 0 rows / refused; a review below 3 check-ins is refused by `reviews_insert` (see below) |
| `end-student` | two devices of t1 end u2 at once | exactly one end lands; counts drop by one; t1 can no longer open a thread with u2; u2 keeps the assigned program |
| `social` | u1–u5 like u1's TEST post (u4 from two devices), then u2+u3 unlike; u2–u5 comment; u1 likes u2's comment from two devices while u4 likes it; u2–u5 follow u1 (u5 from two devices); u4 and u5 send each other a partner request; u2 asks u3 one-way and u3 accepts — in each racing step the **writes** leave together, after every actor's own reads | `community_posts.likes` = `post_likes` rows after each step (schema82), and the report says whether the writes really overlapped; one row per double tap; u1 reads every comment; a non-author cannot delete one; `followCounts` = TEST rows + rows from outside the run; the crossing asks end as **two accepted rows** with no «Qəbul et» card left anywhere (schema84), and both phones agree now and at the next launch; the accepted one-way offer leaves the same clean state; each match opens one chat; every like/follow/comment-like/reply notifies exactly once, and the match notifications match what each send really wrote. Not run under `--keep` |
| `cleanup` | every actor runs `delete_my_account()` | JWTs stop resolving; every @handle is free again; nothing of the run left in public listings |

Every check is **PASS**, **FAIL** or **UNREACHABLE**. UNREACHABLE means a live
run cannot reach that flow honestly, and says why — it is never faked. Example:
a gym review needs 3 check-ins, and a person can check in once per **gym-day**
(the day turns at 04:00 Baku), so the review happy path, the owner's reply and
the forged-reply stripping need three gym-days.

About the review probes: the app never sends a review below 3 check-ins (the
composer only appears at 3), so these are direct calls with the app's payload,
not a UI path. The server does not *refuse* a forged owner reply — the
`reviews_stamp` trigger blanks it and restamps name and tenure. Below 3
check-ins the insert is refused first, so the stripping is reported
UNREACHABLE; `supabase/schema80_reviews_stamp.sql` records its rolled-back proof.

About the social phase: it only ever touches what this run's TEST actors made
— u1's own post, the TEST comments under it, follows and partner offers
between TEST actors. Liking, commenting on or following a real person's post,
video or profile, and joining an admin challenge (a public participant count),
are UNREACHABLE by rule. Two UI paths are reported UNREACHABLE and the exact
app call is made directly instead: following u1 (the «İzlə» button needs a
video by u1, and a video needs an upload), and finding u2–u5 in each other's
Kəşf lists (a TEST actor has no home gym). The post's insert returns no row
(the app sends no `.select()`), so its id is read back from the feed query
filtered to u1's own posts — the unfiltered feed would fetch real people's
posts. Comments, notifications and incoming offers from anyone outside the run
are counted and dropped, never read further; where an app number counts
everyone (`followCounts`, the card's comment count, a comment's likes), it is
compared with the run's own rows plus the outside rows counted apart
(head-only).

Partner requests are exercised twice, because since `schema84` the two cases
are different flows. **Crossing** (u4 and u5 ask each other at the same
instant): asking somebody who has already asked you is mutual interest, so
`send_match_request` writes that row as `accepted` and the
`match_requests_mutual` trigger settles the opposite row too — the run asserts
two accepted rows, at least one send reading `'accepted'` back (the app reads
the row back, and the screen then says «… da səni seçmişdi — artıq məşq
yoldaşısınız»; the first asker's read-back can land after the trigger and
legitimately read `'accepted'` as well), **no** «Qəbul et» card on either side,
and both phones saying matched now and at the next launch. Two `pending` rows — both sends reading the
opposite direction before the other transaction committed — is the old
half-open pair and FAILs with that explanation, never a silent pass: accepting
one direction would leave the other pending, its sender keeping a «Qəbul et»
card from a partner it is already matched with, and the next launch would
depend on row order (`reconcileMatches` keys the rows by the other person; the
launch read has no ORDER BY). **One-way** (u2 asks u3, a pair the phase has not
matched): the row stays `pending`, u3's «Təkliflər» must show the card, u3
presses «Qəbul et», and both sides must then read matched with no card and no
open offer, at the next launch too — that is what keeps the accept path
covered now that the crossing pair never produces a card. Both pairs then open
a chat (the crossing pair with two first messages at the same instant, the
one-way pair with one message each way).

The match notifications are built from what each send **really** wrote, not
from the fact that it was sent: a row written `pending` means one
`match_request` to the person asked; a row born `accepted` means **no**
`match_request` and one `match_accepted` to whoever asked first; every «Qəbul
et» that reached the server adds one `match_accepted` to the sender of that
offer. Exactly one per (type, actor), for u2 and u3 as well as u4 and u5.
Which of the crossing asks arrived second — the one written `accepted` — is
read from the two rows' `created_at` (a transaction that saw the other
direction must have started after it committed), not from the read-backs,
which can both say `accepted`. If that cannot be established the crossing
pair's two notifications are reported UNREACHABLE
(`social.notif-match-cross`) instead of guessed.

Starting together is not writing together. Each app action reads first
(`auth.getUser`, the caller's profile row) and writes last, so actions released
at the same instant would send their writes tens of ms apart — while a
`tg_post_likes` transaction lasts a few. So in every racing social step each
actor does its own reads, then waits at a second barrier, and all the writes
leave at once (`together()`'s `alignWrite`; the app's calls and their order are
unchanged). The report then says whether the writes overlapped: client side,
whether every write was in flight at once; inside the database, from the rows'
`created_at` (it defaults to `now()`, the start of the writing transaction).
Starts more than ~5 ms apart (an estimate of one write transaction, not a
measurement; the offsets are printed) count as «probably one after another»,
and then `social.likes-counter-matches` says the counter is right but is no
evidence about the lock, and `social.likes-no-overlap` asks for a re-run. A
delete leaves no timestamp, so the unlike step's database side is not judged.

Output: the console summary, and `scripts/sim/last-report.json` (gitignored)
with every check, every concurrent step (how many calls, their start spread in
ms, which were refused; for steps that race writes also `write`: how many left,
their spread, and how long all were in flight together), the inventory each
actor held before deleting itself, and the leftovers.

## The phone (optional)

```bash
node scripts/sim/run.mjs --phone-trainer <trainerId> --phone-gym <gymId> --phone-code <doorCode> --phone-wait 60
```

- `--phone-trainer`: u1–u5 also send a trainer request to this listing, at the
  same instant as to t1. Before anything is sent, the harness checks that the
  listing is public and belongs to **@yghh** (`--phone-username` to change it);
  if not, the phone is left out and the check says why.
- `--phone-gym` + `--phone-code` (always together): u4 and u5 check in at the
  phone's gym instead of g1 (one check-in per person per gym-day, so they cannot
  do both). A door code cannot be checked before it is used, so the gym it must
  open is named: the harness first proves that gym belongs to @yghh, then u4
  checks in **alone**, and only if that check-in landed at `--phone-gym` does u5
  follow. A wrong code therefore puts at most one TEST check-in into another
  gym, and it goes with u4's account at cleanup.
- `--phone-owner-profile <uuid>`: if @yghh's profile is hidden from member
  lists (show_in_gym_list off), its handle cannot be read; the guards then
  compare the listing's `owner_id` with this uuid instead.
- `--phone-wait N`: before cleanup, wait N seconds so the requests can be
  accepted or declined on the phone, then report what each user sees. The TEST
  coaches are unlisted before the wait starts.

## Safety rules

- **Public key only.** Read from `.env` (`EXPO_PUBLIC_SUPABASE_URL` /
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`), never from the shell. A secret or
  service-role key makes the harness refuse to start.
- **Anonymous sessions, clearly marked.** `signInAnonymously()`, exactly like the
  app's first launch. Display names start with `TEST `, handles with
  `sim_<runId>_`.
- **Same requests as the app.** Every call carries a `// app: <file>:<line>`
  anchor; `--dry` checks each anchor still points at a line that makes the same
  call. Functions named `probe*` are the deliberate exceptions: the privacy
  phase's adversarial reads and writes, which is what an attacker with the
  public key could send.
- **No real person's data.** Reads that would touch other people are not made
  (the gym page's country-wide live check-in count) or are filtered to this run's
  own profiles (a trainer's request list, the inbox). The only real account
  involved is the owner's test account, and only through the flags above.
- **No trap for real people.** A TEST coach is public only for the seconds
  between its publish and its unlist in setup; the TEST post only during the
  `social` phase and cleanup. Whatever a real person sends to a TEST actor (a
  request, a chat, a match request, a follow, a like on its post or comment)
  would be cascade-deleted with it, and a comment under its post orphaned, so
  cleanup **counts** such rows (never reads them), lists them as leftovers and
  fails `cleanup.no-real-user-rows`. Two residues the public key can neither
  read nor count, so that check cannot see them: a real person's **report**
  («Şikayət et» on the TEST post: `target_type content`, `target_id` = the post
  id; from the comments sheet it reports the commenter: `target_type user`,
  `target_id` = the profile id — `reports.target_id` is text, so the row is not
  cascaded and stays in the moderation queue), and a real person's **block** of
  a TEST actor (deleted with the account, uncounted). Cleanup prints
  `cleanup.reports-unverifiable` and puts the ids to check in
  `report.expectedDeleted.reports_to_check`; check them with read-only SQL.
- **No faked facts.** No privileged SQL, ever; unreachable flows are reported.
- **The door code stays secret.** `--phone-code` is redacted in the report's
  `meta.argv`; the codes rotated during the run are never recorded.
- **Cleans up after itself** — at the end, on an error, on Ctrl+C, SIGTERM, a
  closed terminal, or a crash. After an abort no new concurrent step starts; the
  one in flight settles (every request is capped at 20 s), then every actor
  deletes itself. A second Ctrl+C leaves at once, but first writes the report
  and prints every actor that still exists. `--keep` skips the deletion (the
  TEST coaches are still unlisted) and prints every actor that is still there.
  The `social` phase does **not** run under `--keep` (reported UNREACHABLE as
  `social.keep`; `--keep --only social` is refused): its TEST post is public in
  the İcma feed and only goes when u1 deletes its account, so a kept run would
  leave it there with no end date. Should a TEST post exist under `--keep`
  anyway, it is listed as a `kept-public-post` leftover.

## What a live run leaves behind

The app has no way to delete these, so neither does the harness:

- **2 TEST gyms** and their door codes. `delete_my_account()` keeps a gym row and
  detaches its owner, and the row stays **usable**: `check_in_with_code` and
  `create_day_pass` look at neither owner nor listed. So before deleting, each
  owner switches day passes off (its own «Zal profili» edit) and rotates the
  door code to one nobody has seen. The rows still need an admin to remove them.
- **The TEST day-pass rows.** `day_passes.user_id` and `day_passes.gym_id` are
  both `ON DELETE SET NULL`: **delete the passes by id first, then the gyms**,
  or the passes are left with neither a user nor a gym and can never be found.
- With `--phone-trainer`: **5 notifications** in @yghh's Bildirişlər, their
  sender removed.

While the `social` phase runs, **one «TEST post …» is public** in the İcma feed
(people without a home gym see it). The app has no delete-post path (the post
menu offers «Şikayət et» / «Bu postu gizlət»), so it goes when u1 deletes its
account: `delete_my_account()` deletes the account's posts and comments, and
post likes, comment likes, follows, partner requests and notifications cascade.
The bare key can read posts, comments and comment likes, so cleanup proves
those gone by id and by run id; the rest are not readable with it. A real
person's like on the TEST post would go with the post; a real person's
**comment** would stay behind orphaned (`comments.target_key` is text with no
foreign key). Both are counted at cleanup, never read, and fail
`cleanup.no-real-user-rows`. A real person's **report** of the post or of a
TEST commenter, and a **block** of a TEST actor, cannot be counted (see «No
trap for real people»): check `report.expectedDeleted.reports_to_check` with
read-only SQL.

The accounts delete themselves at the same instant, and after the `social`
phase they share rows (likes, comments, comment likes, follows) and the post
those point at, so two deletions can lock them in opposite order and one gets
`deadlock detected` (40P01). That is reported as
`cleanup.concurrent-delete-deadlock.<actor>` and retried alone — not a harness
fault, and a real app finding: two people who interacted, deleting their
accounts at the same moment, and one is told «Hesab silinmədi».

`last-report.json → leftovers` lists them by id. Programs are deleted by their
authors before the accounts go (every program each actor owns, per its own
inventory); an actor whose program cannot be deleted is kept, unlisted, and
reported, so the program stays removable. While a run is going, up to three
«TEST proqram …» rows are readable in the library (`programs_read` is public).

Root fix, not made (a database change, needs the owner's approval):
`delete_my_account()` should also delete the caller's never-listed gyms that no
profile or trainer references, their day passes first.

## Limits

- Anonymous sign-ins are rate-limited per IP by Supabase Auth; a full run uses
  10. `--only <phase>` creates only the actors that phase needs.
- The gym pages are unlisted, so a member cannot open g1/g2 in the app; the
  day-pass checks call `create_day_pass`, the exact RPC the button sends, and
  say so (UNREACHABLE for the UI path).
- The gym roster lists people whose **home** gym is that gym. Profil → Redaktə
  offers listed gyms only, so the roster's «indi zalda» flag cannot be exercised.
- A public-key read cannot see an unlisted gym, so the post-cleanup gym reads
  are INFO only; the profiles are verified through `username_taken()`.
- The bootstrap syncs that do nothing for a fresh account (training history,
  exercise videos, social, partner requests) are not mirrored in setup. The
  `social` phase mirrors the partner-request launch sync (`reconcileMatches`)
  to show what the next launch would display, for both row orders.
- `followCounts()` exists in `src/lib/social.ts` but no screen calls it: the
  app shows no follower number or list. The phase checks it anyway, plus each
  follower's own `myFollowing()` list (what the feed does read).
