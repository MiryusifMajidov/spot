import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gym, Partner, toLevel } from '@/data/types';
import { supabase } from './supabase';
import { invalidateFocusCache, invalidateFocusPrefix } from './focusFetch';
import { isPlaceholderName } from './authorName';

/** Raw DB row shapes (snake_case, as stored in Postgres). */
export interface DbGym {
  id: string;
  name: string;
  verified: boolean;
  district: string | null;
  price_month: number | null;
  day_pass: number | null;
  hours: string | null;
  members: number | null;
  trainers: number | null;
  rating: number | null;
  review_count: number | null;
  amenities: string[] | null;
  tags: string[] | null;
  about: string | null;
  image_url: string | null;
}

/** Every profile column the app is allowed to read.
 *  `phone` is deliberately absent: it is real PII, the app never needs it, and
 *  schema9 revokes column access to it so only the audited `admin_unmask_phone`
 *  RPC can reveal it. Column-level grants make `select('*')` fail outright, so
 *  every profile read must name its columns. */
const PROFILE_COLS =
  'id,user_id,name,username,gender,age,home_gym_id,level,goals,types,time_slot,bio,visibility,show_in_gym_list,role,specialty,price_from,avatar_url,created_at,status,status_until';

export interface DbProfile {
  id: string;
  user_id: string | null;
  name: string | null;
  /** Public handle (@ad). Unique case-insensitively; null on rows older than the migration. */
  username: string | null;
  gender: string | null;
  age: number | null;
  home_gym_id: string | null;
  level: string | null;
  goals: string[] | null;
  types: string[] | null;
  time_slot: string | null;
  bio: string | null;
  visibility: string | null;
  show_in_gym_list: boolean | null;
  role?: string | null;
  specialty?: string | null;
  price_from?: number | null;
  /** Moderation state. Written ONLY by an admin — schema18 revoked the client's
   *  update grant on these two columns, so a sanctioned person can no longer
   *  clear their own ban. */
  status?: 'active' | 'muted' | 'suspended' | 'banned' | null;
  /** When a time-boxed sanction lapses; null on the indefinite rungs. */
  status_until?: string | null;
}

// -------------------- auth --------------------
/** This device HAS an account, but its stored session could not be restored.
 *  Distinct from "no account yet" and from "the network is down", because the
 *  only wrong answer here is to quietly become somebody new. */
export class SessionRestoreError extends Error {
  constructor() {
    super('session_restore_failed');
    this.name = 'SessionRestoreError';
  }
}

/** True when this device has an auth token stored, whatever state it is in.
 *
 *  supabase-js keeps it under `sb-<project-ref>-auth-token`; the key is derived
 *  from the URL, so it is read back by shape rather than hard-coded. */
async function hasStoredSession(): Promise<boolean> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.some((k) => /^sb-.+-auth-token$/.test(k));
  } catch {
    // Cannot tell. Treated as "yes" by the caller, which is the safe direction:
    // it refuses to mint a second identity rather than risk abandoning the first.
    return true;
  }
}

/**
 * The device's session, creating an anonymous one only when this device has
 * genuinely never had an account.
 *
 * The previous version read `getSession()`, ignored its error, and called
 * `signInAnonymously()` for anything falsy. Every way of failing to READ the
 * stored session — a transient AsyncStorage error, a refresh token the server
 * rejected — therefore produced a brand new user. The person's check-ins, their
 * videos, their partner requests and their handle all stay behind on the old
 * profile, which nothing can ever reach again; the app looks empty and blames
 * nobody. The live database still carries five `Yusif` profiles from that.
 *
 * So: a failure is a failure. A new identity is minted in exactly one case —
 * no stored token at all.
 */
export async function ensureSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return data.session;

  if (await hasStoredSession()) {
    throw new SessionRestoreError();
  }

  const { data: anon, error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) throw signInError;
  return anon.session;
}

export async function getUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  // "No session" is a real answer (guest). Anything else — network down, 5xx,
  // a refused refresh — is a FAILURE and must never be collapsed into "no user":
  // that is what turned a flaky connection into «Bu hesaba bağlı zal yoxdur».
  if (error && (error as { name?: string }).name !== 'AuthSessionMissingError') throw error;
  return data.user?.id ?? null;
}

/** Is this account under a sanction right now?
 *
 *  The rule must match `public.is_sanctioned()` in schema18 exactly, or the app
 *  and the database will disagree about who may write: not 'active', and either
 *  no expiry (indefinite) or an expiry still in the future. */
export function sanctionOf(p: { status?: string | null; status_until?: string | null } | null | undefined) {
  const status = p?.status ?? 'active';
  if (status === 'active') return null;
  const until = p?.status_until ? new Date(p.status_until) : null;
  if (until && until.getTime() <= Date.now()) return null; // lapsed
  return { status: status as 'muted' | 'suspended' | 'banned', until };
}

/** Stamp «son aktiv» for the signed-in profile.
 *
 *  `profiles.last_active_at` was NULL on every row because nothing ever wrote
 *  it, so the admin panel's «son aktiv» column read «—» for everybody including
 *  people using the app right now. schema18 withholds the column from the
 *  client's UPDATE grant on purpose, so it goes through a SECURITY DEFINER RPC —
 *  which also means the value cannot be backdated or inflated from a device.
 *
 *  Fire-and-forget: a failure here must never affect what the person sees. */
export async function touchLastActive(): Promise<void> {
  await supabase.rpc('touch_last_active');
}

// -------------------- profile --------------------
export async function getMyProfile(): Promise<DbProfile | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLS).eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data as DbProfile | null;
}

