/**
 * SPOT local-first domain engine.
 *
 * This is the app's real "backend": a persisted, mutable store that holds every
 * domain entity plus the correct business logic (compatibility, streak, matching,
 * workout logging, progressive overload, stats). It works fully offline / guest —
 * Supabase (src/lib/api.ts) stays as an optional sync layer, but the app is 100%
 * functional without it. Everything the user does here persists and drives reads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { gyms as seedGyms, programs as seedPrograms } from '@/data/mock';
import { DAILY_TARGET, meals as mealsData } from '@/data/nutrition';
import { Gym, Level, Partner, Program } from '@/data/types';
import { newId } from '@/lib/ids';

export const LEVEL_ORDER: Level[] = ['Başlanğıc', 'Orta', 'İrəli'];

// ------------------------------------------------------------------ seed types
/** Rich partner seed — the raw params matching is computed from (design §compatibility). */
export interface PartnerSeed {
  id: string;
  name: string;
  age: number;
  gender: 'kişi' | 'qadın';
  gymId: string;
  level: Level;
  goals: string[];
  types: string[];
  scheduleDays: number[]; // indexes into DAYS (0=B.e … 6=Baz)
  scheduleSlot: string; // one of TIME_SLOTS buckets
  usualTime: string; // human display, e.g. "Axşam 18:00–20:00"
  consistency: number; // 0..1 — how reliably they show up
  checkedInMinAgo?: number; // if set & < 120 → "here now"
  bio: string;
  prs: { lift: string; value: number }[];
}

// ------------------------------------------------------------------ mutable state types
export interface LoggedSet {
  weight: number;
  reps: number;
  rpe?: number;
  done: boolean;
}
export interface LoggedExercise {
  name: string;
  muscle: string;
  sets: LoggedSet[];
}
export interface Workout {
  id: string;
  at: string; // ISO
  programId?: string;
  dayIndex?: number;
  title: string;
  exercises: LoggedExercise[];
  volumeKg: number;
  durationMin: number;
  partnerId?: string;
  rpe?: number;
  /** How many sets were completed. Normally derivable from `exercises`, but a
   *  workout restored from the server has no per-set detail (the `workouts`
   *  table stores the summary only), and there `exercises` is empty while this
   *  still holds the real number. Screens must prefer it over counting. */
  setsDone?: number;
  /** True when this row came back from the server without its set detail.
   *  Progressive overload and muscle volume need the sets, so they simply skip
   *  these rows rather than treating «no detail» as «no work». */
  summaryOnly?: boolean;
}
export interface CheckIn {
  id: string;
  gymId: string;
  at: string; // ISO
}
export interface WeightLog {
  /** Shared with `progress.id` on the server. Optional because rows written
   *  before this existed have none — the sync pushes those up under a new id. */
  id?: string;
  at: string; // ISO
  kg: number;
}
export type MatchState = 'requested' | 'incoming' | 'accepted' | 'declined';
export interface Match {
  partnerId: string;
  state: MatchState;
  at: string;
  question?: string;
}
export interface ChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  at: string;
  kind?: 'text' | 'invite';
  invite?: { gymId: string; when: string; accepted?: boolean };
}

// ------------------------------------------------------------------ me params (from appStore profile)
export interface MeParams {
  homeGymId: string | null;
  days: number[];
  timeSlot: string;
  level: string;
  goals: string[];
  types: string[];
}

// ------------------------------------------------------------------ seed: partners
const nowMin = () => Date.now();

/* Empty on purpose — this held TWELVE invented training partners (Kamran,
 * Tural, Aysel, Orxan, Ramil, Leyla, Nihad, Sevinc, Elvin, Günay, Murad, Zaur)
 * with ages, gyms, goals, usual times and personal records. Nothing renders
 * them today, which is exactly why they were dangerous: the list sits one
 * «boş siyahı çirkin görünür» away from being switched back on, and that has
 * already happened twice in this project. A partner must come from a real
 * profile row or not exist.
 *
 * `seedById` stays and now always returns null, so the three screens that use
 * it to ask «is this a seeded partner?» keep working and answer «no». */
export const partnerSeeds: PartnerSeed[] = [];


// ------------------------------------------------------------------ seed: exercise library (with form videos)
export interface LibExercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  defaultSets: number;
  reps: string;
  videoUrl: string;
  commonMistake: string;
  substitutes: string[];
  isCompound: boolean;
}

// SPOT owns no technique footage yet. The clips that used to sit here were public
// cartoon samples (Big Buck Bunny / Sintel) presented as «düzgün texnika» demos —
// content the app never obtained, labelled as coaching. Until real form videos are
// filmed, `videoUrl` is empty and the players stay hidden: no video is honest,
// a cartoon captioned "Ştanqla skvat — düzgün texnika" is not.
const NO_VIDEO = '';

