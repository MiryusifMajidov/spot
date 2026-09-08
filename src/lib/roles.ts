/**
 * Role APIs — the REAL trainer↔student and gym-owner data.
 *
 * There are no payments in SPOT, so a "student" is not a purchase: it is an
 * accepted training request. A gym's members and occupancy are derived from
 * real profiles and check-ins — never invented. The privacy red line holds:
 * nothing here reads workouts, weights, progress photos or messages.
 *
 * Requires supabase/schema6_trainer_students.sql.
 */
import { getMyProfile } from './api';
import { supabase } from './supabase';

// ---------------------------------------------------------------- trainer ----
export interface TrainerRequestRow {
  id: string;
  trainer_id: string;
  from_profile: string;
  note: string | null;
  preferred_time: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'ended';
  created_at: string;
}

export interface StudentRow {
  requestId: string;
  profileId: string;
  name: string;
  age: number | null;
  level: string | null;
  goals: string[];
  homeGymId: string | null;
  note: string | null;
  preferredTime: string | null;
  status: TrainerRequestRow['status'];
  since: string;
  programTitle: string | null;
  programNote: string | null;
}

/** The trainer profile owned by the current user (null if they are not a trainer). */
export async function getMyTrainerId(): Promise<string | null> {
  const me = await getMyProfile();
  if (!me) return null;
  // Deterministic, like `getMyGymId` below and for the same reason: `.maybeSingle()`
  // errors (PGRST116) the moment an account owns two trainer rows, and that error
  // reached the panel as «Yüklənmədi» — the whole trainer account looked broken
  // while the network was fine. It happened for real: a profile merge left a
  // second listing whose id belonged to a deleted profile.
  //
  // A trainer row's id IS its owner's profile id (`becomeTrainer` upserts
  // `{ id: me.id }`), so prefer that row; anything else is a leftover.
  const { data, error } = await supabase
    .from('trainers')
    .select('id')
    .eq('owner_id', me.id)
    .order('id', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as { id: string }[];
  if (!rows.length) return null;
  return rows.find((r) => r.id === me.id)?.id ?? rows[0].id;
}

/** A user asks a trainer to train them. Creates the row the trainer will see.
 *
 *  A trainer row with no `owner_id` belongs to nobody: RLS (`owns_trainer`) makes
 *  the request unreadable and unanswerable by every account in the system, so the
 *  user would wait forever for a reply that cannot come. Refuse instead of writing
 *  a row nobody can ever see — the caller turns `trainer-inactive` into an honest
 *  message rather than «yenidən cəhd et». */
export async function requestTrainer(trainerId: string, note: string, preferredTime: string): Promise<void> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  const { data: t, error: tErr } = await supabase
    .from('trainers')
    .select('owner_id')
    .eq('id', trainerId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!(t as { owner_id: string | null } | null)?.owner_id) throw new Error('trainer-inactive');
  const { data, error } = await supabase
    .from('trainer_requests')
    .upsert(
      { trainer_id: trainerId, from_profile: me.id, note, preferred_time: preferredTime, status: 'pending' },
      { onConflict: 'trainer_id,from_profile' }
    )
    .select('id');
  if (error) throw error;
  // «Sorğu göndərildi» may only be said about a row that exists.
  if (!data?.length) throw new Error('request-not-sent');
}

/** My own outgoing request to a given trainer, so the UI can show its state. */
export async function getMyRequestTo(trainerId: string): Promise<TrainerRequestRow | null> {
  const me = await getMyProfile();
  if (!me) return null;
  const { data, error } = await supabase
    .from('trainer_requests')
    .select('*')
    .eq('trainer_id', trainerId)
    .eq('from_profile', me.id)
    .maybeSingle();
  if (error) throw error;
  return (data as TrainerRequestRow | null) ?? null;
}

