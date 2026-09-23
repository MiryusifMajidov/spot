// Every app action a virtual actor performs — the SAME requests the app sends.
//
// FIDELITY RULE: each call below mirrors one call in the app: same table, same
// columns, same filters, same RPC name and argument names, same `.select('id')`
// row-count proof. The `// app: <file>:<line>` comment above a call points at
// the app line it copies; `node scripts/sim/run.mjs --dry` checks every anchor
// still names a line that makes the same call. Where one app action makes
// several calls, they are made here in the same order.
//
// Every exported action returns { ok, rows, error, ...extra } and never throws
// on an expected refusal (RLS, unique index, a server rule): whether a refusal
// is correct or a bug is the scenario's decision, not the action's.
//
// Functions whose names start with `probe`, `inventory` or `public` are NOT app
// calls. They are the adversarial reads/writes a person holding the same public
// key could send (privacy phase) and the harness's own bookkeeping (cleanup
// inventory). They are labelled as such and exempt from the anchor rule.

import { createClient } from '@supabase/supabase-js';

import { errInfo, fail, ok } from './lib.mjs';

// The app's «Hesabı sil» path lives in lib.mjs so cleanup can run from the
// SIGINT handler without importing the scenario; it is re-exported here so the
// scenario reads like the app.
export { cleanup as deleteMyAccount } from './lib.mjs';

// ------------------------------------------------------------- mirrors ----

// mirrors: src/lib/api.ts:39-40
const PROFILE_COLS =
  'id,user_id,name,username,gender,age,home_gym_id,level,goals,types,time_slot,bio,visibility,show_in_gym_list,role,specialty,price_from,avatar_url,created_at,status,status_until';

// mirrors: src/lib/authorName.ts:15
const PLACEHOLDER_NAMES = ['sən', 'sen', 'istifadəçi', 'istifadeci', 'müəllim', 'muellim'];
const isPlaceholderName = (n) => !String(n ?? '').trim() || PLACEHOLDER_NAMES.includes(String(n).trim().toLowerCase());

// mirrors: src/lib/api.ts:251-257
export function isUsernameConflict(e) {
  if (!e) return false;
  if (e.code === '23505') return true;
  const msg = String(e.message ?? '').toLowerCase();
  return msg.includes('username') && (msg.includes('duplicate key') || msg.includes('unique'));
}

// mirrors: src/store/appStore.ts:147-159
function isUnreachable(e) {
  const msg = String(e?.message ?? '').toLowerCase();
  return (
    msg.includes('no session') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    e?.name === 'AuthRetryableFetchError'
  );
}

// mirrors: src/store/appStore.ts:109-129
function toDbPatch(p) {
  const username = p.username?.trim();
  return {
    name: p.name,
    ...(username ? { username } : {}),
    gender: p.gender || null,
    age: p.age,
    home_gym_id: p.homeGymId,
    ...(p.level ? { level: p.level } : {}),
    goals: p.goals,
    types: p.types,
    ...(p.timeSlot ? { time_slot: p.timeSlot } : {}),
    bio: p.bio,
  };
}

// mirrors: src/lib/ids.ts:20-31
export function newId() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

// mirrors: src/app/(tabs)/checkin.tsx:45-53
function checkinRefusal(raw) {
  const m = String(raw ?? '').toLowerCase();
  if (m.includes('checkin_bad_code')) return 'checkin_bad_code';
  if (m.includes('checkin_already_today')) return 'checkin_already_today';
  if (m.includes('checkin_closed')) return 'checkin_closed';
  if (m.includes('checkin_sanctioned')) return 'checkin_sanctioned';
  if (m.includes('checkin_not_signed_in')) return 'checkin_not_signed_in';
  return 'unknown';
}

// mirrors: src/lib/ids.ts uniqueTail — the app's client-minted text ids.
function uniqueTail() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// mirrors: src/lib/chat.ts refusalOf
function chatRefusal(message) {
  const m = String(message ?? '').toLowerCase();
  if (m.includes('no_relationship')) return 'no_relationship';
  if (m.includes('blocked')) return 'blocked';
  if (m.includes('wait_for_reply')) return 'wait_for_reply';
  // mirrors: named by the server since schema83
  if (m.includes('sanctioned')) return 'sanctioned';
  if (m.includes('not_signed_in')) return 'not_signed_in';
  // The app says «sanction» only when the store holds one; a virtual actor never does.
  if (m.includes('row-level security')) return 'blocked';
  return 'unknown';
}

/** What the chat screen tells the person for a refusal code — so a report says
 *  what they SEE, not an internal code. */
// mirrors: src/lib/chat.ts:70-83
export function chatRefusalText(code) {
  switch (code) {
    case 'no_relationship':
      return 'Söhbət yalnız təklif qəbul ediləndən sonra açılır.';
    case 'blocked':
      return 'Bu adamla yazışmaq mümkün deyil.';
    case 'wait_for_reply':
      return 'Bir mesaj göndərdin — cavab gələnə qədər ikincisini göndərmək olmur.';
    case 'sanctioned':
      return 'Hesabına məhdudiyyət qoyulub — mesaj göndərə bilmirsən.';
    case 'not_signed_in':
      return 'Profil tapılmadı — mesaj göndərmək üçün profilini tamamla.';
    default:
      return 'Mesaj göndərilmədi.';
  }
}

// mirrors: src/lib/saveProgram.ts:371-376
function dayProblem(raw) {
  const m = String(raw ?? '').toLowerCase();
  return /program_item_(bad_video|unnamed|name_long|reps_long|sets_range)|program_(days_shape|too_many_days|too_many_items)/.test(m);
}

// ------------------------------------------------- session + identity ----
// Internal helpers throw exactly where the app's helpers throw; the exported
// actions catch and turn that into { ok: false }.

async function getUserId(a) {
  // app: src/lib/api.ts:129
  const { data, error } = await a.client.auth.getUser();
  if (error && error.name !== 'AuthSessionMissingError') throw error;
  return data?.user?.id ?? null;
}

async function readMyProfile(a) {
  const uid = await getUserId(a);
  if (!uid) return null;
  // app: src/lib/api.ts:167
  const { data, error } = await a.client.from('profiles').select(PROFILE_COLS).eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (data?.id) a.profileId = data.id;
  return data ?? null;
}

async function ensureSessionInner(a) {
  // app: src/lib/api.ts:115
  const { data, error } = await a.client.auth.getSession();
  if (error) throw error;
  if (data.session) {
    a.userId = data.session.user.id;
    return { created: false };
  }
  // hasStoredSession() (api.ts:88) is false here: this actor's auth storage is a
  // brand-new in-memory object, which is exactly a phone's very first launch.
  // app: src/lib/api.ts:123
  const { data: anon, error: signInError } = await a.client.auth.signInAnonymously();
  if (signInError) throw signInError;
  a.userId = anon.session?.user?.id ?? anon.user?.id ?? null;
  a.log('session', { userId: a.userId });
  return { created: true };
}