export const exerciseLibrary: LibExercise[] = [
  { id: 'squat', name: 'Ştanqla skvat', muscle: 'Ayaq', equipment: 'Ştanq', defaultSets: 4, reps: '5–6', videoUrl: NO_VIDEO, commonMistake: 'Dizləri içəri buraxmaq. Dizlər ayaq barmağı istiqamətində qalmalıdır.', substitutes: ['Hack skvat', 'Goblet skvat'], isCompound: true },
  { id: 'bench', name: 'Ştanqla bench press', muscle: 'Sinə', equipment: 'Ştanq', defaultSets: 4, reps: '6–8', videoUrl: NO_VIDEO, commonMistake: 'Dirsəkləri 90° açmaq — çiyinə yük düşür. ~45° saxla.', substitutes: ['Dumbbell press', 'Maşında press'], isCompound: true },
  { id: 'deadlift', name: 'Deadlift', muscle: 'Kürək', equipment: 'Ştanq', defaultSets: 3, reps: '3–5', videoUrl: NO_VIDEO, commonMistake: 'Beli əymək. Neytral onurğa, ştanq bədənə yaxın.', substitutes: ['Romanian deadlift', 'Trap-bar deadlift'], isCompound: true },
  { id: 'ohp', name: 'Ştanqla çiyin press', muscle: 'Çiyin', equipment: 'Ştanq', defaultSets: 3, reps: '6–8', videoUrl: NO_VIDEO, commonMistake: 'Beli aşırı əymək. Qarını sıx, gluteus aktiv.', substitutes: ['Dumbbell çiyin press', 'Arnold press'], isCompound: true },
  { id: 'row', name: 'Ştanqla dartma (row)', muscle: 'Kürək', equipment: 'Ştanq', defaultSets: 4, reps: '8–10', videoUrl: NO_VIDEO, commonMistake: 'Gövdəni yelləmək — impuls ilə çəkmək. Nəzarətli çək.', substitutes: ['Dumbbell row', 'Kabel row'], isCompound: true },
  { id: 'pullup', name: 'Dartılma (pull-up)', muscle: 'Kürək', equipment: 'Turnik', defaultSets: 3, reps: '6–10', videoUrl: NO_VIDEO, commonMistake: 'Tam açmamaq. Aşağıda qollar tam uzanmalı.', substitutes: ['Lat pulldown', 'Assisted pull-up'], isCompound: true },
  { id: 'lat', name: 'Lat pulldown', muscle: 'Kürək', equipment: 'Maşın', defaultSets: 3, reps: '10–12', videoUrl: NO_VIDEO, commonMistake: 'Arxaya çox əyilmək. Gövdə demək olar sabit.', substitutes: ['Pull-up', 'Kabel row'], isCompound: false },
  { id: 'incline', name: 'Maili dumbbell press', muscle: 'Sinə', equipment: 'Dumbbell', defaultSets: 3, reps: '8–10', videoUrl: NO_VIDEO, commonMistake: 'Dirsəkləri kilidləyib dincəltmək. Gərginliyi saxla.', substitutes: ['Maili ştanq press', 'Maşında press'], isCompound: false },
  { id: 'legpress', name: 'Leg press', muscle: 'Ayaq', equipment: 'Maşın', defaultSets: 3, reps: '10–12', videoUrl: NO_VIDEO, commonMistake: 'Dizləri sinəyə həddən çox yaxınlaşdırmaq — bel qalxır.', substitutes: ['Skvat', 'Hack skvat'], isCompound: false },
  { id: 'rdl', name: 'Romanian deadlift', muscle: 'Arxa ayaq', equipment: 'Ştanq', defaultSets: 3, reps: '8–10', videoUrl: NO_VIDEO, commonMistake: 'Dizləri çox bükmək — skvata çevrilir. Hip hinge saxla.', substitutes: ['Deadlift', 'Good morning'], isCompound: true },
  { id: 'curl', name: 'Dumbbell biseps curl', muscle: 'Biseps', equipment: 'Dumbbell', defaultSets: 3, reps: '10–12', videoUrl: NO_VIDEO, commonMistake: 'Gövdəni yelləmək. Dirsək sabit qalsın.', substitutes: ['Ştanq curl', 'Kabel curl'], isCompound: false },
  { id: 'pushdown', name: 'Triseps pushdown', muscle: 'Triseps', equipment: 'Kabel', defaultSets: 3, reps: '10–12', videoUrl: NO_VIDEO, commonMistake: 'Dirsəyi bədəndən aralamaq.', substitutes: ['Dips', 'Overhead extension'], isCompound: false },
  { id: 'dips', name: 'Paralel dips', muscle: 'Triseps', equipment: 'Bar', defaultSets: 3, reps: '8–12', videoUrl: NO_VIDEO, commonMistake: 'Çox aşağı enmək — çiyini incidir.', substitutes: ['Triseps pushdown', 'Bench dips'], isCompound: true },
  { id: 'lateral', name: 'Yan qaldırma (lateral raise)', muscle: 'Çiyin', equipment: 'Dumbbell', defaultSets: 3, reps: '12–15', videoUrl: NO_VIDEO, commonMistake: 'Trapesi ilə qaldırmaq. Çiyindən yönləndir.', substitutes: ['Kabel lateral', 'Maşında lateral'], isCompound: false },
  { id: 'legcurl', name: 'Leg curl', muscle: 'Arxa ayaq', equipment: 'Maşın', defaultSets: 3, reps: '10–12', videoUrl: NO_VIDEO, commonMistake: 'Kalçanı qaldırmaq. Pelvis sabit.', substitutes: ['RDL', 'Nordic curl'], isCompound: false },
  { id: 'calf', name: 'Baldır qaldırma (calf raise)', muscle: 'Baldır', equipment: 'Maşın', defaultSets: 4, reps: '12–15', videoUrl: NO_VIDEO, commonMistake: 'Yarım amplituda. Tam uzat və qaldır.', substitutes: ['Ayaqüstə calf', 'Oturaq calf'], isCompound: false },
  { id: 'plank', name: 'Plank', muscle: 'Qarın', equipment: 'Bədən', defaultSets: 3, reps: '45 san', videoUrl: NO_VIDEO, commonMistake: 'Kalçanı qaldırmaq və ya sallamaq. Bədən düz xətt.', substitutes: ['Ab wheel', 'Dead bug'], isCompound: false },
  { id: 'hip', name: 'Hip thrust', muscle: 'Gluteus', equipment: 'Ştanq', defaultSets: 3, reps: '8–12', videoUrl: NO_VIDEO, commonMistake: 'Beli aşırı əymək. Qabırğanı aşağı saxla.', substitutes: ['Glute bridge', 'Kabel pull-through'], isCompound: false },
];

