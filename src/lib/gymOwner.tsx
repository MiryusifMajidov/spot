/**
 * Gym-owner data layer — everything the gym panel shows is REAL.
 *
 * A gym account is a Supabase-backed account: the gym row (`gyms.owner_id`) is
 * what makes someone an owner, so every screen under src/app/gym/** resolves its
 * gym through `useMyGym()`. If there is no connection or no owned gym we say so
 * honestly instead of falling back to a demo gym.
 *
 * Privacy red line: nothing here reads a member's workouts, weights, progress
 * photos or messages. A gym owner sees check-in frequency and membership only.
 *
 * Some columns come from supabase/schema7_gym_owner.sql (reviews.reply,
 * gyms.schedule / allow_day_pass / show_members). Every write that touches them
 * degrades honestly (real error) when the migration has not been applied yet.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { palette } from '@/theme';
import { getMyProfile } from './api';
import { showAccountSwitcher } from './accounts';
import { getUserId } from './api';
import { invalidateFocusCache } from './focusFetch';
import { getGymMembers, getMyGymId } from './roles';
import { hasSupabaseConfig, supabase } from './supabase';

export interface ScheduleItem {
  time: string;
  name: string;
  trainer: string;
}

export type ClaimStatus = 'unclaimed' | 'pending' | 'claimed';

export interface OwnedGym {
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
  schedule: ScheduleItem[];
  allowDayPass: boolean;
  showMembers: boolean;
}

function mapOwnedGym(r: Record<string, unknown>): OwnedGym {
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
    schedule: sched.filter((s) => s && typeof s.name === 'string'),
    allowDayPass: r.allow_day_pass == null ? true : Boolean(r.allow_day_pass),
    showMembers: r.show_members == null ? true : Boolean(r.show_members),
  };
}

/** The gym row owned by the current user, or null.
 *  Throws when the LOOKUP failed — "we could not ask" is not the same fact as
 *  "you own no gym", and the panel must never state the second for the first. */
export async function fetchMyGym(): Promise<OwnedGym | null> {
  const id = await getMyGymId();
  if (!id) return null;
  const { data, error } = await supabase.from('gyms').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapOwnedGym(data as Record<string, unknown>) : null;
}

export interface MyGymState {
  gym: OwnedGym | null;
  loading: boolean;
  /** No Supabase config — the gym account cannot be resolved at all. */
  offline: boolean;
  /** The lookup itself failed (network / auth / RLS). NOT "there is no gym". */
  error: boolean;
  reload: () => void;
}

/** Resolves the signed-in owner's gym, refreshed every time a gym screen focuses. */
export function useMyGym(): MyGymState {
  const [gym, setGym] = useState<OwnedGym | null>(null);
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig) {
        setLoading(false);
        return;
      }
      let alive = true;
      setLoading(true);
      fetchMyGym()
        .then((g) => {
          if (!alive) return;
          setGym(g);
          setError(false);
        })
        .catch((e) => {
          if (!alive) return;
          console.warn('[useMyGym]', e);
          // Keep whatever we already showed; just stop claiming there is no gym.
          setError(true);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
      return () => {
        alive = false;
      };
    }, [nonce])
  );

  return { gym, loading, offline: !hasSupabaseConfig, error, reload: () => setNonce((n) => n + 1) };
}

// ------------------------------------------------------------------ edit ----
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

const EXTRA_KEYS = ['schedule', 'allow_day_pass', 'show_members'] as const;

/**
 * Persist owner edits. Core columns always exist; the three schema7 columns are
 * written separately so a project that has not run the migration still saves
 * everything else — and the caller is told which half failed.
 */
export async function updateMyGym(gymId: string, patch: GymPatch): Promise<{ extrasSaved: boolean }> {
  const core: Record<string, unknown> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if ((EXTRA_KEYS as readonly string[]).includes(k)) extras[k] = v;
    else core[k] = v;
  }

  if (Object.keys(core).length) {
    const { error } = await supabase.from('gyms').update(core).eq('id', gymId);
    if (error) throw error;
    // The public catalogue caches gyms for a minute — without this the Kəşf card
    // keeps showing the old name/price the app no longer holds as true.
    invalidateFocusCache('gyms');
  }
  if (!Object.keys(extras).length) return { extrasSaved: true };

  const { error } = await supabase.from('gyms').update(extras).eq('id', gymId);
  if (!error) invalidateFocusCache('gyms');
  return { extrasSaved: !error };
}

// ----------------------------------------------------------------- claim ----
export interface GymClaimRow {
  id: string;
  gym_id: string;
  voen: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  sla_due_at: string | null;
  created_at: string;
}

/** My ownership claim for this gym (the row the admin panel reviews).
 *  Throws when the READ failed — «müraciət göndərməmisən» is a fact we may only
 *  state after actually reading the table. Saying it about a failed read sends an
 *  owner who already applied back into the VÖEN form, and files a second claim. */