/** Everyone who asked to train with me, and everyone I accepted. */
export async function getMyStudents(): Promise<{ pending: StudentRow[]; active: StudentRow[] }> {
  const trainerId = await getMyTrainerId();
  if (!trainerId) return { pending: [], active: [] };

  const { data: reqs, error: reqErr } = await supabase
    .from('trainer_requests')
    .select('*')
    .eq('trainer_id', trainerId)
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false });
  // «Hələ şagirdin yoxdur» must mean zero rows, never a failed read.
  if (reqErr) throw reqErr;
  const rows = (reqs ?? []) as TrainerRequestRow[];
  if (!rows.length) return { pending: [], active: [] };

  const ids = rows.map((r) => r.from_profile);
  const [{ data: profs, error: pErr }, { data: progs, error: progErr }] = await Promise.all([
    supabase.from('profiles').select('id,name,age,level,goals,home_gym_id').in('id', ids),
    supabase.from('student_programs').select('student_id,title,note').eq('trainer_id', trainerId).in('student_id', ids),
  ]);
  // Without these we would draw every student as «İstifadəçi» with no program —
  // a made-up roster. Fail loudly instead.
  if (pErr) throw pErr;
  if (progErr) throw progErr;

  type P = { id: string; name: string | null; age: number | null; level: string | null; goals: string[] | null; home_gym_id: string | null };
  type SP = { student_id: string; title: string | null; note: string | null };
  const pMap = new Map(((profs ?? []) as P[]).map((p) => [p.id, p]));
  const progMap = new Map(((progs ?? []) as SP[]).map((p) => [p.student_id, p]));

  const map = (r: TrainerRequestRow): StudentRow => {
    const p = pMap.get(r.from_profile);
    const prog = progMap.get(r.from_profile);
    return {
      requestId: r.id,
      profileId: r.from_profile,
      name: p?.name ?? 'İstifadəçi',
      age: p?.age ?? null,
      level: p?.level ?? null,
      goals: p?.goals ?? [],
      homeGymId: p?.home_gym_id ?? null,
      note: r.note,
      preferredTime: r.preferred_time,
      status: r.status,
      since: r.created_at,
      programTitle: prog?.title ?? null,
      programNote: prog?.note ?? null,
    };
  };

  return {
    pending: rows.filter((r) => r.status === 'pending').map(map),
    active: rows.filter((r) => r.status === 'accepted').map(map),
  };
}

/** Trainer accepts or declines a request.
 *
 *  The returned row is the proof. An UPDATE that RLS filters out returns
 *  `error: null` and zero rows — so without `.select()` this function reported
 *  success for a decision the database refused, and the student was left waiting
 *  for an answer the trainer believed they had sent. `decided_at` is set by the
 *  database (schema28), not passed from here: a decision's timestamp should be
 *  the moment it was recorded, not whatever the phone's clock said. */
export async function decideTrainerRequest(requestId: string, accept: boolean): Promise<void> {
  const { data, error } = await supabase
    .from('trainer_requests')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', requestId)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('request-not-updated');
}

/** Trainer assigns / updates the program for one student — the real value they add. */
export async function assignStudentProgram(input: {
  studentId: string;
  programId?: string | null;
  title: string;
  note: string;
}): Promise<void> {
  const trainerId = await getMyTrainerId();
  if (!trainerId) throw new Error('not a trainer');
  // Same rule as the decision above: a filtered-out upsert is silent, and
  // «Proqram təyin edildi» about a row that never landed is the worst kind of
  // lie here — the student opens their workout tab and finds nothing.
  const { data, error } = await supabase
    .from('student_programs')
    .upsert(
      {
        trainer_id: trainerId,
        student_id: input.studentId,
        program_id: input.programId ?? null,
        title: input.title,
        note: input.note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'trainer_id,student_id' }
    )
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('program-not-saved');
}

/** The program my trainer assigned to me (shown on the user's workout screen). */
export interface AssignedProgram {
  title: string;
  note: string | null;
  trainerId: string;
  trainerName: string | null;
  programId: string | null;
}