// ------------------------------------------------------------------ compatibility (design formula)
export interface CompatResult {
  score: number; // 0..99
  reasons: string[];
  breakdown: { label: string; pct: number }[];
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0;
  const setB = new Set(b);
  const inter = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function levelProximity(a: string, b: string): number {
  const ia = LEVEL_ORDER.indexOf(a as Level);
  const ib = LEVEL_ORDER.indexOf(b as Level);
  if (ia < 0 || ib < 0) return 0.5;
  const d = Math.abs(ia - ib);
  return d === 0 ? 1 : d === 1 ? 0.5 : 0;
}

const SLOT_ORDER = ['Səhər 6–9', 'Gündüz 9–17', 'Axşam 17–21', 'Gecə 21–24'];
function slotMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ia = SLOT_ORDER.indexOf(a);
  const ib = SLOT_ORDER.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  return Math.abs(ia - ib) === 1 ? 0.35 : 0;
}

/** The core matching algorithm. Weights (design §compatibility):
 *  30 gym · 25 schedule · 15 level · 15 goal · 10 type · 5 consistency = 100. */
export function computeCompatibility(me: MeParams | null, p: PartnerSeed): CompatResult {
  if (!me || !me.homeGymId) {
    return { score: 0, reasons: ['Profilini tamamla'], breakdown: [] };
  }
  const gym = me.homeGymId === p.gymId ? 1 : 0;
  const dayOverlap = jaccard(me.days.map(String), p.scheduleDays.map(String));
  const slot = slotMatch(me.timeSlot, p.scheduleSlot);
  const schedule = 0.55 * dayOverlap + 0.45 * slot;
  const level = levelProximity(me.level, p.level);
  const goal = jaccard(me.goals, p.goals);
  const type = jaccard(me.types, p.types);
  const cons = p.consistency;

  const raw = 30 * gym + 25 * schedule + 15 * level + 15 * goal + 10 * type + 5 * cons;
  const score = Math.max(0, Math.min(99, Math.round(raw)));

  const reasons: string[] = [];
  if (gym) reasons.push('Eyni zal');
  if (schedule >= 0.6) reasons.push('Eyni cədvəl');
  else if (slot >= 1) reasons.push('Eyni saat');
  else if (dayOverlap >= 0.4) reasons.push('Yaxın günlər');
  if (level >= 1) reasons.push('Eyni səviyyə');
  else if (level >= 0.5) reasons.push('Yaxın səviyyə');
  const sharedGoal = me.goals.find((g) => p.goals.includes(g));
  if (sharedGoal) reasons.push(sharedGoal);
  const sharedType = me.types.find((t) => p.types.includes(t));
  if (sharedType && reasons.length < 3) reasons.push(sharedType);
  if (cons >= 0.85 && reasons.length < 3) reasons.push('Ardıcıl məşqçi');

  const breakdown = [
    { label: 'Eyni zal', pct: Math.round(30 * gym) },
    { label: 'Cədvəl uyğunluğu', pct: Math.round(25 * schedule) },
    { label: 'Səviyyə yaxınlığı', pct: Math.round(15 * level) },
    { label: 'Ortaq məqsəd', pct: Math.round(15 * goal) },
    { label: 'Məşq tipi', pct: Math.round(10 * type) },
    { label: 'Ardıcıllıq', pct: Math.round(5 * cons) },
  ];

  return { score, reasons: reasons.slice(0, 3).length ? reasons.slice(0, 3) : ['Eyni zal'], breakdown };
}

/** Project a seed + my params into the UI Partner shape.
 *
 *  `hereNow` is always false: `checkedInMinAgo` is a compile-time constant, so it
 *  claimed the same people were in the gym at 3 a.m. and while the gym was shut.
 *  Presence is only ever real when it comes from a `check_ins` read. */
export function toPartner(seed: PartnerSeed, me: MeParams | null): Partner {
  const comp = computeCompatibility(me, seed);
  return {
    id: seed.id,
    name: seed.name,
    age: seed.age,
    gender: seed.gender,
    gymId: seed.gymId,
    level: seed.level,
    goals: seed.goals,
    types: seed.types,
    usualTime: seed.usualTime,
    compatibility: comp.score,
    matchReasons: comp.reasons,
    hereNow: false,
    minutesLeft: undefined,
    prs: seed.prs,
  };
}

// ------------------------------------------------------------------ day-key helper (04:00 Baku boundary)
/** The hour a "gym day" rolls over. */
export const GYM_DAY_START_HOUR = 4;

/** Azerbaijan is UTC+4 all year — DST was abolished in 2016.
 *
 *  The boundary is anchored to BAKU, not to the phone's own time zone, because
 *  the database decides the same question in `Asia/Baku` (schema19's `gym_day`
 *  generated column, which the one-check-in-per-day unique index is built on).
 *  If the two disagreed, a traveller — or anyone whose phone clock is set to the
 *  wrong zone — would be refused a check-in the app had told them was available. */
const BAKU_UTC_OFFSET_HOURS = 4;

/** The gym day an instant belongs to, as YYYY-MM-DD.
 *
 *  A gym day runs 04:00 → 04:00 Baku time: a 06:00 workout counts for today and
 *  a 02:00 one still counts for yesterday.
 *
 *  Shifting by (offset − boundary) and then reading the UTC date is exactly what
 *  Postgres computes as `((now() at time zone 'Asia/Baku') - interval '4 hours')::date`.
 *  Here those two happen to cancel, but they are kept as separate named constants
 *  so the rule stays readable and survives either one changing. */