// -------------------- profile identity (ad + istifadəçi adı) --------------------
/** Exactly the DB CHECK on `profiles.username`. Keep the two in sync — the column
 *  rejects anything else, so validating a different shape here would only produce
 *  a save that fails for a reason we never told the user about. */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** The one message the whole app uses for a handle somebody else already holds. */
export const USERNAME_TAKEN_MSG = 'Bu istifadəçi adı tutulub';

/** Azerbaijani letters → their ASCII counterpart; the handle charset is ASCII only. */
const AZ_FOLD: Record<string, string> = { ə: 'a', ö: 'o', ü: 'u', ğ: 'g', ı: 'i', ş: 's', ç: 'c' };

/** A handle suggestion built from a display name: «Əli Şirinov» → `alisirinov`.
 *  Returns '' when nothing usable is left — an empty field with a placeholder is
 *  friendlier than pre-filling a value that is already invalid. */
export function suggestUsername(name: string): string {
  const folded = name
    .toLowerCase()
    .split('')
    .map((ch) => AZ_FOLD[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
  return folded.length >= 3 ? folded : '';
}

/** Live validation message for a handle, or null when it is acceptable. */
export function usernameError(value: string): string | null {
  const v = value.trim();
  if (!v) return 'İstifadəçi adını yaz';
  if (v.length < 3) return 'Ən azı 3 simvol olmalıdır';
  if (v.length > 20) return 'Ən çoxu 20 simvol ola bilər';
  if (!USERNAME_RE.test(v)) return 'Yalnız ingilis hərfləri, rəqəm və alt xətt (_) işlədə bilərsən';
  return null;
}

/** The placeholder-name list lives in one place — `isPlaceholderName` in
 *  authorName.ts. It used to be duplicated here and, in a third, shorter and
 *  case-sensitive form inside `looksComplete()`: a profile called «sen» was
 *  refused at the form yet still counted as a complete person in the partner
 *  list. One predicate now answers the question everywhere. */
const HAS_LETTER = /[a-zçəğıiöşüA-ZÇƏĞIİÖŞÜ]/;

/** Validation message for the public display name, or null when it is a real name. */
export function displayNameError(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Adını yaz — profilin onsuz görünmür';
  if (v.length < 2) return 'Ad ən azı 2 simvol olmalıdır';
  if (!HAS_LETTER.test(v)) return 'Adda ən azı bir hərf olmalıdır';
  if (isPlaceholderName(v)) return 'Əsl adını yaz — bunu başqaları görəcək';
  return null;
}

/** True when the handle already belongs to somebody else.
 *  `_` is a LIKE wildcard and a legal handle character, so `ilike` can only ever
 *  over-match; the exact comparison afterwards drops those false hits. The DB's
 *  unique index stays the real guarantee — this only lets us say so before saving. */
export async function isUsernameTaken(username: string): Promise<boolean> {
  const v = username.trim();
  if (!v) return false;
  const { data, error } = await supabase.from('profiles').select('id,username').ilike('username', v);
  if (error) throw error;
  const hits = (data ?? []).filter(
    (r: { username: string | null }) => (r.username ?? '').toLowerCase() === v.toLowerCase()
  );
  if (!hits.length) return false;
  // My own row holding my own handle is not a collision.
  const me = await getMyProfile();
  return hits.some((r: { id: string }) => r.id !== me?.id);
}

/** Postgres 23505 = unique violation. Lets the caller say «tutulub» instead of
 *  blaming the connection for a save the server refused on purpose. */
export function isUsernameConflict(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  if (!err) return false;
  if (err.code === '23505') return true;
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('username') && (msg.includes('duplicate key') || msg.includes('unique'));
}

/** Writes my profile and returns the row's `profiles.id`.
 *
 *  The id is returned on purpose: for a first-run user this upsert is the moment
 *  their profile id comes into existence, and without it the store would have no
 *  identity until the next cold start — every `authorId === myId` ownership check
 *  would quietly answer "not mine" for their own video, post and creator page. */
export async function updateMyProfile(patch: Partial<DbProfile>): Promise<string | null> {
  const uid = await getUserId();
  if (!uid) throw new Error('no session');
  // Upsert so a brand-new (anon) user gets a real profiles row the first time they
  // save — otherwise .update() touches 0 rows and the user never reaches the DB / admin.
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ user_id: uid, ...patch }, { onConflict: 'user_id' })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

// -------------------- gyms --------------------
function mapGym(g: DbGym, distanceKm = 0, liveCount = 0): Gym {
  return {
    id: g.id,
    name: g.name,
    verified: g.verified,
    district: g.district ?? '',
    distanceKm: Math.round(distanceKm * 10) / 10,
    hours: g.hours ?? '',
    priceMonth: g.price_month ?? 0,
    dayPass: g.day_pass ?? 0,
    members: g.members ?? 0,
    trainers: g.trainers ?? 0,
    rating: g.rating ?? 0,
    reviewCount: g.review_count ?? 0,
    liveCount,
    amenities: g.amenities ?? [],
    tags: g.tags ?? [],
    about: g.about ?? '',
    imageUrl: g.image_url ?? null,
    photos: (g as unknown as { photos?: string[] }).photos ?? [],
    lat: (g as unknown as { lat?: number }).lat ?? null,
    lng: (g as unknown as { lng?: number }).lng ?? null,
  };
}

/** Live check-in counts per gym, as a map. */
export async function activeCountsByGym(): Promise<Record<string, number>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from('check_ins').select('gym_id').gt('expires_at', nowIso);
  if (error) throw error;
  const counts: Record<string, number> = {};
  (data ?? []).forEach((r: { gym_id: string }) => {
    counts[r.gym_id] = (counts[r.gym_id] ?? 0) + 1;
  });
  return counts;
}

