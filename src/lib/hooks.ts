import { useEffect, useMemo, useState } from 'react';

import { exerciseLibrary, timeAgoAz, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';

import { gymRanking as mockRanking, streakChallenge, Challenge, Standing } from '@/data/challenges';
import { communityPosts as mockPosts, feedVideos as mockVideos, CommunityPost, FeedVideo } from '@/data/feed';
// NOTE: `trainers` and `partnersForGym` are deliberately NOT imported any more —
// people are never seeded into a list the user can act on.
import { gyms as mockGyms, programs as mockPrograms, pushExercises } from '@/data/mock';
import { meals as mockMeals, shoppingList as mockShop, Meal, ShopItem } from '@/data/nutrition';
import { Exercise, Gym, Partner, Program, Trainer } from '@/data/types';
import { getPartner as apiGetPartner, byCompatibility, getGyms, getPartnersAtGym } from '@/lib/api';
import { supabase, hasSupabaseConfig } from '@/lib/supabase';
import { nonEmpty, useFetchPhase, useFocusFetch } from '@/lib/focusFetch';
import { isPlaceholderName } from '@/lib/authorName';
import { myFollowing } from '@/lib/social';

/** Generic list hook: mock until Supabase configured, then live data (mock stays as fallback on error). */
function useList<T>(fallback: T[], fetcher: () => Promise<T[]>, deps: unknown[] = []): T[] {
  // Local-first: show seed data immediately; Supabase (if configured) overrides on load.
  const [data, setData] = useState<T[]>(fallback);
  useEffect(() => {
    if (!hasSupabaseConfig) return;
    let alive = true;
    fetcher()
      .then((d) => alive && d.length && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}

function useOne<T>(fallback: T | null, fetcher: () => Promise<T | null>, deps: unknown[] = []): T | null {
  // Local-first: show seed data immediately; Supabase (if configured) overrides on load.
  const [data, setData] = useState<T | null>(fallback);
  useEffect(() => {
    if (!hasSupabaseConfig) return;
    let alive = true;
    fetcher()
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return data;
}


/** Module-level so an empty list keeps the same reference across renders — a
 *  selector that builds a fresh array every time loops React forever. */
const NO_PARTNERS: Partner[] = [];
const NO_CHALLENGES: Challenge[] = [];
const NO_TRAINERS: Trainer[] = [];

// ---------------- mappers ----------------
/** A stored day is `{title, focus, exercise_ids[]}` (see workout/create.tsx). Resolve
 *  the ids against the exercise library so a program really carries the moves its
 *  author picked — an unresolved day stays empty rather than being invented from
 *  its title. */
function mapDayExercises(d: any): Exercise[] {
  const ids: string[] = Array.isArray(d?.exercise_ids) ? d.exercise_ids : [];
  return ids
    .map((id) => exerciseLibrary.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => ({
      id: x.id,
      name: x.name,
      muscle: x.muscle,
      sets: x.defaultSets,
      reps: x.reps,
      commonMistake: x.commonMistake,
      substitutes: x.substitutes,
    }));
}

function mapProgram(r: any): Program {
  return {
    id: r.id,
    title: r.title,
    creatorName: r.creator_name,
    creatorType: r.creator_type,
    creatorVerified: r.creator_verified,
    weeks: r.weeks,
    daysPerWeek: r.days_per_week,
    level: r.level,
    goal: r.goal,
    paid: r.paid,
    price: r.price ?? undefined,
    rating: r.rating,
    minutes: r.minutes,
    videoCount: r.video_count,
    doneBy: r.done_by,
    hasMealPlan: r.has_meal_plan,
    tags: r.tags ?? [],
    saves: r.saves ?? 0,
    days: (r.days ?? []).map((d: any) => ({ title: d.title, focus: d.focus, exercises: mapDayExercises(d) })),
  };
}
const mapTrainer = (r: any): Trainer => ({
  id: r.id, name: r.name, verified: r.verified, gymId: r.gym_id, specialty: r.specialty,
  rating: r.rating, clients: r.clients, responseTime: r.response_time, priceFrom: r.price_from,
  bio: r.bio, certifications: r.certifications ?? [], photoUrl: r.photo_url ?? null,
});
/* No `progress` and no `leaderboard` any more: schema60 dropped both columns.
   A challenge has no single progress — only each participant's — and the ranking
   is counted by `challenge_standings()` from real workout rows. `daysLeft` is
   gone too; `endsAt` is a date the app can actually compare against now. */
const mapChallenge = (r: any): Challenge => ({
  id: r.id, title: r.title, scope: r.scope, scopeLabel: r.scope_label, description: r.description,
  target: r.target, unit: r.unit, reward: r.reward ?? null,
  active: !!r.active, startsAt: r.starts_at ?? null, endsAt: r.ends_at ?? null,
  participants: r.participants ?? 0,
});
/* There is no stand-in for a video nobody uploaded.
 *
 * This used to substitute Big Buck Bunny / Sintel / a jellyfish clip whenever a
 * feed row had no `video_url` — so a cartoon played under a caption written as
 * deadlift coaching, credited to a "verified" trainer. A missing source is now
 * an empty string, and the feed renders that as an honest unavailable card
 * instead of playing something the author never posted. */
const mapVideo = (r: any): FeedVideo => ({
  id: r.id, author: r.author, authorId: r.author_id ?? null,
  verified: r.verified, isTrainer: r.is_trainer, caption: r.caption,
  hashtags: r.hashtags ?? [], likes: r.likes ?? 0, comments: r.comments ?? 0,
  linkedProgramTitle: r.linked_program_title, linkedProgramId: r.linked_program_id,
  gradient: (r.gradient ?? ['#3A3A44', '#101014']) as [string, string],
  videoUrl: r.video_url ?? '',
  durationSec: r.duration_sec ?? null,
});
const mapPost = (r: any): CommunityPost => ({
  // Always compute the age from the real timestamp — the stored `time_ago`
  // column is written once and would otherwise read "indi" forever.
  id: r.id, author: r.author, authorId: r.author_id ?? null, gym: r.gym,
  timeAgo: r.created_at ? timeAgoAz(r.created_at) : (r.time_ago ?? ''),
  type: r.type, text: r.body,
  stats: r.stats ?? undefined, likes: r.likes ?? 0, comments: r.comments ?? 0, trainerComment: r.trainer_comment ?? undefined,
});
const mapMeal = (r: any): Meal => ({
  id: r.id, name: r.name, time: r.slot, kcal: r.kcal, protein: r.protein, carb: r.carb, fat: r.fat,
  eaten: /Səhər|Nahar/.test(r.slot ?? ''), postWorkout: r.post_workout, ingredients: r.ingredients ?? [],
});
const mapShop = (r: any): ShopItem => ({ id: r.id, name: r.name, qty: r.qty, price: Number(r.price), got: false });

/* Moderator takedowns stamp `hidden_at` (schema18). Every catalogue read below
   filters on it — without that, content the admin panel reports as removed stays
   live in the app, which is both a lie to the moderator and a failure to act on
   whatever was reported. */
// ---------------- content hooks ----------------
/** Programs, reloaded on focus so a freshly created program shows in the library. */
export const usePrograms = () => {
  const mine = useDb((s) => s.myPrograms);
  const remote = useFocusFetch<Program[]>('programs', mockPrograms, async () => {
    const { data, error } = await supabase.from('programs').select('*').is('hidden_at', null).order('saves', { ascending: false });
    if (error) throw error;
    return nonEmpty((data ?? []).map(mapProgram));
  });
  // The user's own programs always come first and are never hidden by the catalog.
  return useMemo(() => {
    const ids = new Set(mine.map((p) => p.id));
    return [...mine, ...remote.filter((p) => !ids.has(p.id))];
  }, [mine, remote]);
};

/** A program the user created is a first-class program — look there first. */
export const useProgram = (id: string) => {
  const mine = useDb((s) => s.myPrograms.find((p) => p.id === id));
  const fetched = useOne<Program>(mockPrograms.find((p) => p.id === id) ?? null, async () => {
    const { data, error } = await supabase.from('programs').select('*').eq('id', id).is('hidden_at', null).maybeSingle();
    if (error) throw error;
    return data ? mapProgram(data) : null;
  }, [id]);
  return mine ?? fetched;
};

export const useGyms = () => {
  // Local-first: seeds render instantly, the server overrides once it answers.
  return useFocusFetch<Gym[]>('gyms', mockGyms, async () => nonEmpty(await getGyms()));
};

/** REAL people at this gym (other SPOT users), refreshed on focus. This is now the
 *  ONLY source of partners — there is no demo catalogue behind it. */
function useRealPartners(gymId: string): Partner[] {
  // An empty result is real information here (nobody else at this gym yet), so it
  // is cached and shown rather than treated as "no answer".
  return useFocusFetch<Partner[]>(gymId ? `partners:${gymId}` : '', NO_PARTNERS, () =>
    getPartnersAtGym(gymId)
  );
}

/** Everyone available at `gymId` — REAL registered SPOT users only, ranked by the
 *  compatibility algorithm. Declined and blocked people drop out.
 *
 *  The demo catalogue used to be merged in here, so a new user was shown twelve
 *  invented people with match scores, PRs and an enabled «Məşq təklif et» button;
 *  nobody ever answered, because nobody was there. An empty list is the truth on a
 *  fresh install and every consumer already has an honest empty state for it. */
export const usePartnersForGym = (gymId: string): Partner[] => {
  const matches = useDb((s) => s.matches);
  const blocked = useAppStore((s) => s.blocked);
  const real = useRealPartners(gymId);
  return useMemo(
    () =>
      real
        // Filters first, ranking second: a blocked or declined person is removed
        // outright, never merely pushed down the list.
        .filter((p) => matches[p.id]?.state !== 'declined' && !blocked.includes(p.id))
        // Partners whose score could not be computed (null) sort last rather
        // than being silently treated as 0.
        .sort(byCompatibility),
    [matches, real, blocked]
  );
};

/** Fresh cards: same gym, not yet acted on (no request / match / decline). */
export const usePartnerDeck = (gymId: string): Partner[] => {
  const all = usePartnersForGym(gymId);
  const matches = useDb((s) => s.matches);
  return useMemo(() => all.filter((p) => !matches[p.id]), [all, matches]);
};

/** One partner — the real user behind this id, or null. The seeded demo people are
 *  gone from the lists, so an old saved/declined seed id must not keep opening a
 *  fabricated profile either. */
export const usePartner = (id: string): Partner | null =>
  useFocusFetch<Partner | null>(id ? `partner:${id}` : '', null, () => apiGetPartner(id));

/** Only REAL registered trainers. On a fresh install this is empty, and the
 *  discover screen's honest «Hələ müəllim yoxdur…» state is what the user sees —
 *  instead of three invented people, two of them wearing a verified badge. */
export const useTrainers = () =>
  useFocusFetch<Trainer[]>('trainers', NO_TRAINERS, async () => {
    const { data, error } = await supabase.from('trainers').select('*').eq('listed', true);
    if (error) throw error;
    return nonEmpty(byVerification(data ?? []).map(mapTrainer).filter(isRealTrainer));
  });

/** «Doğrulanmayıb» is not only a tag. The design says an unverified trainer is
 *  ALSO ranked lower, and that half of the rule is what actually protects the
 *  customer: an approved coach (ID + certificate + gym approval) must never sit
 *  below someone who signed up five minutes ago.
 *
 *  `verify_status` is the authority ('unverified' | 'pending' | 'approved' |
 *  'rejected'); rows written before that column existed only carry the boolean,
 *  so it stands in. Sorted client-side on purpose: a Postgres `.order()` on a
 *  nullable column puts NULLs first, which is exactly the wrong end. */
function verifyRank(r: { verify_status?: string | null; verified?: boolean | null }): number {
  const s = typeof r.verify_status === 'string' ? r.verify_status.toLowerCase() : '';
  if (s === 'rejected') return 3;
  if (s === 'approved' || r.verified === true) return 0;
  if (s === 'pending') return 1;
  return 2; // unverified / unknown
}

/** Verified first, everything else in its original order (Array.sort is stable). */
function byVerification<T extends { verify_status?: string | null; verified?: boolean | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => verifyRank(a) - verifyRank(b));
}

/** A listing nobody would recognise as a person is not a listing.
 *  Every anonymous sign-in can leave a half-filled row behind — the same reason
 *  `looksComplete` exists for partner profiles in src/lib/api.ts — and a public
 *  «Sən · Test» entry in Kəşf → Müəllimlər is noise a customer cannot act on. */
function isRealTrainer(t: Trainer): boolean {
  // `isPlaceholderName` (src/lib/authorName.ts) is the one list, matched
  // case-insensitively with the Azerbaijani rule. The exact-equality version
  // that used to live here missed «müəllim» and, because the default lowercase
  // turns «İstifadəçi» into «i̇stifadəçi», could not have matched that either.
  if (isPlaceholderName(t.name)) return false;
  return !!(t.specialty ?? '').trim() || !!(t.bio ?? '').trim();
}

export const useTrainer = (id: string) =>
  useFocusFetch<Trainer | null>(id ? `trainer:${id}` : '', null, async () => {
    const { data, error } = await supabase.from('trainers').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapTrainer(data) : null;
  });

/* ---- «did the read succeed?» for the screens that draw a definite absence ----
 *
 * `null` and `[]` are what these hooks return while the request is in flight,
 * when the row genuinely is not there, AND when the network failed. Screens were
 * printing «Müəllim tapılmadı» and «Hamısını gördün» for all three. These expose
 * the phase that `useFocusFetch` already records, so a screen can tell the person
 * which of the three actually happened. */
export const useTrainerPhase = (id: string) => useFetchPhase(id ? `trainer:${id}` : '');
export const usePartnerPhase = (id: string) => useFetchPhase(id ? `partner:${id}` : '');
export const usePartnersPhase = (gymId: string) => useFetchPhase(gymId ? `partners:${gymId}` : '');

export const useTrainersForGymPhase = (gymId: string) => useFetchPhase(gymId ? `gymTrainers:${gymId}` : '');

export const useTrainersForGym = (gymId: string) =>
  useFocusFetch<Trainer[]>(gymId ? `gymTrainers:${gymId}` : '', NO_TRAINERS, async () => {
    // `listed` and `isRealTrainer` are the same two filters the discovery list
    // uses. Without them a coach who unlisted themselves — or a «Sən · Test»
    // placeholder — stayed visible on the gym page, and the gym's «N müəllim»
    // (now a real count of listed trainers, schema23) disagreed with the list
    // underneath it.
    const { data, error } = await supabase.from('trainers').select('*').eq('gym_id', gymId).eq('listed', true);
    if (error) throw error;
    // A PostgREST error does not throw — it comes back in the result. Without
    // this the screen read a refused query as «this gym has no trainers».
    if (error) throw error;
    // Same rule as the discovery list: verified coaches first.
    return byVerification(data ?? []).map(mapTrainer).filter(isRealTrainer);
  });

/** Program-day exercises (from the exercise library). */
export const useDayExercises = () =>
  useList<Exercise>(pushExercises, async () => {
    const { data, error } = await supabase.from('exercises').select('*');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, name: r.name, muscle: r.muscle, sets: r.sets, reps: r.reps,
      commonMistake: r.common_mistake, substitutes: r.substitutes ?? [],
    }));
  });

/** Published challenges that have not ended, soonest deadline first.
 *
 *  The featured one used to be `all.find(c => c.id === 'aug-12')` — hardcoded to
 *  a single seeded row. That is why the admin panel's «Dayandır» did nothing
 *  visible (it writes `active`, which nobody read), why a newly activated
 *  challenge could never be featured, and why an August challenge was still on
 *  everybody's screen in September. `active` and `endsAt` decide now.
 *
 *  There is no seed fallback. `useList` keeps its fallback when a fetch returns
 *  an empty list, so a seeded array here would have survived schema60 deleting
 *  the fabricated rows and kept showing them forever. `null` means «SPOT has no
 *  live challenge», and the screen says exactly that. */
export const useChallenges = () => {
  const live = useList<Challenge>(NO_CHALLENGES, async () => {
    // Published and not finished, soonest deadline first — asked of the database
    // rather than filtered afterwards, so «now» is read when the request is made
    // and not on every render.
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('challenges')
      .select('*')
      .eq('active', true)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order('ends_at', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data ?? []).map(mapChallenge);
  });
  const active = live[0] ?? null;
  const joinable = live.slice(1);
  return { active, joinable, streak: streakChallenge, live };
};

export const useChallenge = (id: string) =>
  useOne<Challenge>(null, async () => {
    const { data, error } = await supabase.from('challenges').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapChallenge(data) : null;
  }, [id]);

/** The ranking for one challenge, counted on the server from real workout rows.
 *  `[]` means nobody has joined; a THROW means we could not read it, and the
 *  screen must not draw either as the other. */
export async function challengeStandings(id: string): Promise<Standing[]> {
  const { data, error } = await supabase.rpc('challenge_standings', { cid: id });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    profileId: r.profile_id,
    name: r.name ?? '',
    username: r.username ?? null,
    avatarUrl: r.avatar_url ?? null,
    done: r.done === null || r.done === undefined ? null : Number(r.done),
    isMe: !!r.is_me,
  }));
}

