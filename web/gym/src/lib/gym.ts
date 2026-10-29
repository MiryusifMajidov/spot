/**
 * The gym panel's data layer — the same tables, RPCs and rules the app's gym
 * panel uses (src/lib/gymOwner.tsx, roles.ts, images.ts). Nothing here needs a
 * schema change: RLS already lets an owner read and write their own gym.
 *
 * Privacy red line (same as the app): a member's workouts, weights, photos and
 * messages are never read. The owner sees membership and check-in frequency.
 */
import { supabase } from './supabase';

// ------------------------------------------------------------------ types ----
export interface ScheduleItem {
  time: string;
  name: string;
  trainer: string;
}

export type ClaimStatus = 'unclaimed' | 'pending' | 'claimed';

export interface Gym {
  id: string;
  name: string;
  district: string;
  hours: string;
  priceMonth: number;
  dayPass: number;
  amenities: string[];
  about: string;
  rating: number;
  reviewCount: number;
  verified: boolean;
  claimStatus: ClaimStatus;
  listed: boolean;
  schedule: ScheduleItem[];
  allowDayPass: boolean;
  showMembers: boolean;
  imageUrl: string | null;
  photos: string[];
}

export interface Owner {
  profileId: string;
  name: string;
}

function mapGym(r: Record<string, unknown>): Gym {
  const sched = Array.isArray(r.schedule) ? (r.schedule as ScheduleItem[]) : [];
  return {
    id: String(r.id),
    name: (r.name as string) ?? '',
    district: (r.district as string) ?? '',
    hours: (r.hours as string) ?? '',
    priceMonth: Number(r.price_month ?? 0),
    dayPass: Number(r.day_pass ?? 0),
    amenities: (r.amenities as string[]) ?? [],
    about: (r.about as string) ?? '',
    rating: Number(r.rating ?? 0),
    reviewCount: Number(r.review_count ?? 0),
    verified: Boolean(r.verified),
    claimStatus: ((r.claim_status as ClaimStatus) ?? 'unclaimed') as ClaimStatus,
    listed: r.listed == null ? true : Boolean(r.listed),
    schedule: sched.filter((s) => s && typeof s.name === 'string'),
    allowDayPass: r.allow_day_pass == null ? true : Boolean(r.allow_day_pass),
    showMembers: r.show_members == null ? true : Boolean(r.show_members),
    imageUrl: (r.image_url as string) ?? null,
    photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
  };
}

// ---------------------------------------------------------------- account ----
/** The signed-in person's profile row. Null = signed in, but no SPOT profile. */
export async function fetchOwner(): Promise<Owner | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('profiles').select('id,name').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as { id: string; name: string | null };
  return { profileId: r.id, name: r.name ?? '' };
}

/** Every gym this profile owns (usually one). Throws when the read failed —
 *  «you own no gym» may only be said about rows we actually read. */
export async function fetchMyGyms(profileId: string): Promise<Gym[]> {
  const { data, error } = await supabase.from('gyms').select('*').eq('owner_id', profileId).order('id');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapGym);
}

export async function fetchGym(gymId: string): Promise<Gym | null> {
  const { data, error } = await supabase.from('gyms').select('*').eq('id', gymId).maybeSingle();
  if (error) throw error;
  return data ? mapGym(data as Record<string, unknown>) : null;
}

// ------------------------------------------------------------- reading ----
/** PostgREST cuts a response at 1000 rows without saying so; read every page. */
const PAGE = 1000;
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Azerbaijan is UTC+4 all year; the gym's day follows its own clock, not the
 *  browser's (a reception PC on the wrong time zone must not shift the chart). */
const BAKU_OFFSET_MS = 4 * 3_600_000;
export const bakuHour = (iso: string) => new Date(new Date(iso).getTime() + BAKU_OFFSET_MS).getUTCHours();
export const bakuDayKey = (ms: number) => new Date(ms + BAKU_OFFSET_MS).toISOString().slice(0, 10);
function bakuMidnight(daysAgo = 0): Date {
  const baku = new Date(Date.now() + BAKU_OFFSET_MS);
  return new Date(Date.UTC(baku.getUTCFullYear(), baku.getUTCMonth(), baku.getUTCDate() - daysAgo) - BAKU_OFFSET_MS);
}

export interface Occupancy {
  now: number;
  today: number;
  byHour: number[];
}