export async function getGymsNear(lat: number, lng: number): Promise<Gym[]> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.rpc('gyms_near', { lat, lng }),
    activeCountsByGym(),
  ]);
  if (error) throw error;
  return (data ?? []).map((row: { gym: DbGym; distance_km: number }) => mapGym(row.gym, row.distance_km, counts[row.gym.id] ?? 0));
}

export async function getGyms(): Promise<Gym[]> {
  const [{ data, error }, counts] = await Promise.all([
    supabase.from('gyms').select('*'),
    activeCountsByGym(),
  ]);
  if (error) throw error;
  return (data ?? []).map((g: DbGym) => mapGym(g, 0, counts[g.id] ?? 0));
}

export async function getGym(id: string): Promise<Gym | null> {
  const { data, error } = await supabase.from('gyms').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const counts = await activeCountsByGym();
  return mapGym(data as DbGym, 0, counts[id] ?? 0);
}

// -------------------- check-in --------------------
/** Why the server refused a check-in. `code` is the stable part; `detail` carries
 *  the real measured value the server sent back (metres away, the opening hours
 *  it read). The screen turns this into Azerbaijani — nothing is invented here. */
export type CheckInRefusal =
  | 'not_signed_in'
  | 'sanctioned'
  | 'no_gym'
  | 'gym_no_coords'
  | 'no_position'
  | 'too_far'
  | 'closed'
  | 'already_today'
  | 'unknown';

export class CheckInError extends Error {
  constructor(
    readonly code: CheckInRefusal,
    readonly detail: string | null,
    message: string
  ) {
    super(message);
    this.name = 'CheckInError';
  }
}

const REFUSALS: CheckInRefusal[] = [
  'not_signed_in', 'sanctioned', 'no_gym', 'gym_no_coords',
  'no_position', 'too_far', 'closed', 'already_today',
];

/** schema19: the row is written by `public.check_in`, never by the client.
 *  The position is an argument the server verifies and discards — it is not
 *  stored, so a gym owner reading their attendance list cannot see where a
 *  member was standing. */