function gymDayOf(ms: number): string {
  const shifted = new Date(ms + (BAKU_UTC_OFFSET_HOURS - GYM_DAY_START_HOUR) * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

export function dayKey(iso: string | Date): string {
  return gymDayOf(new Date(iso).getTime());
}

// ------------------------------------------------------------------ store
interface DbState {
  hydrated: boolean;
  installedAt: string;
  checkIns: CheckIn[];
  workouts: Workout[];
  weights: WeightLog[];
  matches: Record<string, Match>;
  threads: Record<string, ChatMessage[]>;
  savedPrograms: string[];
  nutrition: { day: string; eaten: string[]; water: number };
  myReviews: Record<string, { rating: number; text: string; at: string }[]>; // gymId → reviews I wrote
  myPrograms: Program[];                       // programs this user/trainer created
  // Comments are NOT here: they live on the server (src/lib/comments.ts). Keeping
  // them in this device-local store meant a comment reached nobody.

  setHydrated: () => void;
  toggleMeal: (id: string) => void;
  addWater: (delta: number) => void;
  addReview: (gymId: string, rating: number, text: string) => void;
  createProgram: (p: Omit<Program, 'id'> & { id?: string }) => string;
  updateProgram: (id: string, patch: Partial<Program>) => void;
  deleteProgram: (id: string) => void;
  checkIn: (gymId: string) => void;
  logWorkout: (w: Omit<Workout, 'id' | 'at'> & { at?: string; id?: string }) => string;
  logWeight: (kg: number, at?: string, id?: string) => string;
  /** PRs the server holds. A workout restored from another device has no set
   *  detail, so a record set there cannot be recomputed here — it is read from
   *  the `prs` table instead of being lost. */
  serverPRs: { lift: string; value: number; delta?: string }[];
  setServerPRs: (rows: { lift: string; value: number; delta?: string }[]) => void;
  /** Bring server-stored history into the device engine — see the implementation. */
  mergeFromServer: (incoming: { workouts: Workout[]; weights: WeightLog[] }) => void;
  /** Adopt the id the server accepted, for a row written before ids were shared. */
  renameWorkout: (oldId: string, newId: string) => void;
  renameWeight: (at: string, id: string) => void;
  toggleSavedProgram: (id: string) => void;
  sendMatchRequest: (partnerId: string, question?: string) => void;
  /** Bring the device's match state back in line with the server. See the
   *  implementation for why only UUID-keyed entries are touched. */
  reconcileMatches: (rows: { otherProfileId: string; status: 'pending' | 'accepted' | 'declined'; iSent: boolean }[]) => void;
  proposeWorkout: (partnerId: string, gymId: string, when: string) => void;
  acceptMatch: (partnerId: string) => void;
  declineMatch: (partnerId: string) => void;
  sendMessage: (partnerId: string, text: string) => void;
  acceptInvite: (partnerId: string, messageId: string) => void;
  resetDomain: () => void;
}

export const useDb = create<DbState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      // New users start with a clean slate — no fake history. The catalog (gyms,
      // partners, programs, exercises) is separate seed data, not personal history.
      installedAt: new Date().toISOString(),
      checkIns: [],
      workouts: [],
      serverPRs: [],
      weights: [],
      matches: {},
      threads: {},
      savedPrograms: [],
      nutrition: { day: dayKey(new Date().toISOString()), eaten: [], water: 0 },
      myReviews: {},
      myPrograms: [],

      createProgram: (p) => {
        const id = p.id ?? `mine-${Date.now().toString(36)}`;
        set((s) => ({ myPrograms: [{ ...(p as Program), id }, ...s.myPrograms] }));
        return id;
      },
      updateProgram: (id, patch) =>
        set((s) => ({ myPrograms: s.myPrograms.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deleteProgram: (id) => set((s) => ({ myPrograms: s.myPrograms.filter((p) => p.id !== id) })),

      setHydrated: () => set({ hydrated: true }),

      addReview: (gymId, rating, text) =>
        set((s) => ({
          myReviews: { ...s.myReviews, [gymId]: [{ rating, text, at: new Date().toISOString() }, ...(s.myReviews[gymId] ?? [])] },
        })),

      toggleMeal: (id) =>
        set((s) => {
          const day = dayKey(new Date().toISOString());
          const n = s.nutrition.day === day ? s.nutrition : { day, eaten: [], water: 0 };
          const eaten = n.eaten.includes(id) ? n.eaten.filter((x) => x !== id) : [...n.eaten, id];
          return { nutrition: { ...n, eaten } };
        }),

      addWater: (delta) =>
        set((s) => {
          const day = dayKey(new Date().toISOString());
          const n = s.nutrition.day === day ? s.nutrition : { day, eaten: [], water: 0 };
          return { nutrition: { ...n, water: Math.max(0, Math.min(12, n.water + delta)) } };
        }),

      checkIn: (gymId) =>
        set((s) => ({ checkIns: [{ id: `c-${Date.now()}`, gymId, at: new Date().toISOString() }, ...s.checkIns] })),

      // Returns the id so the caller can write the SAME id to the server — that
      // shared key is what lets the two copies be reconciled instead of counted
      // twice or ignored.
      logWorkout: (w) => {
        const id = w.id ?? newId();
        set((s) => ({
          workouts: [{ ...w, id, at: w.at ?? new Date().toISOString() }, ...s.workouts],
        }));
        return id;
      },

      logWeight: (kg, at, id) => {
        const rowId = id ?? newId();
        set((s) => ({
          weights: [...s.weights, { id: rowId, at: at ?? new Date().toISOString(), kg }],
        }));
        return rowId;
      },

      setServerPRs: (rows) => set({ serverPRs: rows }),

      renameWorkout: (oldId, id) =>
        set((s) => ({ workouts: s.workouts.map((w) => (w.id === oldId ? { ...w, id } : w)) })),

      renameWeight: (at, id) =>
        set((s) => ({ weights: s.weights.map((w) => (w.at === at && !w.id ? { ...w, id } : w)) })),

      /** Merge rows pulled from the server. Server rows the device already has
       *  (same id) are left alone — the local copy carries the set detail the
       *  server does not store, so overwriting it would LOSE information. */
      mergeFromServer: (incoming) =>
        set((s) => {
          const have = new Set(s.workouts.map((w) => w.id));
          const added = incoming.workouts.filter((w) => !have.has(w.id));
          const haveW = new Set(s.weights.map((w) => w.id).filter(Boolean) as string[]);
          const addedW = incoming.weights.filter((w) => !w.id || !haveW.has(w.id));
          if (!added.length && !addedW.length) return {};
          return {
            workouts: [...added, ...s.workouts].sort((a, b) => b.at.localeCompare(a.at)),
            weights: [...s.weights, ...addedW].sort((a, b) => a.at.localeCompare(b.at)),
          };
        }),

      toggleSavedProgram: (id) =>
        set((s) => ({
          savedPrograms: s.savedPrograms.includes(id) ? s.savedPrograms.filter((x) => x !== id) : [...s.savedPrograms, id],
        })),

      sendMatchRequest: (partnerId, question) =>
        set((s) => ({
          matches: { ...s.matches, [partnerId]: { partnerId, state: 'requested', at: new Date().toISOString(), question } },
        })),

      /**
       * The server is the authority on a partner request; this device is not.
       *
       * Only entries keyed by a real profile UUID are reconciled. `match.tsx`
       * sends to the server ONLY when `hasSupabaseConfig && UUID.test(id)`, and
       * on failure it returns before touching this store — so a UUID-keyed entry
       * exists exactly when a server row once existed. A non-UUID key is a
       * local-only record against a seed partner, which the user was told was
       * never sent («Təklif cihazında qeyd olundu — hələ göndərilməyib»); wiping
       * those would delete something the app promised to keep.
       *
       * Therefore: server row present → take its status. Server row gone → the
       * request no longer exists (answered and cleared, or the other account was
       * deleted) and the local «Gözləyən» is a ghost. Requests that arrived while
       * this device was away are added as `incoming`.
       */
      reconcileMatches: (rows) =>
        set((s) => {
          const isUuid = (v: string) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
          const server = new Map(rows.map((r) => [r.otherProfileId, r]));
          const next: Record<string, Match> = {};

          for (const [pid, m] of Object.entries(s.matches)) {
            if (!isUuid(pid)) { next[pid] = m; continue; } // local-only, leave alone
            const r = server.get(pid);
            if (!r) continue;                              // gone on the server → drop
            next[pid] = {
              ...m,
              state: r.status === 'accepted' ? 'accepted'
                   : r.status === 'declined' ? 'declined'
                   : r.iSent ? 'requested' : 'incoming',
            };
          }

          for (const r of rows) {
            if (next[r.otherProfileId]) continue;
            next[r.otherProfileId] = {
              partnerId: r.otherProfileId,
              at: new Date().toISOString(),
              state: r.status === 'accepted' ? 'accepted'
                   : r.status === 'declined' ? 'declined'
                   : r.iSent ? 'requested' : 'incoming',
            };
          }
          return { matches: next };
        }),

      // Propose a first workout → opens a real, persisted partner chat. In this
      // single-user MVP the counterpart auto-confirms; Supabase makes it 2-sided later.
      /* Sending a proposal records MY invite and marks the request as sent. The
         other person has not answered yet — SPOT never fabricates their reply,
         and never marks the invite accepted on their behalf. */
      proposeWorkout: (partnerId, gymId, when) =>
        set((s) => {
          const now = new Date().toISOString();
          const invite: ChatMessage = {
            id: `m-${Date.now()}`,
            from: 'me',
            text: `Məşq təklifi: ${when}`,
            at: now,
            kind: 'invite',
            invite: { gymId, when, accepted: false },
          };
          return {
            matches: { ...s.matches, [partnerId]: { partnerId, state: 'requested', at: now } },
            threads: { ...s.threads, [partnerId]: [...(s.threads[partnerId] ?? []), invite] },
          };
        }),

      /* Accepting opens the thread — but SPOT never writes a message and signs
         another person's name to it. The thread starts empty on purpose. */
      acceptMatch: (partnerId) =>
        set((s) => ({
          matches: { ...s.matches, [partnerId]: { partnerId, state: 'accepted', at: new Date().toISOString() } },
          threads: { ...s.threads, [partnerId]: s.threads[partnerId] ?? [] },
        })),

      declineMatch: (partnerId) =>
        set((s) => ({ matches: { ...s.matches, [partnerId]: { partnerId, state: 'declined', at: new Date().toISOString() } } })),

      sendMessage: (partnerId, text) =>
        set((s) => ({
          threads: {
            ...s.threads,
            [partnerId]: [...(s.threads[partnerId] ?? []), { id: `m-${Date.now()}`, from: 'me', text, at: new Date().toISOString() }],
          },
        })),

      acceptInvite: (partnerId, messageId) =>
        set((s) => ({
          threads: {
            ...s.threads,
            [partnerId]: (s.threads[partnerId] ?? []).map((m) =>
              m.id === messageId && m.invite ? { ...m, invite: { ...m.invite, accepted: true } } : m
            ),
          },
        })),

      resetDomain: () =>
        set({ checkIns: [], workouts: [], weights: [], matches: {}, threads: {}, savedPrograms: [] }),
    }),
    {
      name: 'spot-db',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        installedAt: s.installedAt,
        checkIns: s.checkIns,
        workouts: s.workouts,
        weights: s.weights,
        matches: s.matches,
        threads: s.threads,
        savedPrograms: s.savedPrograms,
        nutrition: s.nutrition,
        myReviews: s.myReviews,
        myPrograms: s.myPrograms,
      }),
      // No custom `merge` here: zustand's default shallow-merges the persisted
      // payload over the initial state. An older payload still carrying the
      // removed `comments` key therefore hydrates without touching anything —
      // the key rides along as an inert leftover, nothing reads it, and the next
      // write drops it (partialize no longer emits it).
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);

// ------------------------------------------------------------------ derived selectors / business logic
export function computeStreak(checkIns: CheckIn[], workouts: Workout[]): number {
  const keys = new Set<string>([...checkIns.map((c) => dayKey(c.at)), ...workouts.map((w) => dayKey(w.at))]);
  if (keys.size === 0) return 0;
  // Walk back from today in the SAME key space `dayKey` produces — a cursor that
  // drifts from the keys silently returns 0 for an unbroken streak. Stepping by a
  // flat 24 h is safe because the shifted timeline has a fixed offset and no DST,
  // unlike `setDate` on a device-local clock.
  let streak = 0;
  let cursorMs = Date.now();
  // If today has nothing yet, start from yesterday — today is still open.
  if (!keys.has(gymDayOf(cursorMs))) cursorMs -= 86_400_000;
  while (keys.has(gymDayOf(cursorMs))) {
    streak += 1;
    cursorMs -= 86_400_000;
  }
  return streak;
}

export interface Stats {
  count: number;
  volumeKg: number;
  streakDays: number;
  sinceDays: number;
  prs: { lift: string; value: number; delta?: string }[];
}

const LIFT_MATCHERS: { lift: string; test: (name: string) => boolean }[] = [
  { lift: 'Skvat', test: (n) => n.toLowerCase().includes('skvat') },
  { lift: 'Bench', test: (n) => n.toLowerCase().includes('bench') },
  { lift: 'Deadlift', test: (n) => n.toLowerCase().includes('deadlift') && !n.toLowerCase().includes('romanian') },
];

export function computeStats(s: Pick<DbState, 'checkIns' | 'workouts' | 'installedAt'> & { serverPRs?: Stats['prs'] }): Stats {
  const count = s.workouts.length;
  const volumeKg = s.workouts.reduce((a, w) => a + w.volumeKg, 0);
  const streakDays = computeStreak(s.checkIns, s.workouts);
  const sinceDays = Math.max(0, Math.floor((Date.now() - new Date(s.installedAt).getTime()) / 86400000));
  const prs = LIFT_MATCHERS.map(({ lift, test }) => {
    let best = 0;
    for (const w of s.workouts) {
      for (const e of w.exercises) {
        if (test(e.name)) for (const st of e.sets) if (st.done && st.weight > best) best = st.weight;
      }
    }
    return { lift, value: best };
  }).filter((p) => p.value > 0);

  // A record set on another device lives in `prs` on the server; the local sets
  // that produced it were never uploaded, so it cannot be recomputed here. Take
  // whichever number is higher — the device's or the server's — per lift.
  const byLift = new Map(prs.map((p) => [p.lift, p]));
  for (const sp of s.serverPRs ?? []) {
    const cur = byLift.get(sp.lift);
    if (!cur || sp.value > cur.value) byLift.set(sp.lift, sp);
  }
  return { count, volumeKg, streakDays, sinceDays, prs: [...byLift.values()] };
}

// A day's title → a sensible exercise list from the library (real, focused workouts).
const DAY_PLANS: Record<string, string[]> = {
  push: ['bench', 'ohp', 'incline', 'lateral', 'pushdown', 'dips'],
  pull: ['deadlift', 'row', 'pullup', 'lat', 'curl'],
  legs: ['squat', 'legpress', 'rdl', 'legcurl', 'calf'],
  hiit: ['squat', 'legpress', 'plank', 'calf'],
  full: ['squat', 'bench', 'row', 'ohp', 'plank'],
};
function planKey(title: string): keyof typeof DAY_PLANS {
  const t = (title ?? '').toLowerCase();
  if (t.includes('push')) return 'push';
  if (t.includes('pull')) return 'pull';
  if (t.includes('leg') || t.includes('ayaq')) return 'legs';
  if (t.includes('hiit') || t.includes('kardio')) return 'hiit';
  return 'full';
}
/** The exercises for a given workout day, resolved from the library. */
export function sessionExercises(dayTitle: string): LibExercise[] {
  return DAY_PLANS[planKey(dayTitle)].map((id) => exerciseById(id)).filter((e): e is LibExercise => !!e);
}

/** The most recent logged set for an exercise, for the "previous" column. */
export function lastLoggedSet(workouts: Workout[], name: string): { weight: number; reps: number } | null {
  for (const w of workouts) {
    const e = w.exercises.find((x) => x.name === name);
    if (e) {
      const d = e.sets.find((s) => s.done) ?? e.sets[0];
      if (d) return { weight: d.weight, reps: d.reps };
    }
  }
  return null;
}

// ---------------------------------------------------------- progressive overload
/** Muscle groups the library labels as lower body — they take the +5 kg step. */
const LOWER_BODY_MUSCLES = new Set(['Ayaq', 'Arxa ayaq', 'Gluteus', 'Baldır']);
export const isLowerBody = (muscle?: string): boolean => LOWER_BODY_MUSCLES.has(muscle ?? '');

/** RPE, as the summary screen records it: 0 = Asan, 1 = Normal, 2 = Ağır. */
export const RPE_EASY = 0;
export const RPE_OK = 1;
export const RPE_HARD = 2;

export type OverloadReason = 'easy' | 'ok-hit' | 'ok-miss' | 'hard' | 'deload';

export interface OverloadSuggestion {
  /** The load the rule prescribes for the next session. */
  weight: number;
  /** What was actually lifted last time — the honest fallback when the
   *  suggestion must not be applied automatically (e.g. the user has a trainer). */
  prevWeight: number;
  /** Which branch of the rule fired. */
  reason: OverloadReason;
  /** True only for the two-consecutive-hard −5% recovery week. */
  deload: boolean;
  note: string;
}

const halfKg = (n: number) => Math.round(n * 2) / 2;

/**
 * Progressive overload, exactly as the product rule states it.
 *
 *   Asan (rpe 0)   → +2.5 kg upper body, +5 kg lower body, unconditionally.
 *   Normal (rpe 1) → +2.5 kg ONLY if every logged set reached its target reps,
 *                    otherwise the same load again.
 *   Ağır (rpe 2)   → same load; two consecutive Ağır sessions of this exercise
 *                    → −5 % and a deload (recovery) week.
 *
 * The rating used to be collected on the summary screen and then dropped on the
 * floor — «Asan» and «Normal» produced byte-identical suggestions, no lift ever
 * got the +5 kg lower-body step, and the deload existed nowhere. An unrated
 * session is treated as «Normal», which is the conservative branch.
 */
export function suggestNext(
  workouts: Workout[],
  exerciseName: string,
  topRep: number,
  opts: { muscle?: string } = {}
): OverloadSuggestion | null {
  // Every past session that contains this exercise, newest first — the second one
  // is what the "two consecutive hard sessions" clause needs.
  const history = workouts.filter((w) => w.exercises.some((x) => x.name === exerciseName));
  const last = history[0];
  if (!last) return null;
  const done = (last.exercises.find((x) => x.name === exerciseName)?.sets ?? []).filter((st) => st.done);
  if (!done.length) return null;

  const top = done[0];
  const prevWeight = top.weight;
  const rpe = last.rpe;

  if (rpe === RPE_HARD) {
    if (history[1]?.rpe === RPE_HARD) {
      const weight = halfKg(prevWeight * 0.95);
      return {
        weight,
        prevWeight,
        reason: 'deload',
        deload: true,
        note: `Ardıcıl iki məşq ağır keçdi — ${prevWeight}kq-dan 5% aşağı: ${weight}kq ilə bərpa (deload) həftəsi`,
      };
    }
    return {
      weight: prevWeight,
      prevWeight,
      reason: 'hard',
      deload: false,
      note: `Keçən dəfə ${prevWeight}kq ağır keçdi — eyni çəkidə təkrarla`,
    };
  }

  if (rpe === RPE_EASY) {
    const inc = isLowerBody(opts.muscle) ? 5 : 2.5;
    const weight = halfKg(prevWeight + inc);
    return {
      weight,
      prevWeight,
      reason: 'easy',
      deload: false,
      note: `Keçən dəfə ${prevWeight}kq asan keçdi — +${inc}kq artır`,
    };
  }

  // «Normal» (or not rated): the load only rises when every set hit its target.
  const allHit = done.every((st) => st.reps >= topRep);
  if (allHit) {
    const weight = halfKg(prevWeight + 2.5);
    return {
      weight,
      prevWeight,
      reason: 'ok-hit',
      deload: false,
      note: `Keçən dəfə ${prevWeight}kq × ${top.reps} — bütün setlər hədəfi vurdu, +2.5kq artır`,
    };
  }
  return {
    weight: prevWeight,
    prevWeight,
    reason: 'ok-miss',
    deload: false,
    note: `Keçən dəfə ${prevWeight}kq — bu çəkidə hədəf təkrarları tamamla`,
  };
}

// ------------------------------------------------------------------ convenience hooks
export function useStats(): Stats {
  const checkIns = useDb((s) => s.checkIns);
  const workouts = useDb((s) => s.workouts);
  const installedAt = useDb((s) => s.installedAt);
  const serverPRs = useDb((s) => s.serverPRs);
  return useMemo(
    () => computeStats({ checkIns, workouts, installedAt, serverPRs }),
    [checkIns, workouts, installedAt, serverPRs]
  );
}

const MUSCLE_DISPLAY: Record<string, string> = {
  Sinə: 'Sinə',
  Ayaq: 'Ayaq',
  'Arxa ayaq': 'Ayaq',
  Gluteus: 'Ayaq',
  Baldır: 'Ayaq',
  Kürək: 'Bel',
  Çiyin: 'Çiyin',
  Biseps: 'Qol',
  Triseps: 'Qol',
  Qarın: 'Core',
};
/** Volume (kg) per display muscle group over the last 28 days. */
export function computeMuscleVolume(workouts: Workout[]): { name: string; kg: number }[] {
  const cutoff = Date.now() - 28 * 86400000;
  const map: Record<string, number> = {};
  for (const w of workouts) {
    if (new Date(w.at).getTime() < cutoff) continue;
    for (const e of w.exercises) {
      const g = MUSCLE_DISPLAY[e.muscle] ?? e.muscle;
      map[g] = (map[g] ?? 0) + e.sets.reduce((a, s) => a + s.weight * s.reps, 0);
    }
  }
  return ['Sinə', 'Ayaq', 'Bel', 'Çiyin', 'Qol'].map((name) => ({ name, kg: map[name] ?? 0 }));
}
/** Estimated 1RM (Epley) for the heaviest matching set ever logged. */
export function estimate1RM(workouts: Workout[], matcher: (name: string) => boolean): number {
  let best = 0;
  for (const w of workouts) {
    for (const e of w.exercises) {
      if (!matcher(e.name)) continue;
      for (const s of e.sets) {
        const est = s.weight * (1 + s.reps / 30);
        if (est > best) best = est;
      }
    }
  }
  return Math.round(best);
}

export interface WeekStats {
  count: number;
  volumeKg: number;
  durationSec: number;
  perDay: number[]; // Mon..Sun volume
}
export function computeWeekStats(workouts: Workout[]): WeekStats {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Mon=0
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - dow);
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let count = 0;
  let volumeKg = 0;
  let durationSec = 0;
  for (const w of workouts) {
    const d = new Date(w.at);
    if (d >= monday) {
      perDay[(d.getDay() + 6) % 7] += w.volumeKg;
      count += 1;
      volumeKg += w.volumeKg;
      durationSec += (w.durationMin || 0) * 60;
    }
  }
  return { count, volumeKg, durationSec, perDay };
}
export function useWeekStats(): WeekStats {
  const workouts = useDb((s) => s.workouts);
  return useMemo(() => computeWeekStats(workouts), [workouts]);
}
export function useLatestWeight(): number | null {
  const weights = useDb((s) => s.weights);
  return weights.length ? weights[weights.length - 1].kg : null;
}