/** The program a trainer assigned to this student, newest first.
 *  Throws on a real query failure so the caller can say "could not load"
 *  instead of rendering "no trainer has assigned you anything". */
export async function getMyAssignedProgram(): Promise<AssignedProgram | null> {
  const me = await getMyProfile();
  if (!me) return null;
  const { data, error } = await supabase
    .from('student_programs')
    .select('title,note,trainer_id,program_id')
    .eq('student_id', me.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const d = data as { title: string; note: string | null; trainer_id: string; program_id: string | null };

  // The trainer's name is a separate read; a failure there must not hide the
  // assignment itself, so it degrades to null rather than throwing.
  let trainerName: string | null = null;
  try {
    const { data: t } = await supabase.from('trainers').select('name').eq('id', d.trainer_id).maybeSingle();
    trainerName = (t as { name?: string } | null)?.name ?? null;
  } catch {
    /* name is optional */
  }

  return { title: d.title, note: d.note, trainerId: d.trainer_id, trainerName, programId: d.program_id };
}

// -------------------------------------------------------------------- gym ----
export interface GymMemberRow {
  profileId: string;
  name: string;
  level: string | null;
  goals: string[];
  lastCheckIn: string | null;
  checkIns30d: number;
}

/** The gym owned by the current user (null if they own none).
 *
 *  Deterministic on purpose: a profile that ended up owning two gyms rows used to
 *  make `.maybeSingle()` return PGRST116, and the discarded error was rendered as
 *  «Bu hesaba bağlı zal yoxdur» — the panel was then dead forever. `order + limit(1)`
 *  makes the multi-row branch unreachable, and a real failure is thrown so the
 *  caller can say "gətirilə bilmədi" instead of "yoxdur".
 *  (`gyms` has no created_at column, so the primary key is the stable sort key.) */
export async function getMyGymId(): Promise<string | null> {
  const me = await getMyProfile();
  if (!me) return null;
  const { data, error } = await supabase
    .from('gyms')
    .select('id')
    .eq('owner_id', me.id)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

/** Members = profiles whose home gym this is, enriched with real check-in counts. */
export async function getGymMembers(gymId: string): Promise<GymMemberRow[]> {
  const { data: profs, error: pErr } = await supabase
    .from('profiles')
    .select('id,name,level,goals')
    .eq('home_gym_id', gymId);
  // «ÜZVLƏR 0» is a measurement; a failed read is not. Throw so the panel can
  // render its «yüklənmədi» notice instead of an invented zero.
  if (pErr) throw pErr;
  type P = { id: string; name: string | null; level: string | null; goals: string[] | null };
  const rows = (profs ?? []) as P[];
  if (!rows.length) return [];

  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: cis, error: ciErr } = await supabase
    .from('check_ins')
    .select('profile_id,created_at')
    .eq('gym_id', gymId)
    .gt('created_at', since);
  if (ciErr) throw ciErr;

  const counts = new Map<string, { n: number; last: string }>();
  for (const c of (cis ?? []) as { profile_id: string; created_at: string }[]) {
    const cur = counts.get(c.profile_id);
    if (!cur) counts.set(c.profile_id, { n: 1, last: c.created_at });
    else counts.set(c.profile_id, { n: cur.n + 1, last: c.created_at > cur.last ? c.created_at : cur.last });
  }

  return rows.map((p) => ({
    profileId: p.id,
    name: p.name ?? 'Üzv',
    level: p.level,
    goals: p.goals ?? [],
    lastCheckIn: counts.get(p.id)?.last ?? null,
    checkIns30d: counts.get(p.id)?.n ?? 0,
  }));
}

/** Real occupancy: who is checked in right now + today's check-ins by hour. */
/** Azerbaijan is UTC+4 all year. The occupancy chart is about the gym's clock,
 *  not the phone's: a device left on the wrong time zone would otherwise bucket
 *  every check-in into the wrong hour and start "today" at the wrong moment.
 *  Same anchor the gym day uses in src/store/db.ts. */
const BAKU_OFFSET_MS = 4 * 3_600_000;
const bakuHour = (iso: string) => new Date(new Date(iso).getTime() + BAKU_OFFSET_MS).getUTCHours();

export async function getGymOccupancy(gymId: string): Promise<{ now: number; byHour: number[]; today: number }> {
  // Midnight in Baku, expressed as a real instant.
  const nowMs = Date.now();
  const baku = new Date(nowMs + BAKU_OFFSET_MS);
  const startOfDay = new Date(
    Date.UTC(baku.getUTCFullYear(), baku.getUTCMonth(), baku.getUTCDate()) - BAKU_OFFSET_MS
  );
  const { data, error } = await supabase
    .from('check_ins')
    .select('created_at,expires_at')
    .eq('gym_id', gymId)
    .gt('created_at', startOfDay.toISOString());
  // «İNDİ ZALDA 0 · bugün check-in yoxdur» may only be said about rows we read.
  if (error) throw error;

  const rows = (data ?? []) as { created_at: string; expires_at: string | null }[];
  const byHour: number[] = new Array(24).fill(0);
  const nowIso = new Date().toISOString();
  let now = 0;
  for (const r of rows) {
    byHour[bakuHour(r.created_at)] += 1;
    if (!r.expires_at || r.expires_at > nowIso) now += 1;
  }
  return { now, byHour, today: rows.length };
}

/** Day-passes recorded for this gym. Display-only money — SPOT charges nothing. */
export async function getGymDayPasses(gymId: string): Promise<{ live: number; usedToday: number }> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from('day_passes')
    .select('status,expires_at,used_at')
    .eq('gym_id', gymId)
    .gte('purchased_at', dayStart.toISOString());
  // Otherwise «Hələ day-pass qeydə alınmayıb» would be printed over a read that failed.
  if (error) throw error;

  // This used to be one all-time count of every pass ever created, under the
  // label «Qeydə alınan day-pass». Nothing expires a pass, so that number only
  // ever grew and told the owner nothing about today — the same reason schema58
  // removed `daypass_active` from the admin dashboard. Two numbers an owner can
  // act on replace it: how many passes are live right now, and how many were
  // actually honoured at the door today.
  const now = Date.now();
  const rows = (data ?? []) as { status: string; expires_at: string | null; used_at: string | null }[];
  return {
    live: rows.filter((r) => r.status === 'active' && r.expires_at && Date.parse(r.expires_at) > now).length,
    usedToday: rows.filter((r) => r.status === 'used').length,
  };
  // Still a COUNT, never a sum. This used to also return `total` — the day-pass
  // prices added up — which is an earnings figure for the gym owner. SPOT
  // surfaces no revenue anywhere.
}

export type PassCheck = {
  state: 'valid' | 'used' | 'expired' | 'refunded' | 'not_found' | 'redeemed';
  gym_id?: string;
  price?: number;
  purchased_at?: string;
  expires_at?: string;
  used_at?: string;
};

/** Look a day-pass code up at a gym the caller owns. Changes nothing.
 *  Returns the pass state and NOTHING about the visitor — reception needs to
 *  know the code is good, not who is holding it. */
export async function checkDayPass(code: string): Promise<PassCheck> {
  const { data, error } = await supabase.rpc('check_day_pass', { p_code: code });
  if (error) throw error;
  return (data ?? { state: 'not_found' }) as PassCheck;
}

/** Mark a day-pass honoured at the door. One-way, owner-only. */
export async function redeemDayPass(code: string): Promise<PassCheck> {
  const { data, error } = await supabase.rpc('redeem_day_pass', { p_code: code });
  if (error) throw error;
  return (data ?? { state: 'not_found' }) as PassCheck;
}