export async function checkIn(gymId: string, at: { lat: number; lng: number }): Promise<void> {
  const { error } = await supabase.rpc('check_in', {
    p_gym_id: gymId,
    p_lat: at.lat,
    p_lng: at.lng,
  });
  if (!error) {
    // A check-in changes the live count on every gym card and the `hereNow`
    // flag on the partner lists; both are cached under those keys.
    invalidateFocusCache('gyms');
    invalidateFocusPrefix('partner');
    return;
  }
  const raw = String(error.message ?? '');
  const hit = REFUSALS.find((c) => raw.includes(`checkin_${c}`));
  const detail = hit ? (raw.split(`checkin_${hit}:`)[1] ?? '').split(/["\n]/)[0].trim() || null : null;
  throw new CheckInError(hit ?? 'unknown', detail, raw);
}

// -------------------- partners / matching --------------------
/** Design §compatibility weights: 30 zal · 25 cədvəl · 15 səviyyə · 15 məqsəd ·
 *  10 tip · 5 ardıcıllıq = 100 (src/store/db.ts:computeCompatibility).
 *
 *  A profile row carries no training days and no consistency signal, so those two
 *  components are never awarded here: the number is built ONLY from what we
 *  actually compared. Nothing is added for free.
 *
 *  Two states that used to be confused are now distinct:
 *    · a computed 0 = we compared everything and nothing lined up;
 *    · `null` (see mapPartner) = there was nothing to compare against, so no
 *      percentage is claimed at all.
 *
 *  Every dimension also reports back WHY: a match goes into `reasons`, a miss
 *  into `mismatches`. The design forbids a black box — the user must be able to
 *  see «Səviyyə fərqi» next to «Eyni zal», not only the flattering half. */
const LEVEL_ORDER = ['Başlanğıc', 'Orta', 'İrəli'];
const SLOT_ORDER = ['Səhər 6–9', 'Gündüz 9–17', 'Axşam 17–21', 'Gecə 21–24'];

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const inter = a.filter((x) => setB.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

/** 1 = same slot, 0.35 = the neighbouring slot, 0 = nothing comparable. */
function slotMatch(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ia = SLOT_ORDER.indexOf(a);
  const ib = SLOT_ORDER.indexOf(b);
  if (ia < 0 || ib < 0) return 0;
  return Math.abs(ia - ib) === 1 ? 0.35 : 0;
}

/** Design §compatibility: same level = 1, ONE step apart = 0.6, TWO steps = 0.15.
 *  The small residual matters — a Başlanğıc↔İrəli pair is a worse fit than an
 *  Orta↔İrəli pair but still a better one than a pair whose levels nobody wrote
 *  down, and only an unknown level scores a flat 0: we cannot compare what we
 *  were never told. */
function levelProximity(a: string | null, b: string | null): number {
  // Rows written before schema16 may still hold 'beginner'/'advanced'; toLevel
  // is the single place that knows those spellings.
  const ia = LEVEL_ORDER.indexOf(toLevel(a) ?? '');
  const ib = LEVEL_ORDER.indexOf(toLevel(b) ?? '');
  if (ia < 0 || ib < 0) return 0;
  const d = Math.abs(ia - ib);
  return d === 0 ? 1 : d === 1 ? 0.6 : 0.15;
}

/** Design §compatibility: same gym = 1, a DIFFERENT gym within 2 km = 0.5,
 *  anything further = 0. An unknown distance is never rounded up to «yaxın» —
 *  a gym with no recorded coordinates simply scores 0 on this dimension. */
const GYM_NEAR_KM = 2;

function gymMatch(mine: string | null, theirs: string | null, distanceKm: number | null): number {
  if (!mine || !theirs) return 0;
  if (mine === theirs) return 1;
  if (distanceKm !== null && distanceKm <= GYM_NEAR_KM) return 0.5;
  return 0;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kilometres between two gyms, or null when either id is missing or the row has
 *  no coordinates. Never throws: a failed lookup degrades the gym dimension to
 *  «not near», it must not take the whole partner list down with it. */
async function gymGapKm(aId: string | null | undefined, bId: string | null | undefined): Promise<number | null> {
  if (!aId || !bId) return null;
  if (aId === bId) return 0;
  try {
    const { data, error } = await supabase.from('gyms').select('id,lat,lng').in('id', [aId, bId]);
    if (error) throw error;
    const rows = (data ?? []) as { id: string; lat: number | null; lng: number | null }[];
    const a = rows.find((r) => r.id === aId);
    const b = rows.find((r) => r.id === bId);
    if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
    return haversineKm(a.lat, a.lng, b.lat, b.lng);
  } catch {
    return null;
  }
}

/** The result of one comparison. `reasons` are the dimensions that lined up,
 *  `mismatches` the ones that did not — both are returned in full so the screen
 *  can decide what to show; nothing is silently truncated here any more. */
export interface Compatibility {
  score: number;
  reasons: string[];
  mismatches: string[];
}

function compatibility(me: DbProfile, other: DbProfile, gymDistanceKm: number | null): Compatibility {
  const reasons: string[] = [];
  const mismatches: string[] = [];

  const gym = gymMatch(me.home_gym_id, other.home_gym_id, gymDistanceKm);
  if (gym >= 1) reasons.push('Eyni zal');
  else if (gym > 0) reasons.push('Yaxın zal');
  else if (!me.home_gym_id || !other.home_gym_id) mismatches.push('Zal göstərilməyib');
  else mismatches.push('Fərqli zal');

  const slot = slotMatch(me.time_slot, other.time_slot);
  if (slot >= 1) reasons.push('Eyni saat');
  else if (slot > 0) reasons.push('Yaxın saat');
  else if (!me.time_slot || !other.time_slot) mismatches.push('Vaxt göstərilməyib');
  else mismatches.push('Fərqli saat');

  const level = levelProximity(me.level, other.level);
  if (level >= 1) reasons.push('Eyni səviyyə');
  else if (level >= 0.6) reasons.push('Yaxın səviyyə');
  else if (level > 0) mismatches.push('Səviyyə fərqi');
  else mismatches.push('Səviyyə göstərilməyib');

  const goal = jaccard(me.goals ?? [], other.goals ?? []);
  const sharedGoal = (me.goals ?? []).find((g) => (other.goals ?? []).includes(g));
  if (sharedGoal) reasons.push(sharedGoal);
  else if (!me.goals?.length || !other.goals?.length) mismatches.push('Məqsəd göstərilməyib');
  else mismatches.push('Fərqli məqsəd');

  const type = jaccard(me.types ?? [], other.types ?? []);
  const sharedType = (me.types ?? []).find((t) => (other.types ?? []).includes(t));
  if (sharedType) reasons.push(sharedType);
  else if (!me.types?.length || !other.types?.length) mismatches.push('Məşq tipi göstərilməyib');
  else mismatches.push('Fərqli məşq tipi');

  const raw = 30 * gym + 25 * slot + 15 * level + 15 * goal + 10 * type;
  return { score: Math.max(0, Math.min(99, Math.round(raw))), reasons, mismatches };
}

/** Do we hold enough of MY profile to compare anything at all? Without this the
 *  score below would be a statement about a profile the app never read. */
function canCompare(me: DbProfile | null): me is DbProfile {
  if (!me) return false;
  return !!me.home_gym_id || !!me.time_slot || !!me.level || !!me.goals?.length || !!me.types?.length;
}

function mapPartner(p: DbProfile, me: DbProfile | null, hereNow: boolean, gymDistanceKm: number | null = null): Partner {
  // No profile of my own = nothing was compared. That is NOT a score of 0 — a 0
  // is a real result («we compared and nothing matched»). It is the absence of a
  // result, so `compatibility` is null and the screen prints «hesablanmadı»
  // instead of asserting «0% uyğun» over a comparison that never happened. The
  // old code also smuggled the UI instruction «Profilini tamamla» in as a match
  // reason; a reason list must only ever hold reasons.
  const comp = canCompare(me) ? compatibility(me, p, gymDistanceKm) : null;
  return {
    id: p.id,
    name: p.name ?? 'İstifadəçi',
    age: p.age ?? 0,
    gender: (p.gender as Partner['gender']) ?? 'kişi',
    gymId: p.home_gym_id ?? '',
    // Never surface a raw stored value — see toLevel.
    level: toLevel(p.level) ?? 'Orta',
    goals: p.goals ?? [],
    types: p.types ?? [],
    usualTime: p.time_slot ?? '',
    compatibility: comp ? comp.score : null,
    matchReasons: comp ? comp.reasons : [],
    mismatches: comp ? comp.mismatches : [],
    hereNow,
    prs: [],
  };
}

/** Rank comparator: best match first, and a partner whose score was never
 *  computed (null) always last — an unknown fit must not outrank a measured one,
 *  and it must not be silently treated as 0 either. */
export function byCompatibility(a: Partner, b: Partner): number {
  if (a.compatibility === null && b.compatibility === null) return 0;
  if (a.compatibility === null) return 1;
  if (b.compatibility === null) return -1;
  return b.compatibility - a.compatibility;
}

/** A profile only counts as a real, listable partner once onboarding gave it a name
 *  plus at least one concrete signal (age or a goal). Filters out the empty placeholder
 *  rows that anonymous sign-ins create before the user fills anything in. */
function looksComplete(p: DbProfile): boolean {
  if (isPlaceholderName(p.name)) return false;
  return (p.age ?? 0) > 0 || (p.goals?.length ?? 0) > 0;
}

async function activeProfileIdsAtGym(gymId: string): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from('check_ins').select('profile_id').eq('gym_id', gymId).gt('expires_at', nowIso);
  if (error) throw error;
  return new Set((data ?? []).map((r: { profile_id: string }) => r.profile_id));
}

/** Someone who turned «Zalda göründüyümü göstər» off must not appear in any public
 *  list. The column is nullable (older rows predate it), so only an explicit
 *  `false` hides — a NULL means "never touched the switch" = visible. */
function isListable(p: DbProfile): boolean {
  return p.show_in_gym_list !== false;
}

/** Partners whose home gym is `gymId` (excluding me), sorted by compatibility.
 *
 *  Order of operations is the one the design mandates: the eligibility filters
 *  (myself, «zalda görünmə» off, an unfinished placeholder row) run FIRST, and
 *  only the profiles that survive are scored — nobody is ranked into a list they
 *  are not allowed to appear in. Everyone here shares `gymId`, so one distance
 *  lookup between my home gym and this gym covers the whole page. */
export async function getPartnersAtGym(gymId: string): Promise<Partner[]> {
  const me = await getMyProfile();
  const [{ data, error }, here, gap] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLS).eq('home_gym_id', gymId),
    activeProfileIdsAtGym(gymId),
    gymGapKm(me?.home_gym_id, gymId),
  ]);
  if (error) throw error;
  return (data ?? [])
    .filter((p: DbProfile) => p.id !== me?.id && isListable(p) && looksComplete(p))
    .map((p: DbProfile) => mapPartner(p, me, here.has(p.id), gap))
    .sort(byCompatibility);
}