export interface NutritionToday {
  eaten: string[];
  water: number;
  consumed: number;
  target: number;
  protein: number;
  carb: number;
  fat: number;
}
export function useNutritionToday(): NutritionToday {
  const nutrition = useDb((s) => s.nutrition);
  return useMemo(() => {
    const day = dayKey(new Date().toISOString());
    const isToday = nutrition.day === day;
    const eaten = isToday ? nutrition.eaten : [];
    const water = isToday ? nutrition.water : 0;
    const done = mealsData.filter((m) => eaten.includes(m.id));
    return {
      eaten,
      water,
      target: DAILY_TARGET,
      consumed: done.reduce((s, m) => s + m.kcal, 0),
      protein: done.reduce((s, m) => s + m.protein, 0),
      carb: done.reduce((s, m) => s + m.carb, 0),
      fat: done.reduce((s, m) => s + m.fat, 0),
    };
  }, [nutrition]);
}

/** NOT a crowd count. This reports only what this device actually knows: 1 when
 *  *I* have an unexpired check-in at `gymId`, otherwise 0.
 *
 *  It used to add the hard-coded `checkedInMinAgo` seeds, so the check-in screen
 *  always read «indi zalda 4 nəfər» — a compile-time constant attached to a real
 *  gym. A real headcount can only come from a `check_ins` read (api.activeCountsByGym);
 *  when no such number was obtained the screen must show nothing at all. */