export async function getMyGymClaim(gymId: string): Promise<GymClaimRow | null> {
  const uid = await getUserId();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('gym_claims')
    .select('*')
    .eq('gym_id', gymId)
    .eq('claimant_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as GymClaimRow | null) ?? null;
}

/**
 * Submit an ownership claim. This MUST reach the admin panel — the caller shows a
 * real error when it throws, never a fake "we received it".
 */
export async function submitGymClaim(input: { gymId: string; voen: string }): Promise<void> {
  const uid = await getUserId();
  if (!uid) throw new Error('no session');
  // A claimant cannot UPDATE gym_claims (the policy is admin-only), so a pending
  // row that already carries a VÖEN can neither be edited nor replaced from here.
  // The one thing we can do is refuse to file a SECOND claim for the same gym —
  // there is no unique (gym_id, claimant_id) constraint to stop us otherwise, and
  // the admin queue would hold two claims for one gym.
  const { data: existing, error: readErr } = await supabase
    .from('gym_claims')
    .select('id,voen')
    .eq('gym_id', input.gymId)
    .eq('claimant_id', uid)
    .eq('status', 'pending');
  if (readErr) throw readErr;
  // ANY pending row that already carries a VÖEN means the application is filed.
  const alreadyFiled = ((existing ?? []) as { id: string; voen: string | null }[]).some((r) => !!r.voen);
  if (!alreadyFiled) {
    const { error } = await supabase
      .from('gym_claims')
      .insert({ gym_id: input.gymId, claimant_id: uid, voen: input.voen || null, status: 'pending' });
    if (error) throw error;
  }
  // `claim_status` is not written from here any more. It is set by the
  // `gym_claims_touch_gym` trigger (schema27) when the claim row above lands, so
  // the gym's status can never say «pending» without a claim actually existing —
  // and a client cannot mark itself «claimed» at all.
}

// --------------------------------------------------------------- reviews ----
export interface GymReviewRow {
  id: string;
  name: string;
  tenure: string;
  rating: number;
  text: string;
  reply: string | null;
  createdAt: string;
}

/** The gym's real reviews. Empty array means empty — never a demo review. */
export async function getGymReviews(gymId: string): Promise<GymReviewRow[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('gym_id', gymId)
    .order('created_at', { ascending: false });
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

/** Write the gym's official reply. Requires schema7_gym_owner.sql. */
export async function replyToReview(reviewId: string, body: string): Promise<void> {
  // RLS limits this to the gym's owner and returns `error: null` with zero rows
  // to everybody else — so without the returned row an owner-looking screen said
  // «Cavab göndərildi» about a reply the reviewer would never see.
  const { data, error } = await supabase
    .from('reviews')
    .update({ reply: body, reply_at: new Date().toISOString() })
    .eq('id', reviewId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('reply-not-saved');
}

// --------------------------------------------------------------- members ----
export interface RosterMember {
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

/**
 * The gym's roster: profiles whose home gym this is, plus their check-in
 * frequency — nothing else. `getGymMembers()` (roles.ts) supplies the counts;
 * this adds the privacy flag, join date and who is inside right now, which the
 * owner panel needs and roles.ts does not return.
 */
export async function getGymRoster(gymId: string): Promise<RosterMember[]> {
  const base = await getGymMembers(gymId);
  if (!base.length) return [];

  const ids = base.map((m) => m.profileId);
  const nowIso = new Date().toISOString();
  const [{ data: profs, error: pErr }, { data: active, error: aErr }] = await Promise.all([
    supabase.from('profiles').select('id,show_in_gym_list,created_at').in('id', ids),
    supabase.from('check_ins').select('profile_id').eq('gym_id', gymId).gt('expires_at', nowIso),
  ]);
  // A failed privacy/presence read would draw the whole roster as «Anonim üzv»
  // with nobody in the gym — invented facts. The caller shows «yüklənmədi».
  if (pErr) throw pErr;
  if (aErr) throw aErr;

  type P = { id: string; show_in_gym_list: boolean | null; created_at: string | null };
  const meta = new Map(((profs ?? []) as P[]).map((p) => [p.id, p]));
  const here = new Set(((active ?? []) as { profile_id: string }[]).map((r) => r.profile_id));

  return base.map((m) => {
    const p = meta.get(m.profileId);
    const anonymous = p?.show_in_gym_list === false;
    return {
      profileId: m.profileId,
      name: anonymous ? 'Anonim üzv' : m.name,
      anonymous,
      level: anonymous ? null : m.level,
      goals: anonymous ? [] : m.goals,
      checkIns30d: m.checkIns30d,
      lastCheckIn: m.lastCheckIn,
      hereNow: here.has(m.profileId),
      joinedAt: p?.created_at ?? null,
    };
  });
}

// -------------------------------------------------------------- check-in ----
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1

/** Stable, human-readable check-in code for a gym (shown at the front desk). */
export function gymShortCode(gymId: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < gymId.length; i++) {
    h1 = (h1 ^ gymId.charCodeAt(i)) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + gymId.charCodeAt(i) * (i + 7)) >>> 0;
  }
  let out = '';
  let n = h1;
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length);
  }
  out += '-';
  n = h2;
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length);
  }
  return out;
}