/** Just the people currently checked in at a gym. */
export async function getWhoIsHere(gymId: string): Promise<Partner[]> {
  return (await getPartnersAtGym(gymId)).filter((p) => p.hereNow);
}

export async function getPartner(id: string): Promise<Partner | null> {
  const me = await getMyProfile();
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // A hidden profile stays hidden on the deep-link path too, otherwise an old
  // saved id would still open the full card of someone who opted out.
  if (!isListable(data as DbProfile) && (data as DbProfile).id !== me?.id) return null;
  const [here, gap] = await Promise.all([
    data.home_gym_id ? activeProfileIdsAtGym(data.home_gym_id) : Promise.resolve(new Set<string>()),
    gymGapKm(me?.home_gym_id, (data as DbProfile).home_gym_id),
  ]);
  return mapPartner(data as DbProfile, me, here.has((data as DbProfile).id), gap);
}

export async function sendMatchRequest(toProfileId: string): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  const { error } = await supabase.from('match_requests').insert({ from_profile: me.id, to_profile: toProfileId });
  if (error) throw error;
}

// -------------------- community --------------------
export async function createCommunityPost(p: { author: string; gym: string; body: string }): Promise<void> {
  // Stamp the poster's PROFILE id (not the auth uid — author_id is a FK to
  // profiles). Without it nothing downstream can tell whose post this is.
  const me = await getMyProfile();
  // No profile = no post. `author_id ?? null` used to write an unattributable
  // row; schema29 now refuses those outright, so failing here says why instead of
  // surfacing a raw policy error.
  if (!me?.id) throw new Error('no profile');
  const { error } = await supabase.from('community_posts').insert({
    author: p.author,
    author_id: me.id,
    gym: p.gym,
    time_ago: 'indi',
    type: 'text',
    body: p.body,
    likes: 0,
    comments: 0,
  });
  if (error) throw error;
  // The feed caches the community list for a minute; without this the user is
  // told «Postun paylaşıldı» and then shown a feed that does not contain it.
  invalidateFocusCache('community_posts');
}

// -------------------- account roles (trainer / gym) --------------------
/** Turn the current user into a trainer: flag their profile + publish a trainer listing.
 *  Requires schema3.sql (role/specialty columns + trainers owner_id + insert policy). */
export async function becomeTrainer(input: { specialty: string; bio: string; priceFrom: number; name: string; homeGymId: string | null }): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  // Each write is checked: «Müəllim hesabın hazırdır» may only be said about
  // rows that actually landed, and a half-written trainer (listing without a
  // verification row) would sit in nobody's queue forever.
  const { error: roleErr } = await supabase
    .from('profiles')
    .update({ role: 'trainer', specialty: input.specialty, price_from: input.priceFrom })
    .eq('id', me.id);
  if (roleErr) throw roleErr;
  // `verified`, `verify_status`, `rating` and `clients` are NOT written here.
  // schema27 withholds those four columns from every client: a trainer who could
  // set them was one request away from publishing themselves as an approved coach
  // with a 5.0 rating and 120 students. Their real values come from the database:
  // the defaults (false / 'unverified' / 0 / 0), the `trainer_verifications`
  // trigger that moves the status to «pending», the admin's decision, and the
  // trigger that counts accepted students.
  const { error: listErr } = await supabase.from('trainers').upsert({
    id: me.id,
    name: input.name || me.name || 'Müəllim',
    gym_id: input.homeGymId,
    specialty: input.specialty,
    response_time: '~1 saat',
    price_from: input.priceFrom,
    bio: input.bio,
    certifications: [],
    owner_id: me.id,
  });
  if (listErr) throw listErr;
  // Queue the trainer for admin verification (Müəllim doğrulanması).
  const { error: verErr } = await supabase.from('trainer_verifications').insert({
    trainer_id: me.id,
    user_id: me.user_id,
    status: 'pending',
    gym_confirm: false,
  });
  if (verErr) throw verErr;
  // The catalogue is cached for a minute; a brand-new trainer must not wait for it.
  invalidateFocusCache('trainers');
}