export function gymLiveCount(gymId: string, checkIns: CheckIn[]): number {
  const twoH = 2 * 3600 * 1000;
  return checkIns.some((c) => c.gymId === gymId && Date.now() - new Date(c.at).getTime() < twoH) ? 1 : 0;
}

export function timeAgoAz(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'indi';
  if (min < 60) return `${min} dəq`;
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Dünən';
  return `${days} gün`;
}

export const seedById = (id: string) => partnerSeeds.find((p) => p.id === id) ?? null;
export const gymById = (id: string): Gym | undefined => seedGyms.find((g) => g.id === id);
export const programById = (id: string): Program | undefined => seedPrograms.find((p) => p.id === id);
/**
 * Technique footage, filled in from the server.
 *
 * The library below is app content — names, target reps, the most common
 * mistake — and it ships with the build. The VIDEO is not: it is a file that
 * arrives later, and requiring an app release for each one would mean the
 * catalogue stays empty forever. `public.exercises.video_url` is that slot, and
 * this map is what the server put in it.
 *
 * Populated once at bootstrap (see `loadExerciseVideos`). Empty until then and
 * empty when the read fails, which the exercise screen already renders honestly
 * — «no footage» rather than a black player.
 */
const videoOverlay = new Map<string, string>();

export function setExerciseVideos(rows: { id: string; video_url: string | null }[]): void {
  videoOverlay.clear();
  for (const r of rows) {
    if (r.video_url) videoOverlay.set(r.id, r.video_url);
  }
}

