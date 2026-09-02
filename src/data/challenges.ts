export interface LeaderRow {
  rank: number;
  name: string;
  value: string;
  me?: boolean;
  delta?: string;
}

export interface Challenge {
  id: string;
  title: string;
  scope: 'gym' | 'personal' | 'solo';
  scopeLabel: string;
  description: string;
  progress: number;
  target: number;
  unit: string;
  daysLeft: number;
  reward: string;
  participants: number;
  leaderboard: LeaderRow[];
}

export const activeChallenge: Challenge = {
  id: 'aug-12',
  title: 'Avqust · 12 məşq',
  scope: 'gym',
  scopeLabel: 'Iron Bay · komanda',
  description: 'Avqust ayında 12 məşq tamamla. Zal üzvlüyü qazanma şansı.',
  progress: 8,
  target: 12,
  unit: 'məşq',
  daysLeft: 11,
  reward: '1 aylıq üzvlük',
  participants: 0, // never counted anywhere - a real join count would have to come from the server
  // Empty on purpose — this held an invented ranking (Tural M., Kamran, Nigar Ə.,
  // Orxan) with «Sən» placed 7th and «+2 yer». Joining a challenge is recorded
  // on the device, so no ranking can be computed at all; the detail screen
  // already says «Uydurma sıralama göstərmirik» and this was the data that
  // would have contradicted it.
  leaderboard: [],
};

export const streakChallenge = {
  title: 'Streak-i qırma',
  scopeLabel: 'Şəxsi · 21 gün',
  description: 'Ardıcıl 21 gün ən azı 1 məşq. 8 gün qalıb.',
  progress: 13,
  target: 21,
  streak: 13,
};

export const joinable: Challenge[] = [
  {
    id: 'cross-100t',
    title: 'Zallar arası: 100 ton',
    scope: 'gym',
    scopeLabel: 'Komanda',
    description: 'Zalın ümumi qaldırdığı çəki 100 tona çatsın. Zallar üzv başına normalizasiya ilə yarışır.',
    progress: 68,
    target: 100,
    unit: 't',
    daysLeft: 20,
    reward: 'Zal reytinqində 1-ci yer',
    participants: 0, // never counted anywhere - a real join count would have to come from the server
    leaderboard: [],
  },
  {
    id: 'first-5-pullups',
    title: 'İlk 5 dartma',
    scope: 'solo',
    scopeLabel: 'Yeni başlayanlar · 4 həftə',
    description: '4 həftədə ilk 5 təmiz dartmaya çat. Addım-addım proqram daxil.',
    progress: 2,
    target: 5,
    unit: 'dartma',
    daysLeft: 28,
    reward: 'Nişan + proqram',
    participants: 0, // never counted anywhere - a real join count would have to come from the server
    leaderboard: [],
  },
];

export const allChallenges = [activeChallenge, ...joinable];
export const getChallenge = (id: string) => allChallenges.find((c) => c.id === id);

/** Cross-gym ranking — normalized per member so a big gym does not win automatically.
 *
 *  Empty on purpose. Nothing in the app has ever written `gyms.tons`, so every
 *  figure that used to sit here ("Volt Gym 74 t / 340 uzv") was invented. Real
 *  tonnage can only be produced by summing workouts across a gym's members, and
 *  workouts are owner-scoped by RLS — so it has to come from the aggregate-only
 *  `gym_tonnage_ranking()` RPC (supabase/schema10_certs_and_fiction.sql), never
 *  from a seed. Until that returns rows the screen shows its empty state. */
export const gymRanking: { gym: string; tons: number; members: number; perMember: number; me?: boolean }[] = [];