/** Create a gym listing owned by the current user. Returns the new gym id.
 *  Requires schema3.sql (gyms owner_id + insert policy).
 *
 *  Ownership is NOT claimed here: the gym starts `unclaimed` and the owner sends
 *  the real VÖEN application from /gym/claim. Pre-filing a VÖEN-less gym_claims
 *  row used to make that form unreachable AND told the owner a review was under
 *  way that no admin could ever complete. */
export async function createGym(input: { name: string; district: string; hours: string; priceMonth: number; dayPass: number; amenities: string[] }): Promise<string> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  // One profile = one gym. A retry after an insert that committed but whose
  // response was lost must not append a second row: two gyms with the same
  // owner_id used to brick the whole gym panel permanently.
  const { data: owned, error: ownedErr } = await supabase
    .from('gyms')
    .select('id')
    .eq('owner_id', me.id)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (ownedErr) throw ownedErr;
  if ((owned as { id: string } | null)?.id) throw new Error('gym-exists');
  const id = `usr-${Date.now().toString(36)}`;
  // `verified`, `claim_status` and the four derived counters are NOT written
  // here — schema27 withholds them from every client. Their real values come from
  // the column defaults (false / 'unclaimed' / 0), the sync triggers
  // (`members`, `trainers`, `rating`, `review_count`) and, for `claim_status`,
  // from actually filing a gym_claims row.
  const { error } = await supabase.from('gyms').insert({
    id,
    name: input.name,
    district: input.district,
    price_month: input.priceMonth,
    day_pass: input.dayPass,
    hours: input.hours,
    amenities: input.amenities,
    tags: [],
    about: null,
    image_url: null,
    owner_id: me.id,
  });
  if (error) throw error;
  invalidateFocusCache('gyms');
  return id;
}

// -------------------- reports (moderation) --------------------
export async function createReport(input: {
  /** `support` = a message to the SPOT team, not a complaint about anybody.
   *  It used to be filed as `user` / «support», which put every support message
   *  in front of a moderator as a report against a person who does not exist —
   *  complete with working ban buttons. See schema21. */
  targetType: 'user' | 'content' | 'gym' | 'trainer' | 'message' | 'support';
  targetId: string;
  category?: 'safety' | 'harassment' | 'spam' | 'fake' | 'payment' | 'other';
  note?: string;
}): Promise<void> {
  const uid = await getUserId();
  if (!uid) throw new Error('no session');
  const { error } = await supabase.from('reports').insert({
    reporter_id: uid,
    target_type: input.targetType,
    target_id: input.targetId,
    category: input.category ?? 'other',
    note: input.note ?? null,
  });
  if (error) throw error;
}

// -------------------- day-pass --------------------
/** Record a day-pass. SPOT charges nothing and takes NO commission — `price` is
 *  the gym's informational price, paid at the gym. Returns the door code the
 *  member shows at reception (useless if we swallowed it). */
export async function buyDayPass(gymId: string, price: number): Promise<{ code: string; expiresAt: string }> {
  const uid = await getUserId();
  if (!uid) throw new Error('no session');
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const end = new Date();
  end.setHours(23, 59, 59, 0);
  const expiresAt = end.toISOString();
  const { error } = await supabase.from('day_passes').insert({
    user_id: uid,
    gym_id: gymId,
    code,
    price,
    // There is no `commission` column any more. It existed, defaulted to 0, and
    // was written as 0 here — but a commission field in the schema is a place for
    // a commission to appear later, and SPOT takes none. schema27 drops it.
    status: 'active',
    expires_at: expiresAt,
  });
  if (error) throw error;
  return { code, expiresAt };
}

/** Upload a picked video to Supabase Storage and publish it as a feed video.
 *  Requires schema3.sql (creates the public `videos` bucket + policies). */
export async function uploadFeedVideo(input: { uri: string; caption: string; author: string; linkedProgramTitle: string; linkedProgramId: string }): Promise<void> {
  const me = await getMyProfile();
  // Checked BEFORE the upload: schema29 refuses an authorless video, so without
  // this the file would be pushed to storage and the row rejected afterwards —
  // leaving an orphaned upload and an error that says nothing useful.
  if (!me?.id) throw new Error('no profile');
  const id = `uv-${Date.now().toString(36)}`;
  const path = `${id}.mp4`;
  const arraybuffer = await (await fetch(input.uri)).arrayBuffer();
  const { error: upErr } = await supabase.storage.from('videos').upload(path, arraybuffer, { contentType: 'video/mp4', upsert: true });
  if (upErr) throw upErr;
  const videoUrl = supabase.storage.from('videos').getPublicUrl(path).data.publicUrl;
  const { error } = await supabase.from('feed_videos').insert({
    id,
    author: input.author,
    // Identity, so the feed can tell whose video this is without guessing from
    // the display name. FK to profiles(id) — never the auth uid.
    author_id: me.id,
    verified: false,
    is_trainer: me?.role === 'trainer',
    caption: input.caption,
    hashtags: [],
    likes: 0,
    comments: 0,
    linked_program_title: input.linkedProgramTitle,
    linked_program_id: input.linkedProgramId,
    gradient: ['#3A3A44', '#101014'],
    video_url: videoUrl,
    ord: 0,
  });
  if (error) throw error;
  // Same reason as createCommunityPost: the success toast must not outrun the feed.
  invalidateFocusCache('feed_videos');
}

// -------------------- workouts / stats --------------------
export interface WorkoutLog {
  programId?: string | null;
  title: string;
  durationSec: number;
  volumeKg: number;
  setsDone: number;
  rpe?: string | null;
}