/** Who is checked in right now + today's check-ins by hour. */
export async function getOccupancy(gymId: string): Promise<Occupancy> {
  const { data, error } = await supabase
    .from('check_ins')
    .select('created_at,expires_at')
    .eq('gym_id', gymId)
    .gt('created_at', bakuMidnight().toISOString());
  if (error) throw error;
  const rows = (data ?? []) as { created_at: string; expires_at: string | null }[];
  const byHour = new Array(24).fill(0) as number[];
  const nowIso = new Date().toISOString();
  let now = 0;
  for (const r of rows) {
    byHour[bakuHour(r.created_at)] += 1;
    if (!r.expires_at || r.expires_at > nowIso) now += 1;
  }
  return { now, byHour, today: rows.length };
}

/** Check-ins per day for the last `days` days (oldest first), Baku calendar. */
export async function getDailyCheckIns(gymId: string, days = 14): Promise<{ day: string; n: number }[]> {
  const since = bakuMidnight(days - 1);
  const rows = await readAll<{ created_at: string }>((from, to) =>
    supabase
      .from('check_ins')
      .select('created_at')
      .eq('gym_id', gymId)
      .gte('created_at', since.toISOString())
      .order('created_at')
      .order('id')
      .range(from, to)
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = bakuDayKey(Date.parse(r.created_at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: { day: string; n: number }[] = [];
  for (let i = 0; i < days; i++) {
    const k = bakuDayKey(since.getTime() + i * 86_400_000 + 3_600_000);
    out.push({ day: k, n: counts.get(k) ?? 0 });
  }
  return out;
}

/** Day-passes today: live right now, and honoured at the door. A COUNT only —
 *  SPOT takes no payment, so the panel shows no earnings figure. */
export async function getDayPassToday(gymId: string): Promise<{ live: number; usedToday: number }> {
  const { data, error } = await supabase
    .from('day_passes')
    .select('status,expires_at,used_at')
    .eq('gym_id', gymId)
    .gte('purchased_at', bakuMidnight().toISOString());
  if (error) throw error;
  const now = Date.now();
  const rows = (data ?? []) as { status: string; expires_at: string | null; used_at: string | null }[];
  return {
    live: rows.filter((r) => r.status === 'active' && r.expires_at && Date.parse(r.expires_at) > now).length,
    usedToday: rows.filter((r) => r.status === 'used').length,
  };
}

// ---------------------------------------------------------------- roster ----
/** «Sadiq» = at least this many check-ins here in the last 30 days (as the app). */
export const LOYAL_CHECKINS = 12;

export interface Member {
  profileId: string;
  name: string;
  anonymous: boolean;
  level: string | null;
  goals: string[];
  checkIns30d: number;
  lastCheckIn: string | null;
  hereNow: boolean;
  joinedAt: string | null;
}

/** Profiles whose home gym this is, with their real check-in frequency — and
 *  who is inside right now. A member who hid themselves from the gym list stays
 *  «Anonim üzv»: no name, level or goals. */
export async function getRoster(gymId: string): Promise<{ members: Member[]; insideNow: number }> {
  type P = { id: string; name: string | null; level: string | null; goals: string[] | null; show_in_gym_list: boolean | null; created_at: string | null };
  const rows = await readAll<P>((from, to) =>
    supabase
      .from('profiles')
      .select('id,name,level,goals,show_in_gym_list,created_at')
      .eq('home_gym_id', gymId)
      .order('id')
      .range(from, to)
  );
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const cis = rows.length
    ? await readAll<{ profile_id: string; created_at: string }>((from, to) =>
        supabase
          .from('check_ins')
          .select('profile_id,created_at')
          .eq('gym_id', gymId)
          .gt('created_at', since)
          .order('created_at')
          .order('id')
          .range(from, to)
      )
    : [];
  const { data: active, error } = await supabase
    .from('check_ins')
    .select('profile_id')
    .eq('gym_id', gymId)
    .gt('expires_at', new Date().toISOString());
  if (error) throw error;
  const here = new Set(((active ?? []) as { profile_id: string }[]).map((r) => r.profile_id));

  const counts = new Map<string, { n: number; last: string }>();
  for (const c of cis) {
    const cur = counts.get(c.profile_id);
    if (!cur) counts.set(c.profile_id, { n: 1, last: c.created_at });
    else counts.set(c.profile_id, { n: cur.n + 1, last: c.created_at > cur.last ? c.created_at : cur.last });
  }
  const members = rows.map((p) => {
    const anonymous = p.show_in_gym_list === false;
    return {
      profileId: p.id,
      name: anonymous ? 'Anonim üzv' : p.name ?? 'Üzv',
      anonymous,
      level: anonymous ? null : p.level,
      goals: anonymous ? [] : p.goals ?? [],
      checkIns30d: counts.get(p.id)?.n ?? 0,
      lastCheckIn: counts.get(p.id)?.last ?? null,
      hereNow: here.has(p.id),
      joinedAt: p.created_at,
    };
  });
  return { members, insideNow: here.size };
}

// --------------------------------------------------------------- day-pass ----
export type PassState = 'valid' | 'used' | 'expired' | 'refunded' | 'not_found' | 'redeemed';
export interface PassCheck {
  state: PassState;
  gym_id?: string;
  price?: number;
  purchased_at?: string;
  expires_at?: string;
  used_at?: string;
}

/** Look a code up at a gym the caller owns. Changes nothing, and returns
 *  nothing about the visitor — reception needs the pass, not the person. */
export async function checkDayPass(code: string): Promise<PassCheck> {
  const { data, error } = await supabase.rpc('check_day_pass', { p_code: code });
  if (error) throw error;
  return (data ?? { state: 'not_found' }) as PassCheck;
}

/** Mark a pass honoured at the door. One-way, owner-only. */
export async function redeemDayPass(code: string): Promise<PassCheck> {
  const { data, error } = await supabase.rpc('redeem_day_pass', { p_code: code });
  if (error) throw error;
  return (data ?? { state: 'not_found' }) as PassCheck;
}

// ------------------------------------------------------------ check-in QR ----
/** The code members scan. Null = this gym has none yet (a failed read throws:
 *  saying «no code» about it would push the owner into replacing the printed one). */
export async function getCheckinCode(gymId: string): Promise<string | null> {
  const { data, error } = await supabase.from('gym_checkin_codes').select('code').eq('gym_id', gymId).maybeSingle();
  if (error) throw error;
  return (data as { code?: string } | null)?.code ?? null;
}

/** A new code; the old printed QR stops working that moment. */
export async function rotateCheckinCode(gymId: string): Promise<string> {
  const { data, error } = await supabase.rpc('gym_rotate_checkin_code', { p_gym_id: gymId });
  if (error || !data) throw error ?? new Error('no code');
  return String(data);
}

// ------------------------------------------------------------------- edit ----
export interface GymPatch {
  name?: string;
  district?: string;
  hours?: string;
  price_month?: number;
  day_pass?: number;
  amenities?: string[];
  about?: string;
  schedule?: ScheduleItem[];
  allow_day_pass?: boolean;
  show_members?: boolean;
}

/** RLS does not raise for a gym you do not own: the update matches nothing and
 *  returns no error. The returned row count is what says it was saved. */
export async function updateGym(gymId: string, patch: GymPatch): Promise<void> {
  const { data, error } = await supabase.from('gyms').update(patch).eq('id', gymId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('not-saved');
}

// ----------------------------------------------------------------- photos ----
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // the `gyms` bucket ceiling
const IMMUTABLE_CACHE = '31536000';

function objectPath(url: string): string | null {
  const marker = '/object/public/gyms/';
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split('?')[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function uploadPhoto(gymId: string, file: File): Promise<string> {
  if (file.size > PHOTO_MAX_BYTES) throw new Error('too-large');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const tail = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `g-${gymId}-${tail}.${ext}`;
  const { error } = await supabase.storage
    .from('gyms')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true, cacheControl: IMMUTABLE_CACHE });
  if (error) throw error;
  return supabase.storage.from('gyms').getPublicUrl(path).data.publicUrl;
}

async function removeObject(url: string | null | undefined) {
  const path = url ? objectPath(url) : null;
  if (!path) return;
  try {
    await supabase.storage.from('gyms').remove([path]);
  } catch {
    /* the row no longer points at it; a leftover file is not a failure to report */
  }
}

export async function setCover(gym: Gym, file: File): Promise<string> {
  const url = await uploadPhoto(gym.id, file);
  const { data, error } = await supabase.from('gyms').update({ image_url: url }).eq('id', gym.id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('not-saved');
  if (gym.imageUrl && gym.imageUrl !== url && !gym.photos.includes(gym.imageUrl)) await removeObject(gym.imageUrl);
  return url;
}

export async function addPhoto(gymId: string, file: File): Promise<string[]> {
  const url = await uploadPhoto(gymId, file);
  const { data, error: readErr } = await supabase.from('gyms').select('photos').eq('id', gymId).maybeSingle();
  if (readErr) throw readErr;
  const next = [...(((data as { photos?: string[] | null } | null)?.photos) ?? []), url];
  const { data: saved, error } = await supabase.from('gyms').update({ photos: next }).eq('id', gymId).select('id');
  if (error) throw error;
  if (!saved?.length) throw new Error('not-saved');
  return next;
}

export async function removePhoto(gymId: string, url: string): Promise<string[]> {
  const { data, error: readErr } = await supabase.from('gyms').select('photos,image_url').eq('id', gymId).maybeSingle();
  if (readErr) throw readErr;
  const row = (data ?? {}) as { photos?: string[] | null; image_url?: string | null };
  const next = (row.photos ?? []).filter((u) => u !== url);
  const { data: saved, error } = await supabase.from('gyms').update({ photos: next }).eq('id', gymId).select('id');
  if (error) throw error;
  if (!saved?.length) throw new Error('not-saved');
  // The file goes too (a photo removed because it caught a member's face must
  // stop being served), unless it is still the cover.
  if (row.image_url !== url) await removeObject(url);
  return next;
}

// ---------------------------------------------------------------- reviews ----
export interface Review {
  id: string;
  name: string;
  tenure: string;
  rating: number;
  text: string;
  reply: string | null;
  createdAt: string;
}

export async function getReviews(gymId: string): Promise<Review[]> {
  const { data, error } = await supabase.from('reviews').select('*').eq('gym_id', gymId).order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: (r.name as string) ?? 'Üzv',
    tenure: (r.tenure as string) ?? '',
    rating: Number(r.rating ?? 0),
    text: (r.body as string) ?? '',
    reply: (r.reply as string) ?? null,
    createdAt: (r.created_at as string) ?? '',
  }));
}

export async function replyToReview(reviewId: string, body: string): Promise<void> {
  const { data, error } = await supabase
    .from('reviews')
    .update({ reply: body, reply_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('not-saved');
}

// ------------------------------------------------------------------ claim ----
export interface Claim {
  id: string;
  voen: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  created_at: string;
}

export async function getMyClaim(gymId: string): Promise<Claim | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('gym_claims')
    .select('id,voen,status,reject_reason,created_at')
    .eq('gym_id', gymId)
    .eq('claimant_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Claim | null) ?? null;
}

/** File an ownership claim for the admin queue — once: a pending claim with a
 *  VÖEN already on it is not filed again. The gym's claim_status is set by the
 *  server's trigger, never from here. */
export async function submitClaim(gymId: string, voen: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error('no session');
  const { data: existing, error: readErr } = await supabase
    .from('gym_claims')
    .select('id,voen')
    .eq('gym_id', gymId)
    .eq('claimant_id', uid)
    .eq('status', 'pending');
  if (readErr) throw readErr;
  if (((existing ?? []) as { voen: string | null }[]).some((r) => !!r.voen)) return;
  const { error } = await supabase.from('gym_claims').insert({ gym_id: gymId, claimant_id: uid, voen: voen || null, status: 'pending' });
  if (error) throw error;
}

// ----------------------------------------------------------- announcement ---
/** Posted to the gym's community feed under the OWNER'S name (the server stamps
 *  the author from the profile) — there is no «post as the gym». */
export async function postAnnouncement(gym: Gym, owner: Owner, body: string): Promise<void> {
  const { data, error } = await supabase
    .from('community_posts')
    .insert({ author: gym.name, author_id: owner.profileId, gym: gym.name, time_ago: 'indi', type: 'text', body })
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('not-saved');
}

// ---------------------------------------------------------------- format ----
const MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];
export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso) + BAKU_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(Date.parse(iso) + BAKU_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
export function fmtAgo(iso: string | null): string {
  if (!iso) return 'heç vaxt';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'bu gün';
  if (days === 1) return 'dünən';
  return `${days} gün əvvəl`;
}