export const useGymRanking = () =>
  useList(mockRanking, async () => {
    const { data, error } = await supabase.from('gyms').select('id,name,members,tons');
    if (error) throw error;
    return (data ?? [])
      .map((g: any) => ({
        gym: g.name,
        tons: Number(g.tons ?? 0),
        members: g.members ?? 1,
        perMember: Math.round((Number(g.tons ?? 0) * 1000) / Math.max(1, g.members ?? 1)),
        me: g.id === 'iron-bay',
      }))
      .sort((a, b) => b.perMember - a.perMember);
  });

/**
 * Feed videos, reloaded on focus so a newly uploaded video shows up.
 *
 * Order: people you follow first, then newest.
 *
 * It used to be `.order('ord')` while every upload wrote `ord: 0`, so all
 * user videos shared one sort key and Postgres returned them in whatever order
 * it liked — the feed genuinely reshuffled between openings. There was no
 * `created_at` column to sort by instead; schema46 added one and recovered the
 * real upload times from the ids.
 *
 * The follow pass is done here rather than in SQL because `follows` is readable
 * only as yourself; if that read fails the feed still renders in date order
 * instead of failing whole — a guest has no follows at all.
 */
export const useFeedVideos = () => {
  // local-first
  return useFocusFetch<FeedVideo[]>('feed_videos', mockVideos, async () => {
    const { data, error } = await supabase
      .from('feed_videos')
      .select('*')
      .is('hidden_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []).map(mapVideo);

    let following = new Set<string>();
    try {
      following = await myFollowing();
    } catch {
      // Not signed in, or the read failed. Date order is still a real order.
    }
    if (following.size) {
      const followed = rows.filter((v) => v.authorId && following.has(v.authorId));
      const rest = rows.filter((v) => !v.authorId || !following.has(v.authorId));
      return nonEmpty([...followed, ...rest]);
    }
    return nonEmpty(rows);
  });
};

/** Community posts, reloaded every time the feed refocuses (so a new post shows on return). */
export const useCommunityPosts = () => {
  // local-first
  return useFocusFetch<CommunityPost[]>('community_posts', mockPosts, async () => {
    const { data, error } = await supabase.from('community_posts').select('*').is('hidden_at', null).order('created_at', { ascending: false });
    if (error) throw error;
    return nonEmpty((data ?? []).map(mapPost));
  });
};

/* `useChats` and `useMessages` used to live here. Both were dead code — nothing
   in the app ever called them — and both read tables that held fabricated
   content: `chats` had four invented conversations with «online» dots and
   message previews written in the voice of people who have no profile, and
   `messages` had a seeded «tural» thread with lines attributed to him. Either
   hook would have put that on screen the moment someone wired it up, which is
   how the same data shipped once already through src/data/chats.ts.

   Both tables are now closed to clients (schema24, schema25) and both need an
   owner/participant model before anything may read them again. The chat inbox
   builds from `useDb.threads`, which holds only what this device really did. */

export const useMeals = () =>
  useList<Meal>(mockMeals, async () => {
    const { data, error } = await supabase.from('meals').select('*').order('ord');
    if (error) throw error;
    return (data ?? []).map(mapMeal);
  });

export const useShopItems = () =>
  useList<ShopItem>(mockShop, async () => {
    const { data, error } = await supabase.from('shop_items').select('*').order('ord');
    if (error) throw error;
    return (data ?? []).map(mapShop);
  });

/** Real reviews only — an empty gym shows an empty list, never invented praise. */
export const useReviews = (gymId: string) =>
  useList<{ id: string; name: string; tenure: string; rating: number; text: string }>(
    [],
    async () => {
      const { data, error } = await supabase.from('reviews').select('*').eq('gym_id', gymId);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, name: r.name, tenure: r.tenure, rating: r.rating, text: r.body }));
    },
    [gymId]
  );

export { mockGyms };