/** Persist a finished workout for the current user. */
/**
 * Mirror a workout to the server under the SAME id the device engine used.
 *
 * The shared id is the whole point: without it the two copies could never be
 * matched, so the server rows were written and never read, and the profile
 * showed «0 məşq» for an account the server knew had two. `onConflict: 'id'`
 * makes a retry after a lost response idempotent instead of a duplicate.
 *
 * Only the SUMMARY travels — the per-set detail stays on the device. That is
 * deliberate: `progress`, `prs` and set-by-set numbers are the private training
 * data the privacy rule keeps off every other surface, and a summary is enough
 * for the count, the volume and the streak.
 */
export async function logWorkout(w: WorkoutLog & { id?: string; at?: string }): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  const { error } = await supabase.from('workouts').upsert(
    {
      ...(w.id ? { id: w.id } : {}),
      profile_id: me.id,
      program_id: w.programId ?? null,
      title: w.title,
      duration_sec: Math.round(w.durationSec),
      volume_kg: Math.round(w.volumeKg),
      sets_done: w.setsDone,
      rpe: w.rpe ?? null,
      ...(w.at ? { created_at: w.at } : {}),
    },
    { onConflict: 'id' }
  );
  if (error) throw error;
}

/** Every workout summary the server holds for me, newest first. */
export interface ServerWorkout {
  id: string;
  at: string;
  title: string;
  programId: string | null;
  volumeKg: number;
  durationMin: number;
  setsDone: number;
  rpe: string | null;
}

export async function getMyWorkouts(limit = 200): Promise<ServerWorkout[]> {
  const me = await getMyProfile();
  if (!me) return [];
  const { data, error } = await supabase
    .from('workouts')
    .select('id,program_id,title,duration_sec,volume_kg,sets_done,rpe,created_at')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as {
    id: string; program_id: string | null; title: string | null; duration_sec: number | null;
    volume_kg: number | null; sets_done: number | null; rpe: string | null; created_at: string;
  }[]).map((r) => ({
    id: r.id,
    at: r.created_at,
    title: r.title ?? 'Məşq',
    programId: r.program_id,
    volumeKg: Number(r.volume_kg ?? 0),
    durationMin: Math.round(Number(r.duration_sec ?? 0) / 60),
    setsDone: Number(r.sets_done ?? 0),
    rpe: r.rpe,
  }));
}

/** Bodyweight history with ids, so it can be reconciled like workouts. */
export async function getMyProgress(limit = 200): Promise<{ id: string; at: string; kg: number }[]> {
  const me = await getMyProfile();
  if (!me) return [];
  const { data, error } = await supabase
    .from('progress')
    .select('id,weight,created_at')
    .eq('profile_id', me.id)
    .order('created_at')
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as { id: string; weight: number | null; created_at: string }[])
    .map((r) => ({ id: r.id, at: r.created_at, kg: Number(r.weight ?? 0) }));
}

export async function logPR(lift: string, value: number, delta?: string): Promise<void> {
  const me = await getMyProfile();
  if (!me) return;
  await supabase.from('prs').insert({ profile_id: me.id, lift, value, delta: delta ?? null });
}

/** Log a bodyweight entry (kg) to the progress table. */
export async function logWeight(kg: number, id?: string, at?: string): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  const { error } = await supabase.from('progress').upsert(
    { ...(id ? { id } : {}), profile_id: me.id, weight: kg, ...(at ? { created_at: at } : {}) },
    { onConflict: 'id' }
  );
  if (error) throw error;
}

/** Chronological bodyweight history (oldest→newest) for the progress chart. */
export async function getWeightHistory(limit = 12): Promise<number[]> {
  const me = await getMyProfile();
  if (!me) return [];
  const { data, error } = await supabase
    .from('progress')
    .select('weight,created_at')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r: { weight: number | null }) => Number(r.weight)).filter((n) => !Number.isNaN(n));
}

/** Latest logged bodyweight, or null if none. */
export async function getLatestWeight(): Promise<number | null> {
  const me = await getMyProfile();
  if (!me) return null;
  const { data, error } = await supabase
    .from('progress')
    .select('weight,created_at')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as { weight: number | null } | undefined;
  return row?.weight != null ? Number(row.weight) : null;
}

export interface MyStats {
  count: number;
  volumeKg: number;
  streakDays: number;
  sinceDays: number;
}

/** Aggregate the current user's real workout history for the profile screen. */
export async function getMyStats(): Promise<MyStats> {
  const me = await getMyProfile();
  if (!me) return { count: 0, volumeKg: 0, streakDays: 0, sinceDays: 0 };
  const { data, error } = await supabase
    .from('workouts')
    .select('volume_kg,created_at')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as { volume_kg: number | null; created_at: string }[];
  const count = rows.length;
  const volumeKg = rows.reduce((s, r) => s + Number(r.volume_kg ?? 0), 0);

  // Streak = consecutive calendar days (ending today or yesterday) with ≥1 workout.
  const days = new Set(rows.map((r) => r.created_at.slice(0, 10)));
  const cursor = new Date();
  let streakDays = 0;
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  let sinceDays = 0;
  if (rows.length) {
    const first = new Date(rows[rows.length - 1].created_at).getTime();
    sinceDays = Math.max(0, Math.floor((Date.now() - first) / 86400000));
  }
  return { count, volumeKg, streakDays, sinceDays };
}

export interface MyPR {
  lift: string;
  value: number;
  delta: string | null;
}

export interface MyWeekStats {
  count: number;
  volumeKg: number;
  durationSec: number;
  perDay: number[]; // Mon..Sun volume
}