export const exerciseById = (id: string): LibExercise | null => {
  const base = exerciseLibrary.find((e) => e.id === id) ?? null;
  if (!base) return null;
  const url = videoOverlay.get(id);
  return url ? { ...base, videoUrl: url } : base;
};

/** How many of the library's movements actually have footage right now. Used by
 *  the program screens, which must not claim «hər hərəkətin videosu var». */
export const exercisesWithVideo = (): number =>
  exerciseLibrary.filter((e) => e.videoUrl || videoOverlay.has(e.id)).length;

// ------------------------------------------------------------------ programs
/** All programs the user can run: the ones they created first, then the catalog. */
export function useAllPrograms(): Program[] {
  const mine = useDb((s) => s.myPrograms);
  return useMemo(() => {
    const ids = new Set(mine.map((p) => p.id));
    return [...mine, ...seedPrograms.filter((p) => !ids.has(p.id))];
  }, [mine]);
}

/** Look up a program in the user's own list first, then the catalog. */
export function findProgram(id: string): Program | undefined {
  return useDb.getState().myPrograms.find((p) => p.id === id) ?? seedPrograms.find((p) => p.id === id);
}

/**
 * Exercises for a program day — the day's OWN exercises, or nothing.
 *
 * A real program that does not list exercises for a day has none, and we say so:
 * synthesising a plan from the day TITLE («Push günü» → squat/bench/…) invented a
 * workout the program's author never wrote and attributed it to them. The
 * title-derived DAY_PLANS fallback survives only for the program-less
 * «Sərbəst məşq» session, where nobody is being quoted (`sessionExercises`).
 */