async function readMyGymId(a) {
  // app: src/lib/roles.ts:376
  const me = await readMyProfile(a);
  if (!me) return null;
  // app: src/lib/roles.ts:378-384
  const { data, error } = await a.client
    .from('gyms')
    .select('id')
    .eq('owner_id', me.id)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** First launch: bootstrap() in the store. The fire-and-forget syncs it also
 *  starts (training history, exercise videos, social, match requests) are not
 *  mirrored — a fresh account has nothing for them to move, and they touch no
 *  table this scenario measures. */
export async function bootstrap(a) {
  try {
    // app: src/store/appStore.ts:301
    const s = await ensureSessionInner(a);
    // app: src/lib/api.ts:160
    const touch = a.client.rpc('touch_last_active').then(
      () => null,
      () => null
    );
    // app: src/store/appStore.ts:328
    const profile = await readMyProfile(a);
    // app: src/store/appStore.ts:432
    const gymId = await readMyGymId(a);
    await touch;
    return ok(null, { created: s.created, triggerProfileName: profile?.name ?? null, gymId });
  } catch (e) {
    return fail(e);
  }
}

export async function getMyProfile(a) {
  try {
    // app: src/lib/api.ts:164
    const p = await readMyProfile(a);
    return ok(p ? [p] : [], { profile: p });
  } catch (e) {
    return fail(e);
  }
}

async function isUsernameTaken(a, username) {
  const v = username.trim();
  if (!v) return false;
  // app: src/lib/api.ts:244
  const { data, error } = await a.client.rpc('username_taken', { p_username: v });
  if (error) throw error;
  return data === true;
}

export async function usernameTaken(a, username) {
  try {
    // app: src/lib/api.ts:241
    return ok(null, { taken: await isUsernameTaken(a, username) });
  } catch (e) {
    return fail(e);
  }
}

async function updateMyProfile(a, patch) {
  const uid = await getUserId(a);
  if (!uid) throw new Error('no session');
  // app: src/lib/api.ts:270-274
  const { data, error } = await a.client
    .from('profiles')
    .upsert({ user_id: uid, ...patch }, { onConflict: 'user_id' })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

function pushProfile(a) {
  // app: src/store/appStore.ts:169-173
  return updateMyProfile(a, {
    ...toDbPatch(a.store.profile),
    visibility: a.store.visibility,
    show_in_gym_list: a.store.showInGymList,
  });
}

/** The store's saveProfile(): 'saved' | 'local' | 'failed', plus why. */
async function saveProfile(a) {
  a.store.lastSaveError = null;
  if (!a.store.profile.name.trim()) return { result: 'local' };
  try {
    // app: src/store/appStore.ts:456
    const id = await pushProfile(a);
    if (id) a.profileId = id;
    return { result: 'saved', id };
  } catch (e) {
    if (isUsernameConflict(e)) {
      a.store.lastSaveError = 'username-taken';
      return { result: 'failed', error: e, conflict: true };
    }
    if (isUnreachable(e)) return { result: 'local', error: e };
    return { result: 'failed', error: e };
  }
}

/** Registration: the last onboarding screen (name, @ad, age → «Davam et»). */
export async function register(a, { name, username, age }) {
  try {
    // app: src/app/onboarding/profile.tsx:69
    a.store.profile = { ...a.store.profile, name, username, age };
    let taken = false;
    let checkError = null;
    try {
      // app: src/app/onboarding/profile.tsx:72
      taken = await isUsernameTaken(a, username);
    } catch (e) {
      // The screen says «could not check» and saves anyway; the unique index decides.
      checkError = errInfo(e);
    }
    if (taken) return fail(new Error('username_taken (precheck)'), { taken: true, conflict: false, path: 'precheck' });
    // app: src/app/onboarding/profile.tsx:91
    const saved = await saveProfile(a);
    if (saved.result !== 'saved') {
      return fail(saved.error ?? new Error(`save ${saved.result}`), {
        result: saved.result,
        taken: false,
        conflict: !!saved.conflict,
        path: saved.conflict ? 'unique-index' : 'other',
        checkError,
      });
    }
    return ok(null, { result: 'saved', profileId: saved.id, checkError });
  } catch (e) {
    return fail(e);
  }
}

/** Profil → Redaktə, changing only the @ad, then «Yadda saxla». */
export async function changeUsername(a, handle) {
  try {
    let taken = false;
    let checkError = null;
    try {
      // app: src/app/(tabs)/profile/edit.tsx:235
      taken = await isUsernameTaken(a, handle);
    } catch (e) {
      checkError = errInfo(e);
    }
    if (taken) return fail(new Error('username_taken (precheck)'), { taken: true, conflict: false, path: 'precheck' });
    const previous = a.store.profile.username;
    // app: src/app/(tabs)/profile/edit.tsx:246-247
    a.store.profile = { ...a.store.profile, username: handle.trim() };
    const saved = await saveProfile(a);
    if (saved.result === 'failed') {
      // The phone puts the old handle back, like the screen does.
      // app: src/app/(tabs)/profile/edit.tsx:253
      a.store.profile = { ...a.store.profile, username: previous };
      const conflict = a.store.lastSaveError === 'username-taken';
      return fail(saved.error, { taken: false, conflict, path: conflict ? 'unique-index' : 'other', checkError });
    }
    return ok(null, { result: saved.result, profileId: saved.id ?? null, checkError });
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------- trainer ----

async function publishTrainer(a, input) {
  if (isPlaceholderName(input.name)) throw new Error('no-name');
  // app: src/app/(tabs)/profile/become-trainer.tsx:43
  const me = await readMyProfile(a);
  if (!me?.id) throw new Error('no profile');
  const becoming = me.role !== 'trainer';

  // app: src/app/(tabs)/profile/become-trainer.tsx:55-59
  const { data: pRow, error: pErr } = await a.client
    .from('profiles')
    .update({ role: 'trainer', specialty: input.specialty, price_from: input.priceFrom })
    .eq('id', me.id)
    .select('id');
  if (pErr) throw pErr;
  if (!pRow?.length) throw new Error('profile-not-saved');

  // app: src/app/(tabs)/profile/become-trainer.tsx:66
  const { data: existingT, error: exErr } = await a.client.from('trainers').select('id').eq('id', me.id).maybeSingle();
  if (exErr) throw exErr;

  let listedLanded = null;
  if (existingT) {
    // app: src/app/(tabs)/profile/become-trainer.tsx:70-84
    const { data: tRow, error: tErr } = await a.client
      .from('trainers')
      .update({
        name: input.name,
        gym_id: input.homeGymId,
        specialty: input.specialty,
        price_from: input.priceFrom,
        bio: input.bio,
        ...(becoming ? { listed: true } : {}),
      })
      .eq('id', me.id)
      .select('id');
    if (tErr) throw tErr;
    if (!tRow?.length) throw new Error('listing-not-saved');
  } else {
    // app: src/app/(tabs)/profile/become-trainer.tsx:93-101
    const { error: tErr } = await a.client.from('trainers').insert({
      id: me.id,
      name: input.name,
      gym_id: input.homeGymId,
      specialty: input.specialty,
      price_from: input.priceFrom,
      bio: input.bio,
      owner_id: me.id,
    });
    if (tErr) throw tErr;
    // The app does not throw when this fails — it only warns — so neither do we;
    // the scenario checks the flag that landed.
    // app: src/app/(tabs)/profile/become-trainer.tsx:109
    const { data: shown, error: lErr } = await a.client.from('trainers').update({ listed: true }).eq('id', me.id).select('id');
    listedLanded = !lErr && !!shown?.length;
  }

  // app: src/app/(tabs)/profile/become-trainer.tsx:115-120
  const { data: existing, error: exVErr } = await a.client
    .from('trainer_verifications')
    .select('id')
    .eq('user_id', me.user_id)
    .limit(1)
    .maybeSingle();
  if (exVErr) throw exVErr;
  let verificationQueued = false;
  if (!existing) {
    // app: src/app/(tabs)/profile/become-trainer.tsx:123-125
    const { error: vErr } = await a.client
      .from('trainer_verifications')
      .insert({ trainer_id: me.id, user_id: me.user_id, status: 'pending', gym_confirm: false });
    if (vErr) throw vErr;
    verificationQueued = true;
  }
  return { trainerId: me.id, becoming, listedLanded, verificationQueued };
}

/** «Müəllim profilini yarat» on become-trainer.tsx. */
export async function becomeTrainer(a, { specialty, bio, priceFrom }) {
  try {
    const payload = {
      specialty: specialty.trim(),
      bio: bio.trim(),
      priceFrom: Number(priceFrom) || 0,
      name: a.store.profile.name.trim(),
      homeGymId: a.store.profile.homeGymId,
    };
    // Local-first: the phone flips to trainer before the server answers.
    // app: src/app/(tabs)/profile/become-trainer.tsx:318
    a.store.profile = { ...a.store.profile, role: 'trainer', specialty: payload.specialty, priceFrom: payload.priceFrom, bio: payload.bio };
    // app: src/app/(tabs)/profile/become-trainer.tsx:327
    const r = await publishTrainer(a, payload);
    a.trainerId = r.trainerId;
    return ok(null, r);
  } catch (e) {
    return fail(e);
  }
}

async function readMyTrainerId(a) {
  // app: src/lib/roles.ts:59
  const me = await readMyProfile(a);
  if (!me) return null;
  // app: src/lib/roles.ts:69-73
  const { data, error } = await a.client
    .from('trainers')
    .select('id')
    .eq('owner_id', me.id)
    .order('id', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  if (!rows.length) return null;
  return rows.find((r) => r.id === me.id)?.id ?? rows[0].id;
}

/** The trainer panel's «Kəşfdə görün» state. */
export async function getMyListing(a) {
  try {
    // app: src/lib/roles.ts:103
    const me = await readMyProfile(a);
    if (!me?.id) return ok([], { listing: null });
    // app: src/lib/roles.ts:105-109
    const { data, error } = await a.client
      .from('trainers')
      .select('id,listed')
      .eq('id', me.id)
      .maybeSingle();
    if (error) return fail(error);
    return ok(data ? [data] : [], { listing: data ? { id: data.id, listed: !!data.listed } : null });
  } catch (e) {
    return fail(e);
  }
}

/**
 * The trainer panel's «Kəşfdə görün» switch turned off (setMyListed(false)).
 *
 * The harness calls it right after the listing is published: a TEST coach that
 * stays in Kəşf could be found by a real person, and whatever they send it
 * (a request, a chat) would be cascade-deleted with the TEST account. Nothing
 * later needs the listing public — trainers_read is `true`, requests check only
 * owner_id, and the t1–u1 chat runs on the accepted relationship.
 */
export async function unlistMe(a) {
  try {
    // app: src/lib/roles.ts:116
    const me = await readMyProfile(a);
    if (!me?.id) return fail(new Error('no-profile'));
    // app: src/lib/roles.ts:120-124
    const { data, error } = await a.client
      .from('trainers')
      .update({ listed: false })
      .eq('id', me.id)
      .select('listed');
    if (error) return fail(error);
    if (!data?.length) return fail(new Error('not-updated'));
    return ok(data, { listed: !!data[0].listed });
  } catch (e) {
    return fail(e);
  }
}

/** A trainer's public page (Kəşf → Müəllimlər → one coach), i.e. useTrainer(). */
export async function openTrainerPage(a, trainerId) {
  try {
    // app: src/lib/hooks.ts:234
    const { data, error } = await a.client.from('trainers').select('*').eq('id', trainerId).maybeSingle();
    if (error) return fail(error);
    return ok(data ? [data] : [], { trainer: data ?? null });
  } catch (e) {
    return fail(e);
  }
}

async function readMyRequestTo(a, trainerId) {
  // app: src/lib/roles.ts:155
  const me = await readMyProfile(a);
  if (!me) return null;
  // app: src/lib/roles.ts:157-162
  const { data, error } = await a.client
    .from('trainer_requests')
    .select('*')
    .eq('trainer_id', trainerId)
    .eq('from_profile', me.id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getMyRequestTo(a, trainerId) {
  try {
    // app: src/app/(tabs)/discover/reserve/[id].tsx:82
    const r = await readMyRequestTo(a, trainerId);
    return ok(r ? [r] : [], { request: r });
  } catch (e) {
    return fail(e);
  }
}

/** Opening «Müəllimlə məşq» (reserve/[id].tsx): the trainer row, then my request. */
export async function openReserveScreen(a, trainerId) {
  try {
    // app: src/lib/hooks.ts:234
    const { data: trainer, error } = await a.client.from('trainers').select('*').eq('id', trainerId).maybeSingle();
    if (error) return fail(error);
    // app: src/app/(tabs)/discover/reserve/[id].tsx:82
    const request = await readMyRequestTo(a, trainerId);
    return ok(null, { trainerFound: !!trainer, request });
  } catch (e) {
    return fail(e);
  }
}

/** «Sorğu göndər» on the reserve screen. */
export async function requestTrainer(a, trainerId, note, preferredTime) {
  try {
    // app: src/lib/roles.ts:132
    const me = await readMyProfile(a);
    if (!me) return fail(new Error('no profile'));
    // app: src/lib/roles.ts:134-138
    const { data: t, error: tErr } = await a.client
      .from('trainers')
      .select('owner_id')
      .eq('id', trainerId)
      .maybeSingle();
    if (tErr) return fail(tErr);
    if (!t?.owner_id) return fail(new Error('trainer-inactive'));
    // app: src/lib/roles.ts:141-147
    const { data, error } = await a.client
      .from('trainer_requests')
      .upsert(
        { trainer_id: trainerId, from_profile: me.id, note, preferred_time: preferredTime, status: 'pending' },
        { onConflict: 'trainer_id,from_profile' }
      )
      .select('id');
    if (error) return fail(error);
    if (!data?.length) return fail(new Error('request-not-sent'));
    // The screen re-reads the row to draw its state (a failure there is swallowed).
    // app: src/app/(tabs)/discover/reserve/[id].tsx:137
    const fresh = await readMyRequestTo(a, trainerId).catch(() => null);
    return ok(data, { requestId: data[0].id, fresh });
  } catch (e) {
    return fail(e);
  }
}

/**
 * The trainer's «Şagirdlər» list.
 *
 * HARD RULE: `simIds` is the set of this run's virtual profile ids. A request
 * from anyone else is a real person who happened to find a TEST listing: it is
 * counted, and never read any further (the app would read their profile here),
 * never decided on and never logged.
 */
export async function getMyStudents(a, simIds) {
  try {
    // app: src/lib/roles.ts:174
    const trainerId = await readMyTrainerId(a);
    if (!trainerId) return ok([], { pending: [], active: [], noListing: true, foreign: 0, trainerId: null });

    // app: src/lib/roles.ts:177-182
    const { data: reqs, error: reqErr } = await a.client
      .from('trainer_requests')
      .select('*')
      .eq('trainer_id', trainerId)
      .in('status', ['pending', 'accepted'])
      .order('created_at', { ascending: false });
    if (reqErr) return fail(reqErr);
    const all = reqs ?? [];
    const rows = simIds ? all.filter((r) => simIds.has(r.from_profile)) : all;
    const foreign = all.length - rows.length;
    if (!rows.length) return ok([], { pending: [], active: [], noListing: false, foreign, trainerId });

    const ids = rows.map((r) => r.from_profile);
    // app: src/lib/roles.ts:189-192
    const [{ data: profs, error: pErr }, { data: progs, error: progErr }] = await Promise.all([
      a.client.from('profiles').select('id,name,age,level,goals,home_gym_id').in('id', ids),
      a.client.from('student_programs').select('student_id,title,note,program_id').eq('trainer_id', trainerId).in('student_id', ids),
    ]);
    if (pErr) return fail(pErr);
    if (progErr) return fail(progErr);

    const pMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const progMap = new Map((progs ?? []).map((p) => [p.student_id, p]));
    // mirrors: src/lib/roles.ts:203-223
    const map = (r) => {
      const p = pMap.get(r.from_profile);
      const prog = progMap.get(r.from_profile);
      return {
        requestId: r.id,
        profileId: r.from_profile,
        name: p?.name ?? 'İstifadəçi',
        status: r.status,
        requestedAt: r.created_at,
        acceptedAt: r.status === 'accepted' ? (r.decided_at ?? null) : null,
        programTitle: prog?.title ?? null,
        programId: prog?.program_id ?? null,
        programNote: prog?.note ?? null,
      };
    };
    return ok(rows, {
      pending: rows.filter((r) => r.status === 'pending').map(map),
      active: rows.filter((r) => r.status === 'accepted').map(map),
      noListing: false,
      foreign,
      trainerId,
    });
  } catch (e) {
    return fail(e);
  }
}

/** «Qəbul et» / «Rədd et» on a pending request. */
export async function decideTrainerRequest(a, requestId, accept) {
  try {
    // app: src/lib/roles.ts:241-245
    const { data, error } = await a.client
      .from('trainer_requests')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', requestId)
      .select('id');
    if (error) return fail(error);
    if (!data?.length) return fail(new Error('request-not-updated'));
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

/** «Şagirdlikdən çıxar» on trainer/student/[id].tsx. */
export async function endStudent(a, requestId) {
  try {
    // app: src/lib/roles.ts:273-278
    const { data, error } = await a.client
      .from('trainer_requests')
      .update({ status: 'ended' })
      .eq('id', requestId)
      .eq('status', 'accepted')
      .select('id');
    if (error) return fail(error);
    if (!data?.length) return fail(new Error('student-not-ended'));
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- programs ----

// mirrors: src/store/programDraft.ts:58-62
function itemReps(it) {
  const v = String(it.value ?? '').trim();
  if (!v) return '';
  return it.mode === 'time' ? (/san/i.test(v) ? v : `${v} san`) : v;
}

// mirrors: src/store/programDraft.ts:217-240
function draftDaysForSave(days) {
  return days
    .filter((d) => d.items.length > 0)
    .map((d) => ({
      title: d.title.trim() || 'Gün',
      focus:
        d.focus.trim() ||
        d.items
          .map((it) => it.muscle)
          .filter((m, i, arr) => !!m && arr.indexOf(m) === i)
          .join(', '),
      items: d.items.map((it) => ({
        name: it.name.trim(),
        exercise_id: it.exerciseId,
        sets: it.sets,
        reps: itemReps(it),
        video_url: it.videoUrl,
      })),
      exercise_ids: d.items.map((it) => it.exerciseId).filter((x) => !!x),
    }));
}

// mirrors: src/lib/duration.ts:30-42
function estimateDuration(exercises) {
  if (!exercises.length) return 0;
  const perSet = (e) => (/san/i.test(e.reps ?? '') ? 1.2 : e.equipment === 'Bədən' ? 1.2 : e.isCompound ? 2.8 : 2.2);
  const min = exercises.reduce((acc, e) => acc + Math.max(1, e.sets) * perSet(e), 0);
  return Math.max(10, Math.round(min + 5));
}

// mirrors: src/lib/saveProgram.ts:45-49
function estimateMinutes(days) {
  const day = days.find((d) => d.items.length > 0);
  if (!day) return 0;
  return estimateDuration(day.items.map((it) => ({ sets: it.sets, reps: itemReps(it) })));
}

/** «Proqram yarat» → «Yadda saxla» (workout/create.tsx → saveProgramDraft, create path). */
export async function createProgram(a, { title, desc, days }) {
  try {
    // app: src/app/(tabs)/workout/create.tsx:161-167
    const creatorName = a.store.profile.name || 'Sən';
    const creatorType = a.store.profile.role === 'trainer' ? 'trainer' : 'user';
    // toLocalProgram() — only the fields `base` reads.
    // mirrors: src/lib/saveProgram.ts:52-98
    const built = draftDaysForSave(days);
    const allItems = days.flatMap((d) => d.items);
    const program = {
      desc: desc.trim(),
      title: title.trim(),
      weeks: 0,
      daysPerWeek: built.length,
      level: '',
      goal: '',
      minutes: estimateMinutes(days),
      videoCount: allItems.filter((it) => !!it.videoUrl).length,
      tags: [],
    };
    // The device store mints the id (useDb.createProgram).
    // mirrors: src/store/db.ts:396
    const id = `mine-${uniqueTail()}`;
    // mirrors: src/lib/saveProgram.ts:136-156
    const base = {
      title: program.title,
      weeks: program.weeks,
      days_per_week: program.daysPerWeek,
      level: program.level || null,
      goal: program.goal || null,
      paid: false,
      minutes: program.minutes,
      video_count: program.videoCount,
      tags: program.tags,
      days: built,
      description: program.desc || null,
    };
    // app: src/lib/saveProgram.ts:204
    const me = await readMyProfile(a);
    if (!me?.id) return fail(new Error('no profile'), { result: 'local', id });
    // app: src/lib/saveProgram.ts:207-213
    const { error } = await a.client.from('programs').insert({
      ...base,
      id,
      creator_name: creatorName,
      creator_type: creatorType,
      owner_id: me.id,
    });
    if (error) {
      const result = error.code === '23505' ? 'local' : dayProblem(error.message) ? 'refused' : 'local';
      return fail(error, { result, id });
    }
    return ok(null, { result: 'saved', id, title: program.title });
  } catch (e) {
    return fail(e);
  }
}

/** Deleting a program from the author's library (removeProgram → deleteMyProgram). */
export async function deleteMyProgram(a, id) {
  try {
    // app: src/lib/api.ts:1050
    const { data, error } = await a.client.from('programs').delete().eq('id', id).select('id');
    if (error) return fail(error);
    if (data?.length) return ok(data, { result: 'deleted' });
    // app: src/lib/api.ts:1053
    const { data: still, error: readErr } = await a.client.from('programs').select('id').eq('id', id).maybeSingle();
    if (readErr) return fail(readErr);
    if (still) return fail(new Error('program-not-deleted'));
    return ok([], { result: 'absent' });
  } catch (e) {
    return fail(e);
  }
}

/** A program's page (useProgram), as a student opening their assigned program. */
export async function openProgram(a, id) {
  try {
    // app: src/lib/hooks.ts:118
    const { data, error } = await a.client.from('programs').select('*').eq('id', id).is('hidden_at', null).maybeSingle();
    if (error) return fail(error);
    return ok(data ? [data] : [], { program: data ?? null });
  } catch (e) {
    return fail(e);
  }
}

/** «Proqramı təyin et» on trainer/student/[id].tsx. */
export async function assignStudentProgram(a, { studentId, programId, title, note }) {
  try {
    // app: src/lib/roles.ts:290
    const trainerId = await readMyTrainerId(a);
    if (!trainerId) return fail(new Error('not a trainer'));
    // app: src/lib/roles.ts:295-308
    const { data, error } = await a.client
      .from('student_programs')
      .upsert(
        {
          trainer_id: trainerId,
          student_id: studentId,
          program_id: programId ?? null,
          title,
          note,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'trainer_id,student_id' }
      )
      .select('id');
    if (error) return fail(error);
    if (!data?.length) return fail(new Error('program-not-saved'));
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

/** The student's «MÜƏLLİMİN TƏYİN ETDİYİ PROQRAM» card on the Məşq tab. */
export async function getMyAssignedProgram(a) {
  try {
    // app: src/lib/roles.ts:326
    const me = await readMyProfile(a);
    if (!me) return ok([], { assigned: null });
    // app: src/lib/roles.ts:328-334
    const { data, error } = await a.client
      .from('student_programs')
      .select('title,note,trainer_id,program_id')
      .eq('student_id', me.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return fail(error);
    if (!data) return ok([], { assigned: null });
    let trainerName = null;
    try {
      // app: src/lib/roles.ts:343
      const { data: t } = await a.client.from('trainers').select('name').eq('id', data.trainer_id).maybeSingle();
      trainerName = t?.name ?? null;
    } catch {
      trainerName = null;
    }
    return ok([data], {
      assigned: { title: data.title, note: data.note, trainerId: data.trainer_id, trainerName, programId: data.program_id },
    });
  } catch (e) {
    return fail(e);
  }
}

// ----------------------------------------------------------------- chat ----

async function findThread(a, otherProfileId) {
  // app: src/lib/chat.ts:103
  const me = await readMyProfile(a);
  if (!me?.id) return null;
  const [lo, hi] = me.id < otherProfileId ? [me.id, otherProfileId] : [otherProfileId, me.id];
  // app: src/lib/chat.ts:106-111
  const { data, error } = await a.client
    .from('chat_threads')
    .select('id')
    .eq('a_profile', lo)
    .eq('b_profile', hi)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function readMessages(a, threadId) {
  // app: src/lib/chat.ts:117
  const me = await readMyProfile(a);
  // app: src/lib/chat.ts:118-122
  const { data, error } = await a.client
    .from('messages')
    .select('id,thread_id,sender_id,body,created_at,read_at')
    .eq('thread_id', threadId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    senderId: r.sender_id,
    mine: !!me?.id && r.sender_id === me.id,
    body: r.body,
    createdAt: r.created_at,
    read: !!r.read_at,
  }));
}

export async function getMessages(a, threadId) {
  try {
    // app: src/lib/chat.ts:116
    const rows = await readMessages(a, threadId);
    return ok(rows);
  } catch (e) {
    return fail(e);
  }
}

async function markThreadReadInner(a, threadId) {
  // app: src/lib/chat.ts:155
  const me = await readMyProfile(a);
  if (!me?.id) return;
  // app: src/lib/chat.ts:157-162
  const { error } = await a.client
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .neq('sender_id', me.id)
    .is('read_at', null);
  if (error) throw error;
}

export async function markThreadRead(a, threadId) {
  try {
    // app: src/lib/chat.ts:154
    await markThreadReadInner(a, threadId);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

async function openThreadInner(a, otherProfileId) {
  // app: src/lib/chat.ts:88
  let { data, error } = await a.client.rpc('open_thread', { other: otherProfileId });
  // mirrors: src/lib/chat.ts openThread — one retry after a lost first-write race.
  if (error && /duplicate key|chat_threads_pair|23505/i.test(`${error.message ?? ''} ${error.code ?? ''}`)) {
    ({ data, error } = await a.client.rpc('open_thread', { other: otherProfileId }));
  }
  if (error) {
    const err = new Error(String(error.message ?? ''));
    err.code = error.code;
    err.refusal = chatRefusal(error.message);
    throw err;
  }
  if (!data) throw Object.assign(new Error('no thread id'), { refusal: 'unknown' });
  return data;
}

export async function openThread(a, otherProfileId) {
  try {
    // app: src/lib/chat.ts:87
    return ok(null, { threadId: await openThreadInner(a, otherProfileId) });
  } catch (e) {
    return fail(e, { refusal: e.refusal ?? 'unknown' });
  }
}

async function sendMessageInner(a, threadId, body) {
  // app: src/lib/chat.ts:139
  const me = await readMyProfile(a);
  if (!me?.id) throw Object.assign(new Error('no profile'), { refusal: 'not_signed_in' });
  // app: src/lib/chat.ts:141-145
  const { data, error } = await a.client
    .from('messages')
    .insert({ thread_id: threadId, sender_id: me.id, body: body.trim() })
    .select('id,thread_id,sender_id,body,created_at,read_at')
    .single();
  if (error) {
    const err = new Error(String(error.message ?? ''));
    err.code = error.code;
    err.refusal = chatRefusal(error.message);
    throw err;
  }
  return { id: data.id, threadId: data.thread_id, senderId: data.sender_id, mine: true, body: data.body, createdAt: data.created_at };
}

export async function sendMessage(a, threadId, body) {
  try {
    // app: src/lib/chat.ts:138
    const m = await sendMessageInner(a, threadId, body);
    return ok([m], { message: m });
  } catch (e) {
    return fail(e, { refusal: e.refusal ?? 'unknown' });
  }
}

/** Opening chat/[id] with somebody: find the thread (never create it), then
 *  load and mark read. */
export async function openChatScreen(a, otherProfileId) {
  try {
    // app: src/app/chat/[id].tsx:87
    const threadId = await findThread(a, otherProfileId);
    if (!threadId) return ok([], { threadId: null, messages: [] });
    // app: src/app/chat/[id].tsx:96
    const messages = await readMessages(a, threadId);
    // app: src/app/chat/[id].tsx:100
    await markThreadReadInner(a, threadId).catch(() => {});
    return ok(messages, { threadId, messages });
  } catch (e) {
    return fail(e);
  }
}

/** Pressing «Göndər» on chat/[id]: the thread is opened by the FIRST message. */
export async function sendChatMessage(a, otherProfileId, knownThreadId, text) {
  let threadId = knownThreadId ?? null;
  try {
    // app: src/app/chat/[id].tsx:153
    threadId = threadId ?? (await openThreadInner(a, otherProfileId));
    // app: src/app/chat/[id].tsx:155
    const m = await sendMessageInner(a, threadId, text);
    return ok([m], { threadId, message: m });
  } catch (e) {
    return fail(e, { refusal: e.refusal ?? 'unknown', threadId });
  }
}

/** The inbox (chat/index.tsx, trainer/chat.tsx). Names are read only for this
 *  run's own profiles — a real person who wrote to a TEST trainer stays unread. */
export async function getMyThreads(a, simIds) {
  try {
    // app: src/lib/chat.ts:242
    const me = await readMyProfile(a);
    if (!me?.id) return ok([], { threads: [] });
    // app: src/lib/chat.ts:244-246
    const { data: threads, error } = await a.client
      .from('chat_threads')
      .select('id,a_profile,b_profile');
    if (error) return fail(error);
    const allRows = threads ?? [];
    const otherOf = (t) => (t.a_profile === me.id ? t.b_profile : t.a_profile);
    const rows = simIds ? allRows.filter((t) => simIds.has(otherOf(t))) : allRows;
    const foreign = allRows.length - rows.length;
    if (!rows.length) return ok([], { threads: [], foreign });
    // app: src/lib/chat.ts:253-260
    const [{ data: msgs, error: mErr }] = await Promise.all([
      a.client
        .from('messages')
        .select('thread_id,sender_id,body,created_at,read_at')
        .in('thread_id', rows.map((t) => t.id))
        .order('created_at', { ascending: false }),
      a.client.from('profiles').select('id,name').in('id', rows.map(otherOf)),
    ]);
    if (mErr) return fail(mErr);
    const unread = new Map();
    for (const m of msgs ?? []) {
      if (!m.read_at && m.sender_id !== me.id) unread.set(m.thread_id, (unread.get(m.thread_id) ?? 0) + 1);
    }
    const list = rows.map((t) => ({ threadId: t.id, otherProfileId: otherOf(t), unread: unread.get(t.id) ?? 0 }));
    return ok(list, { threads: list, foreign });
  } catch (e) {
    return fail(e);
  }
}

/** Live messages on an open chat screen. Resolves `subscribed` with the
 *  channel's first terminal status so the scenario can tell «no delivery» from
 *  «never subscribed». */
export function subscribeToThread(a, threadId, onInsert) {
  let myId = null;
  // app: src/lib/chat.ts:189
  readMyProfile(a)
    .then((me) => {
      myId = me?.id ?? null;
    })
    .catch(() => {
      myId = null;
    });
  let settle;
  const subscribed = new Promise((r) => {
    settle = r;
  });
  // app: src/lib/chat.ts:200-216
  const channel = a.client
    .channel(`thread:${threadId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
      (payload) => {
        const r = payload.new ?? {};
        onInsert({ id: r.id, threadId: r.thread_id, senderId: r.sender_id, mine: !!myId && r.sender_id === myId, body: r.body });
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        settle({ status, error: errInfo(err) });
      }
    });
  return {
    subscribed,
    // app: src/lib/chat.ts:226
    unsubscribe: () => a.client.removeChannel(channel).catch(() => null),
  };
}

// ----------------------------------------------------------------- gyms ----

/** «Zalı qeydiyyatdan keçir» on create-gym.tsx: createGym(), then the pin. */
export async function createGym(a, { name, district, hours, priceMonth, dayPass, amenities, lat, lng }) {
  try {
    // app: src/lib/api.ts:739
    const me = await readMyProfile(a);
    if (!me) return fail(new Error('no profile'));
    // app: src/lib/api.ts:744-750
    const { data: owned, error: ownedErr } = await a.client
      .from('gyms')
      .select('id')
      .eq('owner_id', me.id)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ownedErr) return fail(ownedErr);
    if (owned?.id) return fail(new Error('gym-exists'), { gymId: owned.id });
    // mirrors: src/lib/api.ts:753 (time + random tail since the cl9gnb run)
    const id = `usr-${uniqueTail()}`;
    // app: src/lib/api.ts:759-771
    const { error } = await a.client.from('gyms').insert({
      id,
      name,
      district,
      price_month: priceMonth,
      day_pass: dayPass,
      hours,
      amenities,
      tags: [],
      about: null,
      image_url: null,
      owner_id: me.id,
    });
    if (error) {
      const idCollision = error.code === '23505' && /gyms_pkey/.test(String(error.message ?? ''));
      return fail(error, { gymId: id, idCollision });
    }
    // app: src/app/(tabs)/profile/create-gym.tsx:294-295
    const { data: locRow, error: locError } = await a.client
      .from('gyms').update({ lat, lng }).eq('id', id).select('id');
    a.gymId = id;
    return ok(null, { gymId: id, locSaved: !locError && !!locRow?.length, locError: errInfo(locError) });
  } catch (e) {
    return fail(e);
  }
}

// mirrors: src/lib/gymOwner.tsx:61-82
function mapOwnedGym(r) {
  return {
    id: String(r.id),
    name: r.name ?? '',
    district: r.district ?? '',
    hours: r.hours ?? '',
    priceMonth: Number(r.price_month ?? 0),
    dayPass: Number(r.day_pass ?? 0),
    amenities: r.amenities ?? [],
    about: r.about ?? '',
    listed: r.listed == null ? true : Boolean(r.listed),
    allowDayPass: r.allow_day_pass == null ? true : Boolean(r.allow_day_pass),
    showMembers: r.show_members == null ? true : Boolean(r.show_members),
    members: Number(r.members ?? 0),
    ownerId: r.owner_id ?? null,
  };
}

/** Every gym-panel screen resolves the gym this way (useMyGym → fetchMyGym). */
export async function fetchMyGym(a) {
  try {
    // app: src/lib/gymOwner.tsx:88
    const id = await readMyGymId(a);
    if (!id) return ok([], { gym: null });
    // app: src/lib/gymOwner.tsx:90
    const { data, error } = await a.client.from('gyms').select('*').eq('id', id).maybeSingle();
    if (error) return fail(error);
    return ok(data ? [data] : [], { gym: data ? mapOwnedGym(data) : null });
  } catch (e) {
    return fail(e);
  }
}

/** Opening «Zal kodu» (gym/qr.tsx): read the current code. */
export async function openQrScreen(a, gymId) {
  try {
    // app: src/app/gym/qr.tsx:61-65
    const { data, error } = await a.client
      .from('gym_checkin_codes')
      .select('code')
      .eq('gym_id', gymId)
      .maybeSingle();
    if (error) return fail(error, { state: 'failed' });
    return ok(data ? [data] : [], { state: data?.code ? 'ready' : 'none', code: data?.code ? String(data.code) : null });
  } catch (e) {
    return fail(e);
  }
}

/** «Yeni kod» on gym/qr.tsx. */
export async function rotateCheckinCode(a, gymId) {
  try {
    // app: src/app/gym/qr.tsx:84
    const { data, error } = await a.client.rpc('gym_rotate_checkin_code', { p_gym_id: gymId });
    if (error || !data) return fail(error ?? new Error('no code'));
    return ok(null, { code: String(data) });
  } catch (e) {
    return fail(e);
  }
}

/** Scanning (or typing) the gym's code on (tabs)/checkin.tsx. */
export async function checkInWithCode(a, code) {
  try {
    // app: src/app/(tabs)/checkin.tsx:81
    const { data, error } = await a.client.rpc('check_in_with_code', { p_code: code });
    if (error) return fail(error, { refusal: checkinRefusal(error.message) });
    const row = data ?? {};
    return ok(null, { gymId: row.gym_id ?? null, gymName: row.gym_name ?? null, checkInId: row.id ?? null });
  } catch (e) {
    return fail(e, { refusal: 'unknown' });
  }
}

// mirrors: src/lib/roles.ts:396-406
async function readAll(page) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function readGymMembers(a, gymId) {
  const rows = await readAll((from, to) =>
    // app: src/lib/roles.ts:421-426
    a.client
      .from('profiles')
      .select('id,name,level,goals,show_in_gym_list,created_at')
      .eq('home_gym_id', gymId)
      .order('id')
      .range(from, to)
  );
  if (!rows.length) return [];
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const cis = await readAll((from, to) =>
    // app: src/lib/roles.ts:432-439
    a.client
      .from('check_ins')
      .select('profile_id,created_at')
      .eq('gym_id', gymId)
      .gt('created_at', since)
      .order('created_at')
      .order('id')
      .range(from, to)
  );
  const counts = new Map();
  for (const c of cis) {
    const cur = counts.get(c.profile_id);
    if (!cur) counts.set(c.profile_id, { n: 1, last: c.created_at });
    else counts.set(c.profile_id, { n: cur.n + 1, last: c.created_at > cur.last ? c.created_at : cur.last });
  }
  return rows.map((p) => ({
    profileId: p.id,
    checkIns30d: counts.get(p.id)?.n ?? 0,
    lastCheckIn: counts.get(p.id)?.last ?? null,
    showInGymList: p.show_in_gym_list,
  }));
}

async function readGymRoster(a, gymId) {
  // app: src/lib/gymOwner.tsx:326
  const base = await readGymMembers(a, gymId);
  if (!base.length) return [];
  const nowIso = new Date().toISOString();
  // app: src/lib/gymOwner.tsx:330-334
  const { data: active, error: aErr } = await a.client
    .from('check_ins')
    .select('profile_id')
    .eq('gym_id', gymId)
    .gt('expires_at', nowIso);
  if (aErr) throw aErr;
  const here = new Set((active ?? []).map((r) => r.profile_id));
  return base.map((m) => ({ ...m, anonymous: m.showInGymList === false, hereNow: here.has(m.profileId) }));
}

// mirrors: src/lib/roles.ts:466-467
const BAKU_OFFSET_MS = 4 * 3_600_000;

async function readGymOccupancy(a, gymId) {
  const nowMs = Date.now();
  const baku = new Date(nowMs + BAKU_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(baku.getUTCFullYear(), baku.getUTCMonth(), baku.getUTCDate()) - BAKU_OFFSET_MS);
  // app: src/lib/roles.ts:476-480
  const { data, error } = await a.client
    .from('check_ins')
    .select('created_at,expires_at')
    .eq('gym_id', gymId)
    .gt('created_at', startOfDay.toISOString());
  if (error) throw error;
  const rows = data ?? [];
  const nowIso = new Date().toISOString();
  let nowCount = 0;
  for (const r of rows) if (!r.expires_at || r.expires_at > nowIso) nowCount += 1;
  return { now: nowCount, today: rows.length };
}

async function readGymDayPasses(a, gymId) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  // app: src/lib/roles.ts:499-503
  const { data, error } = await a.client
    .from('day_passes')
    .select('status,expires_at,used_at')
    .eq('gym_id', gymId)
    .gte('purchased_at', dayStart.toISOString());
  if (error) throw error;
  const t = Date.now();
  const rows = data ?? [];
  return {
    live: rows.filter((r) => r.status === 'active' && r.expires_at && Date.parse(r.expires_at) > t).length,
    usedToday: rows.filter((r) => r.status === 'used').length,
  };
}

async function readMyGymClaim(a, gymId) {
  // app: src/lib/gymOwner.tsx:215
  const uid = await getUserId(a);
  if (!uid) return null;
  // app: src/lib/gymOwner.tsx:217-224
  const { data, error } = await a.client
    .from('gym_claims')
    .select('*')
    .eq('gym_id', gymId)
    .eq('claimant_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

const settle = (p) => p.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error: errInfo(error) }));

/** The gym panel's home screen (gym/index.tsx load()): four reads at once. */
export async function gymDashboard(a, gymId) {
  try {
    // app: src/app/gym/index.tsx:99-104
    const [roster, occ, passes, claim] = await Promise.all([
      settle(readGymRoster(a, gymId)),
      settle(readGymOccupancy(a, gymId)),
      settle(readGymDayPasses(a, gymId)),
      settle(readMyGymClaim(a, gymId)),
    ]);
    const firstErr = [roster, occ, passes, claim].find((r) => !r.ok);
    return {
      ok: !firstErr,
      rows: null,
      error: firstErr?.error ?? null,
      roster: roster.ok ? roster.value : null,
      occupancy: occ.ok ? occ.value : null,
      dayPasses: passes.ok ? passes.value : null,
      claim: claim.ok ? claim.value : null,
    };
  } catch (e) {
    return fail(e);
  }
}

// mirrors: src/lib/gymOwner.tsx:160
const EXTRA_KEYS = ['schedule', 'allow_day_pass', 'show_members'];

async function updateMyGymInner(a, gymId, patch) {
  const core = {};
  const extras = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (EXTRA_KEYS.includes(k)) extras[k] = v;
    else core[k] = v;
  }
  if (Object.keys(core).length) {
    // app: src/lib/gymOwner.tsx:184
    const { data, error } = await a.client.from('gyms').update(core).eq('id', gymId).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('gym-not-saved');
  }
  if (!Object.keys(extras).length) return { extrasSaved: true };
  // app: src/lib/gymOwner.tsx:193
  const { data, error } = await a.client.from('gyms').update(extras).eq('id', gymId).select('id');
  return { extrasSaved: !error && !!data?.length, extrasError: errInfo(error) };
}

/** «Yadda saxla» on gym/edit.tsx. `gym` is what useMyGym loaded into the form;
 *  `form` holds the fields the owner changed. */
export async function editGym(a, gym, form) {
  try {
    const next = { ...gym, ...form };
    // app: src/app/gym/edit.tsx:341-351
    const r = await updateMyGymInner(a, gym.id, {
      name: next.name.trim(),
      district: next.district.trim(),
      hours: next.hours,
      about: next.about.trim(),
      price_month: Number(next.priceMonth) || 0,
      day_pass: Number(next.dayPass) || 0,
      amenities: next.amenities,
      ...(next.allowDayPass !== gym.allowDayPass ? { allow_day_pass: next.allowDayPass } : {}),
      ...(next.showMembers !== gym.showMembers ? { show_members: next.showMembers } : {}),
    });
    return ok(null, r);
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------ day-pass ----

/** Opening a gym's page (discover/gym/[id].tsx → getGym). */
export async function openGymPage(a, gymId) {
  try {
    // app: src/lib/api.ts:376
    const { data, error } = await a.client.from('gyms').select('*').eq('id', gymId).maybeSingle();
    if (error) return fail(error);
    if (!data) return ok([], { gym: null });
    // getGym() goes on to activeCountsByGym() (api.ts:332), which reads every
    // live check-in in the country — real people's rows. The hard rule forbids
    // that read, so it is not made; the harness only needs the two switches.
    return ok([data], { gym: { id: data.id, allowDayPass: data.allow_day_pass !== false, showMembers: data.show_members !== false } });
  } catch (e) {
    return fail(e);
  }
}

export async function getMyDayPass(a, gymId) {
  try {
    // app: src/lib/api.ts:833
    const uid = await getUserId(a);
    if (!uid) return ok([], { pass: null });
    // app: src/lib/api.ts:835-844
    const { data, error } = await a.client
      .from('day_passes')
      .select('code,expires_at,price')
      .eq('user_id', uid)
      .eq('gym_id', gymId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('purchased_at', { ascending: false })
      .limit(1);
    if (error) return fail(error);
    const row = (data ?? [])[0];
    return ok(data ?? [], { pass: row ? { code: row.code, expiresAt: row.expires_at, price: Number(row.price ?? 0) } : null });
  } catch (e) {
    return fail(e);
  }
}

/** «Day-pass al» on the gym page. */
export async function createDayPass(a, gymId) {
  try {
    // app: src/lib/api.ts:819
    const { data, error } = await a.client.rpc('create_day_pass', { g_id: gymId });
    if (error) return fail(error, { dayPassOff: error.message === 'day_pass_off' });
    const r = data ?? {};
    if (!r.code || !r.expires_at) return fail(new Error('bad-pass'));
    return ok(null, { pass: { code: r.code, expiresAt: r.expires_at, price: Number(r.price ?? 0), reused: !!r.reused } });
  } catch (e) {
    return fail(e);
  }
}

/** «Yoxla» on gym/pass.tsx. */
export async function checkDayPass(a, code) {
  try {
    // mirrors: src/app/gym/pass.tsx:89
    const clean = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // app: src/lib/roles.ts:537
    const { data, error } = await a.client.rpc('check_day_pass', { p_code: clean });
    if (error) return fail(error);
    return ok(null, { check: data ?? { state: 'not_found' } });
  } catch (e) {
    return fail(e);
  }
}

// -------------------------------------------------------------- reviews ----

/** «Rəy yaz» → «Göndər» on discover/gym/[id].tsx. */
export async function submitReview(a, gymId, { rating, body, myCheckins }) {
  try {
    // app: src/app/(tabs)/discover/gym/[id].tsx:333
    const me = await readMyProfile(a);
    if (!me?.id) return fail(new Error('no-profile'));
    // app: src/app/(tabs)/discover/gym/[id].tsx:335-342
    const { error } = await a.client.from('reviews').insert({
      gym_id: gymId,
      author_id: me.id,
      name: a.store.profile.name || 'Sən',
      tenure: `${myCheckins} check-in edib`,
      rating,
      body,
    });
    if (error) return fail(error);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** The gym owner's official reply (gym/reviews.tsx). */
export async function replyToReview(a, reviewId, body) {
  try {
    // app: src/lib/gymOwner.tsx:297-301
    const { data, error } = await a.client
      .from('reviews')
      .update({ reply: body, reply_at: new Date().toISOString() })
      .eq('id', reviewId)
      .select('id');
    if (error) return fail(error);
    if (!data?.length) return fail(new Error('reply-not-saved'));
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}

// ------------------------------------------------------------- workouts ----

/** Finishing a session (workout/session.tsx): the summary row, then any PR. */
export async function finishWorkout(a, { title, durationSec, volumeKg, setsDone, prs = [] }) {
  try {
    const id = newId();
    // app: src/app/(tabs)/workout/session.tsx:359
    const me = await readMyProfile(a);
    if (!me) return fail(new Error('no profile'));
    // app: src/lib/api.ts:953
    const { error } = await a.client.from('workouts').upsert(
      {
        id,
        profile_id: me.id,
        program_id: null,
        title,
        duration_sec: Math.round(durationSec),
        volume_kg: Math.round(volumeKg),
        sets_done: setsDone,
        rpe: null,
      },
      { onConflict: 'id' }
    );
    if (error) return fail(error, { workoutId: id });
    for (const { lift, value } of prs) {
      // app: src/app/(tabs)/workout/session.tsx:380
      const pme = await readMyProfile(a);
      if (!pme) continue;
      // app: src/lib/api.ts:1012
      await a.client.from('prs').insert({ profile_id: pme.id, lift, value, delta: null });
    }
    return ok(null, { workoutId: id });
  } catch (e) {
    return fail(e);
  }
}

// --------------------------------------------------------------- social ----
// The community feed, likes, comments, follows and partner requests. Every
// target the scenario hands these is content a TEST actor of this run made; a
// row written by anyone else that comes back from an app read (a comment, a
// notification, an incoming offer) is COUNTED and dropped — never kept, never
// resolved to a name, never logged.

// mirrors: src/app/(tabs)/feed/index.tsx:41
export const postKey = (id) => `post:${id}`;

// mirrors: src/lib/hooks.ts:77-84
function mapPost(r) {
  return {
    id: r.id,
    author: r.author,
    authorId: r.author_id ?? null,
    gym: r.gym,
    type: r.type,
    text: r.body,
    likes: r.likes ?? 0,
    comments: r.comments ?? 0,
  };
}

async function socialMyId(a) {
  // app: src/lib/social.ts:23
  const me = await readMyProfile(a);
  if (!me?.id) throw new Error('no profile');
  return me.id;
}

// Harness only, not an app call: the write actions below take `{ sync }` from
// together()'s alignWrite and await it AFTER their own reads (auth.getUser, the
// profile row), right before the write — so the writes of a concurrent step
// leave together, not just the function calls. The app's calls and their order
// are unchanged; alone, sync is this no-op.
const noSync = async () => {};

/** «Yeni post» → «Paylaş» on feed/compose.tsx: a text post (createCommunityPost). */
export async function createCommunityPost(a, text) {
  try {
    // app: src/app/(tabs)/feed/compose.tsx:27
    if (!text.trim()) return fail(new Error('empty post'));
    // app: src/app/(tabs)/feed/compose.tsx:28
    if (!a.store.profile.name.trim()) return fail(new Error('no-name'), { shown: 'Əvvəlcə profilində adını yaz — post adınla paylaşılır' });
    // The composer stamps the HOME gym's name from the gym catalogue. A TEST actor
    // never has a home gym, so the app sends ''; with one set the harness stops
    // rather than guess a name it did not read.
    if (a.store.profile.homeGymId) return fail(new Error('harness: a home gym is set — the composer would stamp its name, which is not mirrored'));
    // mirrors: src/app/(tabs)/feed/compose.tsx:24
    const gymName = '';
    // app: src/app/(tabs)/feed/compose.tsx:38
    const p = { author: a.store.profile.name.trim(), gym: gymName, body: text.trim() };
    // app: src/lib/api.ts:690
    const me = await readMyProfile(a);
    if (!me?.id) return fail(new Error('no profile'));
    // No .select(): the app gets no row back and meets its post again in the feed.
    // app: src/lib/api.ts:695-706
    const { error } = await a.client.from('community_posts').insert({
      author: p.author,
      author_id: me.id,
      gym: p.gym,
      time_ago: 'indi',
      type: 'text',
      body: p.body,
    });
    if (error) return fail(error, { shown: 'Post göndərilə bilmədi. Yenidən cəhd et.' });
    return ok(null, { body: p.body, shown: 'Postun paylaşıldı' });
  } catch (e) {
    return fail(e);
  }
}

/** The community feed (useCommunityPosts), FILTERED server-side to one author.
 *  The app reads every post; the filter keeps real people's posts from ever
 *  being fetched. The insert above returns no row, so this is how the id of the
 *  post just written is learned — the same way the app sees it again. */
export async function openFeedPostsBy(a, authorProfileId) {
  try {
    // app: src/lib/hooks.ts:335
    const { data, error } = await a.client.from('community_posts').select('*').is('hidden_at', null).eq('author_id', authorProfileId).order('created_at', { ascending: false });
    if (error) return fail(error);
    const posts = (data ?? []).map(mapPost);
    return ok(posts, { posts });
  } catch (e) {
    return fail(e);
  }
}

/** One post card as the feed draws it — likes straight from community_posts.likes
 *  (the trigger-kept counter) — with the feed read filtered to that post's id. */
export async function openFeedPost(a, postId) {
  try {
    // app: src/lib/hooks.ts:335
    const { data, error } = await a.client.from('community_posts').select('*').is('hidden_at', null).eq('id', postId).order('created_at', { ascending: false });
    if (error) return fail(error);
    const post = (data ?? []).map(mapPost)[0] ?? null;
    return ok(post ? [post] : [], { post });
  } catch (e) {
    return fail(e);
  }
}

/** The heart on a post card (PostCard onLike → likePost). */
export async function likePost(a, postId, { sync = noSync } = {}) {
  try {
    // app: src/app/(tabs)/feed/index.tsx:853
    const me = await socialMyId(a);
    await sync();
    // app: src/lib/social.ts:56
    const { error } = await a.client.from('post_likes').insert({ post_id: postId, profile_id: me });
    // «Already liked is the desired end state»: the app swallows a duplicate.
    // mirrors: src/lib/social.ts:57
    const duplicate = !!error && String(error.message ?? '').includes('duplicate');
    if (error && !duplicate) return fail(error, { shown: 'Bəyənmə göndərilmədi — yenidən cəhd et' });
    return ok(null, { duplicate });
  } catch (e) {
    return fail(e);
  }
}

/** Tapping a filled heart again (PostCard onLike → unlikePost). */
export async function unlikePost(a, postId, { sync = noSync } = {}) {
  try {
    // app: src/app/(tabs)/feed/index.tsx:853
    const me = await socialMyId(a);
    await sync();
    // app: src/lib/social.ts:62-63
    const { error } = await a.client.from('post_likes').delete().eq('post_id', postId).eq('profile_id', me);
    if (error) return fail(error, { shown: 'Bəyənmə göndərilmədi — yenidən cəhd et' });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Which of these posts the SERVER says I liked — the feed's reconcile of the
 *  hearts (CommunityFeed → myPostLikes). */
export async function myPostLikes(a, postIds) {
  try {
    // app: src/lib/social.ts:68
    const me = await readMyProfile(a);
    if (!me?.id || !postIds.length) return ok([], { liked: [] });
    // app: src/lib/social.ts:70-71
    const { data, error } = await a.client.from('post_likes').select('post_id').eq('profile_id', me.id).in('post_id', postIds);
    if (error) return fail(error);
    return ok(data ?? [], { liked: (data ?? []).map((r) => r.post_id) });
  } catch (e) {
    return fail(e);
  }
}

/** «İzlə» (followProfile) — the button on a video card and on the creator page. */
export async function followProfile(a, profileId, { sync = noSync } = {}) {
  try {
    // app: src/app/(tabs)/feed/creator.tsx:63
    const me = await socialMyId(a);
    await sync();
    // app: src/lib/social.ts:80
    const { error } = await a.client.from('follows').insert({ follower_id: me, followee_id: profileId });
    // mirrors: src/lib/social.ts:81
    const duplicate = !!error && String(error.message ?? '').includes('duplicate');
    if (error && !duplicate) return fail(error, { shown: 'İzləmə göndərilmədi — yenidən cəhd et' });
    return ok(null, { duplicate });
  } catch (e) {
    return fail(e);
  }
}

/** «İzlənir» tapped again (unfollowProfile). */
export async function unfollowProfile(a, profileId) {
  try {
    // app: src/app/(tabs)/feed/creator.tsx:63
    const me = await socialMyId(a);
    // app: src/lib/social.ts:86-87
    const { error } = await a.client.from('follows').delete().eq('follower_id', me).eq('followee_id', profileId);
    if (error) return fail(error, { shown: 'İzləmə göndərilmədi — yenidən cəhd et' });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** Who I follow (myFollowing) — what the feed orders videos by, and what the
 *  launch-time social sync puts back on the device. */
export async function myFollowing(a) {
  try {
    // app: src/lib/social.ts:92
    const me = await readMyProfile(a);
    if (!me?.id) return ok([], { following: [] });
    // app: src/lib/social.ts:94
    const { data, error } = await a.client.from('follows').select('followee_id').eq('follower_id', me.id);
    if (error) return fail(error);
    return ok(data ?? [], { following: (data ?? []).map((r) => r.followee_id) });
  } catch (e) {
    return fail(e);
  }
}

/** followCounts(profileId). The app ignores both errors (a failed count reads 0);
 *  they are returned beside the numbers so a 0 can be told from a failure. */
export async function followCounts(a, profileId) {
  try {
    // app: src/lib/social.ts:101-104
    const [x, y] = await Promise.all([
      a.client.from('follows').select('followee_id', { count: 'exact', head: true }).eq('followee_id', profileId),
      a.client.from('follows').select('follower_id', { count: 'exact', head: true }).eq('follower_id', profileId),
    ]);
    const error = x.error ?? y.error ?? null;
    return { ok: !error, rows: null, error: errInfo(error), followers: x.count ?? 0, following: y.count ?? 0 };
  } catch (e) {
    return fail(e);
  }
}

// mirrors: src/lib/comments.ts:51
const UNKNOWN_AUTHOR = 'Silinmiş istifadəçi';

// mirrors: src/lib/comments.ts:53-68
function toComment(r, myProfileId) {
  return {
    id: r.id,
    parentId: r.parent_id,
    authorId: r.author_id,
    authorName: r.author_name?.trim() || UNKNOWN_AUTHOR,
    body: r.body,
    createdAt: r.created_at,
    likes: Number(r.likes ?? 0),
    likedByMe: r.liked_by_me === true,
    mine: myProfileId != null && r.author_id === myProfileId,
  };
}

/** The comments sheet opening on a target (fetchComments → comments_for). A
 *  comment by anyone outside this run is counted and dropped right here. */
export async function fetchComments(a, targetKey, simIds) {
  try {
    // app: src/lib/comments.ts:87-90
    const [me, res] = await Promise.all([readMyProfile(a), a.client.rpc('comments_for', { target: targetKey })]);
    if (res.error) return fail(res.error, { shown: 'yüklənmədi' });
    const all = (res.data ?? []).map((r) => toComment(r, me?.id ?? null));
    const rows = simIds ? all.filter((c) => simIds.has(c.authorId)) : all;
    return ok(rows, { comments: rows, foreign: all.length - rows.length, total: all.length });
  } catch (e) {
    return fail(e);
  }
}

/** «Göndər» in the comments sheet (CommentsSheet send → addComment). A reply
 *  passes the TOP-LEVEL comment as `parentId`. */
export async function addComment(a, targetKey, body, parentId = null, { sync = noSync } = {}) {
  try {
    // app: src/components/CommentsSheet.tsx:397
    const text = body.trim();
    if (!text) return fail(new Error('empty comment'));
    // app: src/lib/comments.ts:109
    const me = await readMyProfile(a);
    if (!me) return fail(new Error('no profile'));
    await sync();
    // app: src/lib/comments.ts:112-121
    const { data, error } = await a.client
      .from('comments')
      .insert({ target_key: targetKey, parent_id: parentId ?? null, author_id: me.id, body: text })
      .select('id,parent_id,author_id,body,created_at')
      .single();
    if (error) return fail(error, { shown: 'Şərh göndərilmədi — yenidən cəhd et' });
    const comment = { id: data.id, parentId: data.parent_id, authorId: data.author_id, body: data.body, createdAt: data.created_at };
    return ok([comment], { comment });
  } catch (e) {
    return fail(e);
  }
}

/** The heart under a comment (CommentsSheet like → toggleCommentLike). `liked` is
 *  the state to END in, so a device with a stale screen sends «like» again. */
export async function toggleCommentLike(a, commentId, liked, { sync = noSync } = {}) {
  try {
    // app: src/lib/comments.ts:155
    const me = await readMyProfile(a);
    if (!me) return fail(new Error('no profile'));
    await sync();
    if (liked) {
      // app: src/lib/comments.ts:159-161
      const { error } = await a.client
        .from('comment_likes')
        .upsert(
          { comment_id: commentId, profile_id: me.id },
          // ignoreDuplicates since the cq8rjw fix: comment_likes has no UPDATE policy.
          { onConflict: 'comment_id,profile_id', ignoreDuplicates: true }
        );
      if (error) return fail(error, { shown: 'Bəyənilmədi — yenidən cəhd et' });
      return ok(null);
    }
    // app: src/lib/comments.ts:165-169
    const { error } = await a.client
      .from('comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('profile_id', me.id);
    if (error) return fail(error, { shown: 'Bəyənmə geri götürülmədi — yenidən cəhd et' });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

/** «Sil» on your OWN comment (CommentsSheet remove): delete, then re-read — the
 *  re-read, not the request, decides what the person is told. */
export async function deleteMyComment(a, targetKey, commentId, simIds) {
  try {
    // app: src/lib/comments.ts:145
    const { error } = await a.client.from('comments').delete().eq('id', commentId);
    if (error) return fail(error, { shown: 'Şərh silinmədi — yenidən cəhd et' });
    // app: src/components/CommentsSheet.tsx:369
    const after = await fetchComments(a, targetKey, simIds);
    // A failed re-read is null in the sheet, and `after?.some` is then false: the
    // app says «Şərh silindi» without knowing. Reported as rereadOk.
    const still = (after.comments ?? []).some((c) => c.id === commentId);
    return ok(null, { gone: after.ok && !still, rereadOk: after.ok, shown: still ? 'Şərh silinmədi' : 'Şərh silindi' });
  } catch (e) {
    return fail(e);
  }
}

/** The comment count under each post card (useCommentCounts): one read of the
 *  target keys, tallied on the phone. */
export async function readCommentCounts(a, keys) {
  try {
    // app: src/app/(tabs)/feed/index.tsx:90
    const { data, error } = await a.client.from('comments').select('target_key').in('target_key', keys);
    if (error || !data) return fail(error ?? new Error('no data'));
    const counts = {};
    for (const k of keys) counts[k] = 0;
    for (const row of data) counts[row.target_key] = (counts[row.target_key] ?? 0) + 1;
    return ok(null, { counts });
  } catch (e) {
    return fail(e);
  }
}

/** «Bildirişlər» (getNotifications). Names are read only for this run's actors;
 *  a row caused by anyone else is counted, never resolved or kept. */
export async function getNotifications(a, simIds, limit = 50) {
  try {
    // app: src/lib/notifications.ts:86
    const me = await readMyProfile(a);
    if (!me) return ok([], { notifications: [], foreign: 0, total: 0, unreadAll: 0 });
    // app: src/lib/notifications.ts:88-92
    const { data, error } = await a.client
      .from('notifications')
      .select('id,type,actor_id,target_key,entity_id,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return fail(error);
    const all = data ?? [];
    const rows = simIds ? all.filter((r) => !r.actor_id || simIds.has(r.actor_id)) : all;
    const ids = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))];
    const names = new Map();
    if (ids.length) {
      // app: src/lib/notifications.ts:102
      const { data: profs } = await a.client.from('profiles').select('id,name').in('id', ids);
      for (const p of profs ?? []) if (p.name) names.set(p.id, p.name);
    }
    const list = rows.map((r) => ({
      id: r.id,
      type: r.type,
      actorId: r.actor_id,
      actorName: r.actor_id ? (names.get(r.actor_id) ?? null) : null,
      targetKey: r.target_key,
      entityId: r.entity_id,
      read: !!r.read_at,
      createdAt: r.created_at,
    }));
    return ok(list, { notifications: list, foreign: all.length - rows.length, total: all.length, unreadAll: all.filter((r) => !r.read_at).length, limit });
  } catch (e) {
    return fail(e);
  }
}

/** The unread badge (getUnreadCount). `null` = could not ask, as in the app. */
export async function getUnreadCount(a) {
  try {
    // app: src/lib/notifications.ts:123
    const me = await readMyProfile(a);
    if (!me) return ok(null, { unread: null });
    // app: src/lib/notifications.ts:125-128
    const { count, error } = await a.client.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    if (error) return fail(error, { unread: null });
    return ok(null, { unread: count ?? 0 });
  } catch (e) {
    return fail(e);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// mirrors: src/store/db.ts:549-553
function acceptLocal(a, partnerId) {
  a.db.matches = { ...a.db.matches, [partnerId]: { partnerId, state: 'accepted', at: new Date().toISOString() } };
}

// mirrors: src/app/chat/requests.tsx:52-57
function forgetOutgoing(a, partnerId) {
  const rest = { ...a.db.matches };
  delete rest[partnerId];
  a.db.matches = rest;
}

// mirrors: src/lib/api.ts:1237-1243
function mapMatchRows(data, meId) {
  return data.map((r) => {
    const iSent = r.from_profile === meId;
    const st = r.status === 'accepted' || r.status === 'declined' ? r.status : 'pending';
    return { otherProfileId: iSent ? r.to_profile : r.from_profile, status: st, iSent, note: r.note ?? null };
  });
}

// mirrors: src/store/db.ts:511-545
function reconcileMatches(matches, rows) {
  const stateOf = (r) => (r.status === 'accepted' ? 'accepted' : r.status === 'declined' ? 'declined' : r.iSent ? 'requested' : 'incoming');
  // A Map keyed by the other person: when two rows share a partner, the LAST wins.
  const server = new Map(rows.map((r) => [r.otherProfileId, r]));
  const next = {};
  for (const [pid, m] of Object.entries(matches)) {
    if (!UUID_RE.test(pid)) {
      next[pid] = m;
      continue;
    }
    const r = server.get(pid);
    if (!r) {
      if (m.state === 'declined') next[pid] = m;
      continue;
    }
    next[pid] = { ...m, state: stateOf(r) };
  }
  for (const r of rows) {
    if (next[r.otherProfileId]) continue;
    next[r.otherProfileId] = { partnerId: r.otherProfileId, at: new Date().toISOString(), state: stateOf(r) };
  }
  return next;
}

/**
 * «Təklif göndər» on discover/match.tsx: the RPC first; the device records the
 * offer only once it reached the server.
 *
 * Since schema84 the same tap can END in a match: asking somebody who had
 * already asked you is written as 'accepted' and the mutual trigger settles
 * their row too. The app reads the row back to know which of the two happened
 * (api.ts:680-683), so the harness does the same and reports `status`, because
 * everything after it differs — the toast, this device's state, and which
 * notification the server sent.
 */
export async function sendMatchRequest(a, toProfileId, proposal, { sync = noSync, partnerName = null } = {}) {
  try {
    // app: src/lib/api.ts:669
    const clean = (proposal ?? '').trim().slice(0, 200);
    // The RPC is the first request, so here sync only lets the step measure it.
    await sync();
    // app: src/lib/api.ts:670-673
    const { data, error } = await a.client.rpc('send_match_request', { p_to: toProfileId, p_note: clean || null });
    if (error) return fail(error, { status: null, matched: false, shown: 'Təklif göndərilmədi — yenidən cəhd et' });
    // app: src/lib/api.ts:680
    const id = typeof data === 'string' ? data : null;
    // A failed read-back is not a failed send: the app calls it 'pending', the
    // state the next launch's reconcile corrects.
    let status = 'pending';
    if (id) {
      // app: src/lib/api.ts:682
      const { data: row } = await a.client.from('match_requests').select('status').eq('id', id).maybeSingle();
      status = row?.status === 'accepted' ? 'accepted' : 'pending';
    }
    const matched = status === 'accepted';
    // The store's acceptMatch (db.ts:549-553) — the match is already made, so
    // recording «gözləyir» would hide it on this phone.
    // app: src/app/(tabs)/discover/match.tsx:220
    if (matched) acceptLocal(a, toProfileId);
    // The store's sendMatchRequest (db.ts:481-484).
    // app: src/app/(tabs)/discover/match.tsx:221
    else a.db.matches = { ...a.db.matches, [toProfileId]: { partnerId: toProfileId, state: 'requested', at: new Date().toISOString(), question: `Məşq təklifi: ${proposal}` } };
    return ok(null, {
      status,
      matched,
      requestId: id,
      // app: src/app/(tabs)/discover/match.tsx:226
      shown: matched ? `${partnerName ?? 'O'} da səni seçmişdi — artıq məşq yoldaşısınız` : 'Təklif göndərildi',
    });
  } catch (e) {
    return fail(e, { status: null, matched: false });
  }
}

async function readMyMatchRequests(a) {
  // app: src/lib/api.ts:1228
  const me = await readMyProfile(a);
  if (!me) return [];
  // app: src/lib/api.ts:1230-1233
  const { data, error } = await a.client
    .from('match_requests')
    .select('from_profile,to_profile,status,note')
    .or(`from_profile.eq.${me.id},to_profile.eq.${me.id}`);
  if (error) throw error;
  return mapMatchRows(data ?? [], me.id);
}

/**
 * The next launch's partner sync (bootstrap → getMatchRequestsSafe →
 * reconcileMatches). The read has no ORDER BY and the device keys the rows by
 * the other person, so when two rows share a partner the last one wins. The
 * state is computed for the order the server returned AND for the reverse, so a
 * state that depends on row order shows up. `apply: false` leaves the device as
 * it is (a look at what a relaunch would show, without relaunching).
 */
export async function launchMatchSync(a, { apply = true } = {}) {
  try {
    // app: src/store/appStore.ts:323-324
    const rows = await readMyMatchRequests(a);
    const before = a.db.matches;
    const matches = reconcileMatches(before, rows);
    const altMatches = reconcileMatches(before, [...rows].reverse());
    if (apply) a.db.matches = matches;
    return ok(rows, { rows, matches, altMatches });
  } catch (e) {
    return fail(e);
  }
}

/**
 * «Təkliflər» (chat/requests.tsx load): the pending offers TO me, then the
 * answers to the offers I sent — which the device applies (an accepted answer
 * opens the match, a vanished row is forgotten). A sender outside this run is
 * counted and never resolved to a name.
 */
export async function openRequestsScreen(a, simIds) {
  try {
    // app: src/app/chat/requests.tsx:101
    const me = await readMyProfile(a);
    if (!me) return fail(new Error('no profile'));
    // app: src/app/chat/requests.tsx:109-114
    const { data, error } = await a.client
      .from('match_requests')
      .select('id,from_profile,created_at,note')
      .eq('to_profile', me.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return fail(error, { shown: 'yüklənmədi' });
    const all = data ?? [];
    const rows = simIds ? all.filter((r) => simIds.has(r.from_profile)) : all;
    // The name is getPartner() per card: its own getMyProfile() (auth.getUser +
    // own profile), then the sender's profile. A TEST sender has no home gym and
    // neither has the reader, so activeProfileIdsAtGym (api.ts:639) is skipped and
    // gymGapKm (api.ts:473) returns before any read — neither makes a request.
    // mirrors: src/app/chat/requests.tsx:125-129
    const resolved = await Promise.all(
      rows.map(async (r) => {
        let name = null;
        try {
          // app: src/lib/api.ts:631
          const mine = await readMyProfile(a);
          // app: src/lib/api.ts:632
          const { data: p, error: pErr } = await a.client.from('profiles').select(PROFILE_COLS).eq('id', r.from_profile).maybeSingle();
          if (pErr) throw pErr;
          // mirrors: src/lib/api.ts:637
          const listable = !!p && (p.show_in_gym_list !== false || p.id === mine?.id);
          // mirrors: src/lib/api.ts:552
          name = listable ? (p.name ?? 'İstifadəçi') : null;
        } catch {
          // requests.tsx: getPartner(...).catch(() => null)
          name = null;
        }
        return { id: r.id, fromProfile: r.from_profile, at: r.created_at, note: r.note ?? null, name };
      })
    );
    // app: src/app/chat/requests.tsx:135-137
    const local = a.db.matches;
    const incoming = resolved.filter((r) => local[r.fromProfile]?.state !== 'declined');
    const hidden = resolved.filter((r) => local[r.fromProfile]?.state === 'declined');
    // app: src/app/chat/requests.tsx:151-157
    const { data: mine, error: mineErr } = await a.client
      .from('match_requests')
      .select('to_profile,status,created_at')
      .eq('from_profile', me.id)
      .order('created_at', { ascending: true });
    if (mineErr) return ok(null, { incoming, hidden, foreign: all.length - rows.length, outgoing: null, closed: [], outError: errInfo(mineErr) });
    // mirrors: src/app/chat/requests.tsx:159-178
    const byId = new Map((mine ?? []).map((r) => [r.to_profile, r.status]));
    const outgoing = {};
    const closed = [];
    for (const m of Object.values({ ...a.db.matches })) {
      if (m.state !== 'requested' || !UUID_RE.test(m.partnerId)) continue;
      const status = byId.get(m.partnerId);
      if (status === 'accepted') {
        acceptLocal(a, m.partnerId);
        closed.push(m.partnerId);
      } else if (status === 'declined') outgoing[m.partnerId] = 'declined';
      else if (status === 'pending') outgoing[m.partnerId] = 'pending';
      else forgetOutgoing(a, m.partnerId);
    }
    return ok(null, { incoming, hidden, foreign: all.length - rows.length, outgoing, closed });
  } catch (e) {
    return fail(e);
  }
}

/** «Qəbul et» on an incoming offer (requests.tsx accept): the server first, the
 *  device either way; then the chat screen opens (the scenario opens it). */
export async function acceptMatchRequest(a, row) {
  let delivered = false;
  let error = null;
  try {
    // app: src/app/chat/requests.tsx:228-232
    const { data, error: e } = await a.client
      .from('match_requests')
      .update({ status: 'accepted' })
      .eq('id', row.id)
      .select('id');
    delivered = !e && !!data?.length;
    error = e ? errInfo(e) : null;
  } catch (e) {
    delivered = false;
    error = errInfo(e);
  }
  // app: src/app/chat/requests.tsx:237
  acceptLocal(a, row.fromProfile);
  return {
    ok: delivered,
    rows: null,
    error: delivered ? null : (error ?? { message: 'zero rows came back' }),
    delivered,
    shown: delivered ? 'Təklif qəbul edildi' : 'Qəbul bu cihazda qeyd olundu — qarşı tərəfə hələ çatmayıb',
  };
}

// ======================================================== NOT app calls ====
// Everything below is either an adversarial probe (what someone holding the
// same public key could send by hand) or the harness's own bookkeeping.

/** Probe: run any read as this actor and report how many rows RLS let through. */
export async function probeRead(a, build) {
  try {
    const { data, error } = await build(a.client);
    if (error) return fail(error, { count: 0, refused: true });
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return ok(rows, { count: rows.length, refused: false });
  } catch (e) {
    return fail(e, { count: 0, refused: true });
  }
}

/** Bookkeeping: a head-only COUNT as this actor — no row content comes back, so
 *  rows other people own can be counted without being read. */
export async function probeCount(a, build) {
  try {
    const { count, error } = await build(a.client);
    if (error) return fail(error, { count: null });
    return ok(null, { count: count ?? 0 });
  } catch (e) {
    return fail(e, { count: null });
  }
}

/** Probe: run any write as this actor; zero rows back = RLS filtered it. */
export async function probeWrite(a, build) {
  try {
    const { data, error } = await build(a.client);
    if (error) return fail(error, { count: 0, refused: true });
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return ok(rows, { count: rows.length, refused: rows.length === 0 });
  } catch (e) {
    return fail(e, { count: 0, refused: true });
  }
}

/** Probe: the app's review payload with a forged official reply bolted on. */
export async function probeForgedReview(a, gymId) {
  try {
    const me = await readMyProfile(a);
    if (!me?.id) return fail(new Error('no-profile'));
    const { error } = await a.client.from('reviews').insert({
      gym_id: gymId,
      author_id: me.id,
      name: a.store.profile.name,
      tenure: '99 check-in edib',
      rating: 5,
      body: 'TEST forged review',
      reply: 'TEST forged owner reply',
      reply_at: new Date().toISOString(),
    });
    if (error) return fail(error, { refused: true });
    return ok(null, { refused: false });
  } catch (e) {
    return fail(e, { refused: true });
  }
}

/** Harness guard before any request reaches the owner's phone: the trainer
 *  listing must be public and belong to the expected @username. */
export async function probePhoneTrainer(a, trainerId) {
  try {
    const { data: t, error } = await a.client.from('trainers').select('id,name,owner_id,listed').eq('id', trainerId).maybeSingle();
    if (error) return fail(error);
    if (!t) return fail(new Error('no such trainer listing'));
    return ownerOf(a, t.owner_id, { listed: !!t.listed });
  } catch (e) {
    return fail(e);
  }
}

/** Same guard for the phone's gym, BEFORE any check-in is sent with the code:
 *  a code cannot be pre-validated (gym_checkin_codes is owner-only), so the gym
 *  it must open is named on the command line and its owner is proven here. */
export async function probePhoneGym(a, gymId) {
  try {
    const { data: g, error } = await a.client.from('gyms').select('id,name,owner_id,listed').eq('id', gymId).maybeSingle();
    if (error) return fail(error);
    // gyms_read hides an unlisted gym from everybody but its owner.
    if (!g) return fail(new Error('gym not visible to members (unlisted, or no such id)'));
    return ownerOf(a, g.owner_id, { listed: !!g.listed, gymName: g.name ?? null });
  } catch (e) {
    return fail(e);
  }
}

/** Owner handle of a listing. A profile hidden from member lists
 *  (show_in_gym_list off, profiles_read) comes back as no row and no error —
 *  reported as `ownerUnreadable`, not as «somebody else's». */
async function ownerOf(a, ownerId, extra) {
  if (!ownerId) return ok(null, { ...extra, ownerUsername: null, ownerProfileId: null, ownerUnreadable: false });
  const { data: p, error: pErr } = await a.client.from('profiles').select('id,username').eq('id', ownerId).maybeSingle();
  if (pErr) return fail(pErr);
  return ok(null, { ...extra, ownerUsername: p?.username ?? null, ownerProfileId: ownerId, ownerUnreadable: !p });
}

/** Probe: the stateless JWT of a deleted account must no longer resolve to a user. */
export async function probeAuthUserGone(a, accessToken) {
  try {
    const { data, error } = await a.client.auth.getUser(accessToken);
    return ok(null, { gone: !!error || !data?.user, error: errInfo(error) });
  } catch (e) {
    return ok(null, { gone: true, error: errInfo(e) });
  }
}

/**
 * Bookkeeping: what this actor owns right now, read as itself (RLS applies).
 * Only this run's rows are listed — anything addressed to the actor by a real
 * person is counted, not read.
 */
export async function inventory(a, simIds) {
  const out = {};
  const note = (k, r) => {
    out[k] = r.error ? { error: r.error.message } : r.value;
  };
  const q = async (build, pick) => {
    try {
      const { data, error } = await build(a.client);
      if (error) return { error: errInfo(error) };
      return { value: pick(data ?? []) };
    } catch (e) {
      return { error: errInfo(e) };
    }
  };
  const pid = a.profileId;
  const uid = a.userId;
  const sim = [...(simIds ?? [])];
  note('profile', await q((c) => c.from('profiles').select('id,name,username').eq('user_id', uid), (d) => d.map((r) => r.id)));
  if (!pid) return out;
  note('trainers', await q((c) => c.from('trainers').select('id').eq('owner_id', pid), (d) => d.map((r) => r.id)));
  note('trainer_verifications', await q((c) => c.from('trainer_verifications').select('id').eq('user_id', uid), (d) => d.map((r) => r.id)));
  note('gyms', await q((c) => c.from('gyms').select('id,name,listed').eq('owner_id', pid), (d) => d.map((r) => r.id)));
  if (a.gymId) {
    note('gym_checkin_codes', await q((c) => c.from('gym_checkin_codes').select('gym_id').eq('gym_id', a.gymId), (d) => d.map((r) => r.gym_id)));
  }
  note('check_ins', await q((c) => c.from('check_ins').select('id,gym_id').eq('profile_id', pid), (d) => d.map((r) => r.id)));
  note('day_passes', await q((c) => c.from('day_passes').select('id,gym_id,status').eq('user_id', uid), (d) => d.map((r) => r.id)));
  note('programs', await q((c) => c.from('programs').select('id').eq('owner_id', pid), (d) => d.map((r) => r.id)));
  note('trainer_requests_sent', await q((c) => c.from('trainer_requests').select('id').eq('from_profile', pid), (d) => d.map((r) => r.id)));
  if (a.trainerId && sim.length) {
    note('trainer_requests_received', await q((c) => c.from('trainer_requests').select('id').eq('trainer_id', a.trainerId).in('from_profile', sim), (d) => d.map((r) => r.id)));
  }
  note('student_programs', await q((c) => c.from('student_programs').select('id').in('student_id', sim), (d) => d.map((r) => r.id)));
  // Filtered server-side to threads between two actors of this run, so a real
  // person who wrote to a TEST trainer is never even returned.
  note('chat_threads', await q((c) => c.from('chat_threads').select('id').in('a_profile', sim).in('b_profile', sim), (d) => d.map((r) => r.id)));
  note('messages_sent', await q((c) => c.from('messages').select('id').eq('sender_id', pid), (d) => d.map((r) => r.id)));
  note('workouts', await q((c) => c.from('workouts').select('id').eq('profile_id', pid), (d) => d.map((r) => r.id)));
  note('prs', await q((c) => c.from('prs').select('id').eq('profile_id', pid), (d) => d.map((r) => r.id)));
  note('notifications', await q((c) => c.from('notifications').select('id').eq('profile_id', pid), (d) => d.map((r) => r.id)));
  // Social rows (social phase). delete_my_account() deletes the account's posts
  // and comments; post_likes, comment_likes, follows and match_requests cascade.
  note('community_posts', await q((c) => c.from('community_posts').select('id').eq('author_id', pid), (d) => d.map((r) => r.id)));
  note('comments', await q((c) => c.from('comments').select('id').eq('author_id', pid), (d) => d.map((r) => r.id)));
  note('post_likes', await q((c) => c.from('post_likes').select('post_id').eq('profile_id', pid), (d) => d.map((r) => r.post_id)));
  note('comment_likes', await q((c) => c.from('comment_likes').select('comment_id').eq('profile_id', pid), (d) => d.map((r) => r.comment_id)));
  note('follows', await q((c) => c.from('follows').select('followee_id').eq('follower_id', pid), (d) => d.map((r) => r.followee_id)));
  // Filtered server-side to requests between two actors of this run.
  note('match_requests', await q((c) => c.from('match_requests').select('id').in('from_profile', sim).in('to_profile', sim).or(`from_profile.eq.${pid},to_profile.eq.${pid}`), (d) => d.map((r) => r.id)));

  // Rows a REAL person addressed to this actor. delete_my_account() cascades
  // them away with the account (trainer_requests via trainers, chat_threads and
  // their messages, match_requests, follows, likes on its posts and comments),
  // so the report must say so — but only as a COUNT: head-only requests, no row
  // content ever comes back. A real person's COMMENT under a TEST post is worse:
  // comments.target_key is plain text with no foreign key, so it is not deleted
  // with the post — it stays behind, orphaned («_orphaned» in its name).
  const count = async (build) => {
    try {
      const { count: n, error } = await build(a.client);
      if (error) return { error: errInfo(error) };
      return { value: n ?? 0 };
    } catch (e) {
      return { error: errInfo(e) };
    }
  };
  const head = { count: 'exact', head: true };
  const notSim = `(${sim.join(',')})`;
  const foreign = {};
  if (sim.length) {
    if (a.trainerId) {
      foreign.trainer_requests = await count((c) => c.from('trainer_requests').select('id', head).eq('trainer_id', a.trainerId).not('from_profile', 'in', notSim));
    }
    // chat_threads_mine already limits this to my threads; minus the sim-to-sim ones.
    const mine = await count((c) => c.from('chat_threads').select('id', head));
    const simOnly = await count((c) => c.from('chat_threads').select('id', head).in('a_profile', sim).in('b_profile', sim));
    foreign.chat_threads = mine.error || simOnly.error ? { error: mine.error ?? simOnly.error } : { value: mine.value - simOnly.value };
    foreign.match_requests = await count((c) => c.from('match_requests').select('id', head).eq('to_profile', pid).not('from_profile', 'in', notSim));
    foreign.follows = await count((c) => c.from('follows').select('follower_id', head).eq('followee_id', pid).not('follower_id', 'in', notSim));
    const myPosts = Array.isArray(out.community_posts) ? out.community_posts : [];
    const myComments = Array.isArray(out.comments) ? out.comments : [];
    if (myPosts.length) {
      foreign.post_likes_on_my_posts = await count((c) => c.from('post_likes').select('post_id', head).in('post_id', myPosts).not('profile_id', 'in', notSim));
      foreign.comments_on_my_posts_orphaned = await count((c) => c.from('comments').select('id', head).in('target_key', myPosts.map(postKey)).not('author_id', 'in', notSim));
    }
    if (myComments.length) {
      foreign.comment_likes_on_my_comments = await count((c) => c.from('comment_likes').select('comment_id', head).in('comment_id', myComments).not('profile_id', 'in', notSim));
      foreign.replies_to_my_comments = await count((c) => c.from('comments').select('id', head).in('parent_id', myComments).not('author_id', 'in', notSim));
    }
  }
  out.foreign = Object.fromEntries(Object.entries(foreign).map(([k, r]) => [k, r.error ? { error: r.error.message } : r.value]));
  return out;
}

/**
 * After every actor deleted itself: read the PUBLIC listings with the bare key
 * (no session at all — what a logged-out phone sees) for anything of this run.
 */
export async function publicLeftovers(env, { runId, trainerIds, programIds, gymIds, handles = [], postIds = [], commentIds = [] }) {
  const bare = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `sb-sim-${runId}-bare` },
  });
  const read = async (label, build) => {
    try {
      const { data, error } = await build();
      if (error) return { label, error: errInfo(error), rows: [] };
      return { label, rows: data ?? [] };
    } catch (e) {
      return { label, error: errInfo(e), rows: [] };
    }
  };
  const like = `%${runId}%`;
  const out = [];
  if (trainerIds.length) out.push(await read('trainers by id', () => bare.from('trainers').select('id,name,listed').in('id', trainerIds)));
  out.push(await read('trainers by TEST name', () => bare.from('trainers').select('id,name,listed').ilike('name', like)));
  if (programIds.length) out.push(await read('programs by id', () => bare.from('programs').select('id,title').in('id', programIds)));
  out.push(await read('programs by TEST title', () => bare.from('programs').select('id,title').ilike('title', like)));
  // gyms_read hides an unlisted gym from the bare key, so 0 here proves nothing
  // about whether the row exists — the label says so, and the scenario reports
  // these as INFO, never as a clean-up proof.
  if (gymIds.length) out.push(await read('gyms by id (not verifiable with the public key: unlisted)', () => bare.from('gyms').select('id,name,listed').in('id', gymIds)));
  out.push(await read('gyms by TEST name (not verifiable with the public key: unlisted)', () => bare.from('gyms').select('id,name,listed').ilike('name', like)));
  if (gymIds.length) out.push(await read('reviews of TEST gyms', () => bare.from('reviews').select('id,gym_id').in('gym_id', gymIds)));
  // The social phase. community_posts, comments and comment_likes are readable
  // by anyone (their *_read policies), so the bare key CAN prove these are gone.
  // Only ids and keys are selected: a real person's orphaned comment under a
  // TEST post is found by its target_key, never read for its text or author.
  if (postIds.length) {
    out.push(await read('community posts by id', () => bare.from('community_posts').select('id').in('id', postIds)));
    out.push(await read('comments on TEST posts', () => bare.from('comments').select('id,target_key').in('target_key', postIds.map(postKey))));
  }
  out.push(await read('community posts by TEST author', () => bare.from('community_posts').select('id').ilike('author', like)));
  out.push(await read('community posts by TEST text', () => bare.from('community_posts').select('id').ilike('body', like)));
  out.push(await read('comments by TEST text', () => bare.from('comments').select('id').ilike('body', like)));
  if (commentIds.length) {
    out.push(await read('comments by id', () => bare.from('comments').select('id').in('id', commentIds)));
    out.push(await read('comment likes on TEST comments', () => bare.from('comment_likes').select('comment_id').in('comment_id', commentIds)));
  }
  // The profiles themselves: profiles_read needs is_registered(), so the bare
  // key cannot list them — but username_taken() is SECURITY DEFINER and anon may
  // call it, so every handle this run held must now answer false.
  for (const h of [...new Set(handles)].filter(Boolean)) {
    const r = await read(`username @${h}`, async () => {
      const { data, error } = await bare.rpc('username_taken', { p_username: h });
      return { data: data === true ? [{ username: h }] : [], error };
    });
    out.push({ ...r, kind: 'username' });
  }
  return out;
}