/** Current-week (Mon–Sun) workout totals + per-day volume for the workout home chart. */
export async function getMyWeekStats(): Promise<MyWeekStats> {
  const empty: MyWeekStats = { count: 0, volumeKg: 0, durationSec: 0, perDay: [0, 0, 0, 0, 0, 0, 0] };
  const me = await getMyProfile();
  if (!me) return empty;
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - dow);
  const { data, error } = await supabase
    .from('workouts')
    .select('volume_kg,duration_sec,created_at')
    .eq('profile_id', me.id)
    .gte('created_at', monday.toISOString());
  if (error) return empty;
  const rows = (data ?? []) as { volume_kg: number | null; duration_sec: number | null; created_at: string }[];
  const perDay = [0, 0, 0, 0, 0, 0, 0];
  let volumeKg = 0;
  let durationSec = 0;
  for (const r of rows) {
    const idx = (new Date(r.created_at).getDay() + 6) % 7;
    perDay[idx] += Number(r.volume_kg ?? 0);
    volumeKg += Number(r.volume_kg ?? 0);
    durationSec += Number(r.duration_sec ?? 0);
  }
  return { count: rows.length, volumeKg, durationSec, perDay };
}

/** Every partner request this account is on either side of.
 *
 *  There was no read path for these at all: `sendMatchRequest` inserted a row and
 *  the device recorded «requested» in its own store, which nothing ever checked
 *  again. So the sender's «Gözləyən təklif» chip survived the other person
 *  accepting, declining, or deleting their account — it could only ever count up. */
export interface MatchRequestRow {
  /** The OTHER person's profile id, whichever side of the row they are on. */
  otherProfileId: string;
  status: 'pending' | 'accepted' | 'declined';
  iSent: boolean;
}

export async function getMyMatchRequests(): Promise<MatchRequestRow[]> {
  const me = await getMyProfile();
  if (!me) return [];
  const { data, error } = await supabase
    .from('match_requests')
    .select('from_profile,to_profile,status')
    .or(`from_profile.eq.${me.id},to_profile.eq.${me.id}`);
  // A read failure is NOT «no requests»: the caller reconciles local state against
  // this, and an empty array would wipe the device's record of real requests.
  if (error) throw error;
  return ((data ?? []) as { from_profile: string; to_profile: string; status: string | null }[]).map((r) => {
    const iSent = r.from_profile === me.id;
    const st = r.status === 'accepted' || r.status === 'declined' ? r.status : 'pending';
    return { otherProfileId: iSent ? r.to_profile : r.from_profile, status: st, iSent };
  });
}

/** `getMyMatchRequests` with the failure case made explicit: `null` means «we
 *  could not ask», which the caller must treat differently from «there are
 *  none». Reconciling against a failed read would delete the device's record of
 *  real requests. */
export async function getMatchRequestsSafe(): Promise<MatchRequestRow[] | null> {
  try {
    return await getMyMatchRequests();
  } catch {
    return null;
  }
}

/** Count of accepted workout-partner matches involving the current user. */
export async function getMyPartnerCount(): Promise<number> {
  const me = await getMyProfile();
  if (!me) return 0;
  const { data, error } = await supabase
    .from('match_requests')
    .select('from_profile,to_profile')
    .eq('status', 'accepted')
    .or(`from_profile.eq.${me.id},to_profile.eq.${me.id}`);
  if (error) return 0;
  const others = new Set<string>();
  for (const r of (data ?? []) as { from_profile: string; to_profile: string }[]) {
    others.add(r.from_profile === me.id ? r.to_profile : r.from_profile);
  }
  return others.size;
}

/** The current user's latest PR per lift. */
export async function getMyPRs(): Promise<MyPR[]> {
  const me = await getMyProfile();
  if (!me) return [];
  const { data, error } = await supabase
    .from('prs')
    .select('lift,value,delta,created_at')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const latest = new Map<string, MyPR>();
  for (const r of (data ?? []) as { lift: string; value: number; delta: string | null }[]) {
    if (!latest.has(r.lift)) latest.set(r.lift, { lift: r.lift, value: Number(r.value), delta: r.delta });
  }
  return [...latest.values()];
}

// -------------------- account deletion --------------------
/**
 * Delete this account for good.
 *
 * Order matters and is not an implementation detail: the FILES go first, then
 * the rows. Supabase forbids deleting `storage.objects` from SQL, so the RPC
 * cannot do it — and if the rows went first, the account that owns the files
 * would be gone and `owner = auth.uid()` would never match again, leaving the
 * avatar, the gym photos and the videos in a public bucket with nobody able to
 * remove them.
 *
 * A failure at any step throws, so the settings screen can say the account is
 * still there rather than reporting a deletion that half happened.
 */
export async function deleteMyAccount(): Promise<void> {
  const uid = await getUserId();
  if (!uid) throw new Error('not-signed-in');

  // Every bucket the app writes to. `owner = auth.uid()` in the storage policies
  // (schema33) means a `remove()` only ever takes this account's own files.
  for (const bucket of ['avatars', 'gyms', 'videos', 'certs'] as const) {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit: 1000 });
    if (error) throw error;
    const mine: string[] = [];
    for (const f of (data ?? []) as { name: string; owner?: string | null }[]) {
      // `list` returns the whole bucket; only the rows this account owns are
      // removable, and asking for the others would fail the whole call.
      if (f.owner === uid) mine.push(f.name);
    }
    if (mine.length) {
      const { error: rmErr } = await supabase.storage.from(bucket).remove(mine);
      if (rmErr) throw rmErr;
    }
  }

  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
  // The session belongs to a user that no longer exists.
  await supabase.auth.signOut().catch(() => {});
}
