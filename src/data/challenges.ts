export interface Challenge {
  id: string;
  title: string;
  scope: 'gym' | 'personal' | 'solo';
  scopeLabel: string;
  description: string;
  target: number;
  unit: string;
  /** Published by an admin. The app reads this — «Dayandır» in the panel is real. */
  active: boolean;
  startsAt: string | null;
  /** When it stops. NULL = open-ended. Replaces the old `daysLeft` int, which
   *  nothing decremented, which is how an August challenge stayed live in
   *  September. */
  endsAt: string | null;
  reward: string | null;
  /** Real count of `challenge_members` rows, kept by a trigger (schema43). */
  participants: number;
}

/** One row of a challenge ranking, as `challenge_standings()` returns it.
 *  `done` is null when the challenge unit is not something SPOT can measure. */
export interface Standing {
  profileId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  done: number | null;
  isMe: boolean;
}

/* There are no seeded challenges any more.
 *
 * Three used to live here and in schema2's seed block: «Avqust · 12 məşq» with
 * progress 8/12, «Zallar arası: 100 ton» with 68/100 and «İlk 5 dartma» with 2/5.
 * Nobody authored them, nobody had joined a single one, and their progress bars
 * described a person who does not exist — the app then showed the August one as
 * the live challenge in September, because `days_left` was an int nothing could
 * decrement. schema60 deletes the rows; these literals go with them.
 *
 * A challenge now exists only when an admin creates and publishes one, with a
 * real end date. If the server has none, the screen says so. It does not invent
 * one to fill the space. */

/** The 21-day streak card. NOT a database challenge: `target` is the only fixed
 *  number and the progress beside it is computed from the person's own logs, so
 *  there is nothing here that could be a claim about them. */
export const streakChallenge = {
  /* «Streak-i qırma» until now. The app calls this counter «seriya»
     everywhere else — the profile badge, achievements, analytics, the
     check-in screen — and the sentence directly above this card on the
     challenge screen was changed to «seriya» too, so the card contradicted
     the line it sat under. */
  title: 'Seriyanı qırma',
  scopeLabel: 'Şəxsi · 21 gün',
  target: 21,
};

/** Cross-gym ranking — normalized per member so a big gym does not win automatically.
 *
 *  Empty on purpose. Nothing in the app has ever written `gyms.tons`, so every
 *  figure that used to sit here ("Volt Gym 74 t / 340 uzv") was invented. Real
 *  tonnage can only be produced by summing workouts across a gym's members, and
 *  workouts are owner-scoped by RLS — so it has to come from the aggregate-only
 *  `gym_tonnage_ranking()` RPC (supabase/schema10_certs_and_fiction.sql), never
 *  from a seed. Until that returns rows the screen shows its empty state. */
export const gymRanking: { gym: string; tons: number; members: number; perMember: number; me?: boolean }[] = [];