// ----------------------------------------------------------- announcement ---
/** Post an announcement from the gym into the community feed (a real channel). */
export async function postGymAnnouncement(gymName: string, body: string): Promise<void> {
  // The announcement is LABELLED with the gym's name but AUTHORED by the owner's
  // profile. Without `author_id` the row was unattributable, and schema29's
  // policy — which is what stops anyone posting «Iron Bay: zalımız bağlanır» —
  // refuses it outright. It also makes the post reportable, hideable and
  // recognisable as the owner's own.
  const me = await getMyProfile();
  if (!me?.id) throw new Error('no profile');
  const { data, error } = await supabase
    .from('community_posts')
    .insert({
      author: gymName,
      author_id: me.id,
      gym: gymName,
      type: 'text',
      body,
      likes: 0,
      comments: 0,
    })
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('announcement-not-posted');
  // «Elan icmaya göndərildi» must be true the moment the owner opens the feed.
  invalidateFocusCache('community_posts');
}

// -------------------------------------------------------------- gate UI ----
/**
 * Honest state for every gym screen when there is no gym to show. A gym account
 * lives on the server (gyms.owner_id), so without a connection or without a gym
 * row we say exactly that instead of rendering a demo gym.
 */
export function GymGate({ state }: { state: MyGymState }) {
  const router = useRouter();
  // The failed-lookup state is deliberately separate from the empty state: saying
  // «zal yoxdur» about a gym we simply could not read is a lie, and its only button
  // used to register a SECOND gym and brick the panel for good.
  const failed = state.error && !state.loading;
  const empty = !state.offline && !state.loading && !state.error;

  const title = state.offline
    ? 'Bağlantı yoxdur'
    : state.loading
      ? 'Yüklənir…'
      : failed
        ? 'Zalın məlumatları gətirilə bilmədi'
        : 'Zal tapılmadı';
  const body = state.offline
    ? 'Zal hesabı serverdə saxlanılır. İnternet bağlantısı olmadan zalın məlumatlarını göstərə bilmirik — uydurma rəqəm göstərməkdənsə boş qalmağı seçirik.'
    : state.loading
      ? 'Zalın məlumatları gətirilir.'
      : failed
        ? 'Serverə sorğu alınmadı, ona görə bu hesabda zal olub-olmadığını deyə bilmirik. Bağlantını yoxlayıb yenidən cəhd et — zalın silinməyib.'
        : 'Bu hesaba bağlı zal yoxdur. Zalını qeydiyyata alsan panel dərhal onun real məlumatlarını göstərəcək.';

  return (
    <View style={gateStyles.wrap}>
      <View style={gateStyles.disc}>
        <Icon name="dumbbell" size={26} color={palette.tertiary} />
      </View>
      <AppText variant="headline" center style={{ marginTop: 16 }}>
        {title}
      </AppText>
      <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, lineHeight: 21 }}>
        {body}
      </AppText>
      {failed ? (
        <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
          <Button title="Yenidən cəhd et" variant="primary" full onPress={state.reload} />
        </View>
      ) : null}
      {empty ? (
        <View style={{ marginTop: 20, alignSelf: 'stretch' }}>
          <Button title="Zalı qeydiyyata al" variant="primary" full onPress={() => router.push('/(tabs)/profile/create-gym')} />
        </View>
      ) : null}
      {/* The gate carries no NavBar, so without this the four gym tabs are a dead end. */}
      <View style={{ marginTop: 10, alignSelf: 'stretch' }}>
        <Button title="Şəxsi hesaba qayıt" variant="secondary" full onPress={() => showAccountSwitcher(router)} />
      </View>
    </View>
  );
}

const gateStyles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  disc: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
});

/**
 * Small, reusable "nothing here yet, here is what to do" block — the honest
 * replacement for a fabricated number. `inset` when it sits inside a white card.
 */
export function EmptyNote({ title, body, inset }: { title: string; body: string; inset?: boolean }) {
  return (
    <View style={[emptyStyles.wrap, inset && emptyStyles.inset]}>
      <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{title}</AppText>
      <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 6 }}>{body}</AppText>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: { backgroundColor: palette.white, borderRadius: 16, padding: 16 },
  inset: { backgroundColor: palette.grouped, padding: 14 },
});

/** "3 gün", "Dünən", "indi" — days since an ISO date, for last-check-in labels. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