export function programDayExercises(program: Program | undefined, dayIndex: number): LibExercise[] {
  const day = program?.days?.[dayIndex];
  if (day?.exercises?.length) {
    return day.exercises.map((e) => {
      const known = exerciseLibrary.find((x) => x.name === e.name || x.id === e.id);
      return (
        known ?? {
          id: e.id,
          name: e.name,
          muscle: e.muscle,
          equipment: '—',
          defaultSets: e.sets,
          reps: e.reps,
          videoUrl: NO_VIDEO,
          commonMistake: e.commonMistake,
          substitutes: e.substitutes ?? [],
          isCompound: false,
        }
      );
    });
  }
  // A named program with an empty day: honestly empty. Only the free session
  // (no program at all) may fall back to a title-derived plan.
  if (program) return [];
  return sessionExercises(day?.title ?? '');
}

// ---------------------------------------------------------------- challenges
/** Real challenge progress from the user's own logs — never an invented number.
 *  `unit` mirrors the challenge unit ("məşq", "gün", "kq", "t"). */
export function computeChallengeProgress(
  unit: string,
  s: { workouts: Workout[]; checkIns: CheckIn[]; installedAt: string }
): number {
  const u = (unit || '').toLowerCase();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const inMonth = (iso: string) => new Date(iso) >= monthStart;

  if (u.includes('gün')) return computeStreak(s.checkIns, s.workouts);
  if (u.includes('t') && !u.includes('təkrar')) {
    const kg = s.workouts.filter((w) => inMonth(w.at)).reduce((a, w) => a + w.volumeKg, 0);
    return Math.round((kg / 1000) * 10) / 10;
  }
  if (u.includes('kq')) return s.workouts.filter((w) => inMonth(w.at)).reduce((a, w) => a + w.volumeKg, 0);
  // default: sessions this month
  return s.workouts.filter((w) => inMonth(w.at)).length;
}

export function useChallengeProgress(unit: string): number {
  const workouts = useDb((s) => s.workouts);
  const checkIns = useDb((s) => s.checkIns);
  const installedAt = useDb((s) => s.installedAt);
  return useMemo(() => computeChallengeProgress(unit, { workouts, checkIns, installedAt }), [unit, workouts, checkIns, installedAt]);
}

/* Comments are read from the server — see `fetchComments` in src/lib/comments.ts.
   There is deliberately no hook here: a local list could only ever show what this
   one device typed. */
