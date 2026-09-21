/**
 * Writing a program — the one path, used by both «Yarat» and «Yadda saxla».
 *
 * Editing used to land only on the device: `useDb.updateProgram` writes to
 * zustand/AsyncStorage and nothing sent the change up, so an author who fixed a
 * typo in a program other people were following fixed it for themselves alone.
 * Create and edit now go through the same function and report the same three
 * outcomes, honestly:
 *
 *   'saved'   — the server has it.
 *   'local'   — the device has it, the server does not, and the caller SAYS so.
 *   'refused' — the server READ it and said no (schema76), with a reason.
 *   'failed'  — nothing was written anywhere.
 *
 * 'refused' is separate from 'local' on purpose. Both mean «not on the server»,
 * but 'local' is a connection that will work later and 'refused' is a program
 * that will never save until something in it changes. Telling somebody their
 * work is «hələlik bu cihazda» when in fact a video URL was rejected sends them
 * to retry forever.
 */
import { Program } from '@/data/types';
import { getMyProfile } from '@/lib/api';
import { estimateDuration } from '@/lib/duration';
import { mapProgram } from '@/lib/programMap';
import { t } from '@/lib/i18n';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { exerciseLibrary, useDb } from '@/store/db';
import { DraftDay, draftDaysForSave, itemReps } from '@/store/programDraft';

/** Library ids, looked up once. */
const LIBRARY_IDS = new Set(exerciseLibrary.map((e) => e.id));

export type SaveResult = 'saved' | 'local' | 'failed' | 'refused';

export interface SaveOutcome {
  result: SaveResult;
  id: string;
  /** Set only for 'refused': what the server objected to, in Azerbaijani. */
  problem?: string;
}

/** Rough minutes for one day's work. Rendered as «~X dəq», never as a fact.
 *  Delegates, so a program cannot be «~45 dəq» on the save toast and «~38 dəq»
 *  on the screen that opens it. */
export function estimateMinutes(days: DraftDay[]): number {
  const day = days.find((d) => d.items.length > 0);
  if (!day) return 0;
  return estimateDuration(day.items.map((it) => ({ sets: it.sets, reps: itemReps(it) })));
}

/** The Program the device keeps, built from the draft. */
function toLocalProgram(input: {
  title: string;
  desc: string;
  days: DraftDay[];
  creatorName: string;
  creatorType: 'trainer' | 'user';
}): Omit<Program, 'id'> & { desc: string } {
  const built = draftDaysForSave(input.days);
  const all = input.days.flatMap((d) => d.items);
  return {
    desc: input.desc.trim(),
    title: input.title.trim(),
    creatorName: input.creatorName,
    creatorType: input.creatorType,
    creatorVerified: false,
    weeks: 0,
    daysPerWeek: built.length,
    level: '' as Program['level'],
    goal: '',
    paid: false,
    rating: 0,
    minutes: estimateMinutes(input.days),
    // Clips the AUTHOR actually uploaded. The old expression counted library
    // membership, so a six-move program was saved as «6 video» while the
    // library holds an empty videoUrl for every single move.
    videoCount: all.filter((it) => !!it.videoUrl).length,
    doneBy: 0,
    tags: [],
    saves: 0,
    days: input.days
      .filter((d) => d.items.length > 0)
      .map((d, i) => ({
        title: d.title.trim() || `Gün ${i + 1}`,
        focus: built[i]?.focus ?? '',
        exercises: d.items.map((it) => ({
          id: it.exerciseId ?? `own-${it.name.trim().toLowerCase().replace(/\s+/g, '-')}`,
          name: it.name.trim(),
          muscle: it.muscle,
          sets: it.sets,
          reps: itemReps(it),
          videoUrl: it.videoUrl,
          commonMistake: '',
          substitutes: [],
        })),
      })),
  };
}

/**
 * Save a draft. `editingId` null creates; otherwise it updates that program.
 *
 * The device copy is written first and deliberately: a program must be runnable
 * with no signal. The server write decides whether the result is 'saved' or
 * 'local', and 'failed' is reserved for the case where even the device refused.
 */
export async function saveProgramDraft(input: {
  editingId: string | null;
  title: string;
  desc: string;
  days: DraftDay[];
  creatorName: string;
  creatorType: 'trainer' | 'user';
}): Promise<SaveOutcome> {
  const program = toLocalProgram(input);
  const wireDays = draftDaysForSave(input.days);

  let id: string;
  try {
    if (input.editingId) {
      useDb.getState().updateProgram(input.editingId, program);
      id = input.editingId;
    } else {
      id = useDb.getState().createProgram(program);
    }
  } catch {
    return { result: 'failed', id: input.editingId ?? '' };
  }

  if (!hasSupabaseConfig) return { result: 'local', id };

  /* `creator_verified`, `rating`, `done_by` and `saves` are never written:
     schema34 withholds them from every client, because a program's badge and
     its popularity are not the author's to declare — and the library sorts by
     `saves`, so a self-assigned number would buy the top of the list. */
  const base = {
    title: program.title,
    weeks: program.weeks,
    days_per_week: program.daysPerWeek,
    /* NULL, never ''. schema16 pins `programs_level_check` to NULL or one of
       'Başlanğıc' | 'Orta' | 'İrəli', and the builder no longer asks for a level
       — so the empty string it used to send was refused by the database on EVERY
       save, create and edit alike. Each one fell into the catch below and came
       back as 'local': not one program written with this builder ever reached
       the server, and the toast said «yalnız bu cihazda» about a write that could
       never succeed. The round-trip «proof» in schema76 inserted rows without a
       level column at all, which is why it passed while the app failed. */
    level: program.level || null,
    goal: program.goal || null,
    paid: false,
    minutes: program.minutes,
    video_count: program.videoCount,
    tags: program.tags,
    days: wireDays,
    description: program.desc || null,
  };

  try {
    if (input.editingId) {
      /* `.select('id')` is not decoration. An RLS-filtered UPDATE returns
         `error: null` and ZERO rows — PostgREST does not throw — so without the
         returned row an edit refused by the owner policy would have toasted
         «saxlanıldı» over a server copy that never changed. */
      const { data, error } = await supabase
        .from('programs')
        .update(base)
        .eq('id', input.editingId)
        .select('id');
      if (error) throw error;
      if (data?.length) return { result: 'saved', id };
      /* Zero rows has two meanings, and until now both were answered 'local':
         (a) the owner policy refused it — somebody else's program; or
         (b) there is no row yet — a program that has only ever lived on this
             phone because its first save could not reach the server.
         (b) is not rare: before `level` was sent as NULL, EVERY program saved
         with this builder was refused, so every one of them is in state (b).
         Re-saving was the only fix the app suggested and it could never work,
         because an UPDATE cannot create a row. Try the insert; a unique
         violation means the row exists after all and is not ours. */
      return await insertProgram(id, base, program);
    }

    return await insertProgram(id, base, program);
  } catch (e) {
    const problem = dayProblemMessage((e as { message?: string })?.message ?? '');
    if (problem) return { result: 'refused', id, problem };
    return { result: 'local', id };
  }
}

/**
 * The INSERT half, shared by a first save and by an edit whose row turned out
 * not to exist yet. Throws on a real error so the caller's catch can tell a
 * schema76 refusal from a connection problem.
 */
async function insertProgram(
  id: string,
  base: Record<string, unknown>,
  program: { creatorName: string; creatorType: 'trainer' | 'user' | 'spot' }
): Promise<SaveOutcome> {
  // owner_id is a FK to profiles(id) — NOT the auth uid — and schema34's insert
  // policy REQUIRES it. An ownerless program can never be edited by anybody,
  // including its author, so no profile means no server copy.
  const me = await getMyProfile();
  if (!me?.id) return { result: 'local', id };

  const { error } = await supabase.from('programs').insert({
    ...base,
    id,
    creator_name: program.creatorName,
    creator_type: program.creatorType,
    owner_id: me.id,
  });
  if (error) {
    // 23505: the id is taken — the row exists and the owner policy is what
    // hid it from the UPDATE. It is not ours to write, so it stays local.
    if ((error as { code?: string }).code === '23505') return { result: 'local', id };
    throw error;
  }
  return { result: 'saved', id };
}

/**
 * Send up every program that exists only on this phone.
 *
 * Before `level` went out as NULL, every save from the builder was refused, so
 * the owner's whole library is device-only right now — no student can open an
 * assigned program and a reinstall would delete them. This runs on launch
 * (bootstrap) and quietly publishes what the author already chose to publish.
 * It asks the server which ids it has first, so a program that did make it up
 * is never written twice.
 */
export async function syncLocalPrograms(): Promise<{ sent: number; failed: number }> {
  if (!hasSupabaseConfig) return { sent: 0, failed: 0 };
  const mine = useDb.getState().myPrograms.filter((p) => (p.days ?? []).some((d) => (d.exercises?.length ?? 0) > 0));
  if (!mine.length) return { sent: 0, failed: 0 };

  const { data, error } = await supabase.from('programs').select('id').in('id', mine.map((p) => p.id));
  if (error) return { sent: 0, failed: 0 }; // not knowing is not a reason to write
  const onServer = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));

  let sent = 0;
  let failed = 0;
  for (const p of mine) {
    if (onServer.has(p.id)) continue;
    const days = p.days ?? [];
    const first = days.find((d) => (d.exercises?.length ?? 0) > 0);
    const base = {
      title: p.title,
      weeks: p.weeks || 0,
      days_per_week: days.filter((d) => (d.exercises?.length ?? 0) > 0).length,
      level: p.level || null,
      goal: p.goal || null,
      paid: false,
      minutes: first ? estimateDuration(first.exercises.map((e) => ({ sets: e.sets, reps: e.reps }))) : 0,
      video_count: days.reduce((a, d) => a + (d.exercises ?? []).filter((e) => !!e.videoUrl).length, 0),
      tags: p.tags ?? [],
      days: programDaysToWire(days),
      description: p.desc || null,
    };
    try {
      const r = await insertProgram(p.id, base, {
        creatorName: p.creatorName,
        creatorType: p.creatorType === 'trainer' ? 'trainer' : 'user',
      });
      if (r.result === 'saved') sent += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}

/**
 * Bring down the programs this account wrote, onto a phone that does not have
 * them — a new device, a reinstall, «Məlumatlarımı sil».
 *
 * `myPrograms` is device storage, and it is what «Proqramlarım», the trainer's
 * program list, the student-assignment picker and the «…» edit menu all read.
 * So on a second phone a trainer saw «Hələ proqram yaratmamısan» while every
 * program they had written sat on the server under their name, visible to
 * everyone else in the library — and with no edit menu, they could neither fix
 * nor delete their own work from anywhere. Only ids this phone lacks are added:
 * a local copy may hold an edit that has not gone up yet, and the server must
 * not overwrite it.
 */
export async function pullMyPrograms(): Promise<number> {
  if (!hasSupabaseConfig) return 0;
  const me = await getMyProfile();
  if (!me?.id) return 0;
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('owner_id', me.id)
    .is('hidden_at', null);
  if (error || !data?.length) return 0;
  const have = new Set(useDb.getState().myPrograms.map((p) => p.id));
  const fresh = (data as unknown[]).map(mapProgram).filter((p) => !have.has(p.id));
  for (const p of fresh) useDb.getState().createProgram(p);
  return fresh.length;
}

/** A local `Program['days']` in the shape schema76 stores. The inverse of
 *  `hooks.ts mapDayExercises`, so a day written by one path reads back the same
 *  through the other. */
export function programDaysToWire(days: Program['days']) {
  return (days ?? []).map((d, i) => ({
    title: d.title?.trim() || `Gün ${i + 1}`,
    focus: d.focus ?? '',
    items: (d.exercises ?? []).map((e) => ({
      name: e.name?.trim() ?? '',
      // Only a real library id travels as one. The mapper invents `own-…` for a
      // move the author typed, and sending that back would claim the library
      // has an entry it does not.
      exercise_id: LIBRARY_IDS.has(e.id) ? e.id : null,
      sets: e.sets,
      reps: e.reps ?? '',
      video_url: e.videoUrl ?? null,
    })),
    exercise_ids: (d.exercises ?? []).map((e) => e.id).filter((id) => LIBRARY_IDS.has(id)),
  }));
}

/**
 * Write a program's days — from anywhere that is not the builder.
 *
 * The exercise library's «proqrama əlavə et» called `useDb.updateProgram` and
 * stopped there, so an exercise added to a program that other people follow was
 * added on one phone only, under a toast that said it had worked. Same outcome
 * vocabulary as a full save, for the same reason.
 */
export async function saveProgramDays(programId: string, days: Program['days']): Promise<SaveOutcome> {
  try {
    useDb.getState().updateProgram(programId, {
      days,
      daysPerWeek: days.filter((d) => (d.exercises?.length ?? 0) > 0).length,
    });
  } catch {
    return { result: 'failed', id: programId };
  }

  if (!hasSupabaseConfig) return { result: 'local', id: programId };

  const first = days.find((d) => (d.exercises?.length ?? 0) > 0);
  try {
    const { data, error } = await supabase
      .from('programs')
      .update({
        days: programDaysToWire(days),
        days_per_week: days.filter((d) => (d.exercises?.length ?? 0) > 0).length,
        minutes: first
          ? estimateDuration(first.exercises.map((e) => ({ sets: e.sets, reps: e.reps })))
          : 0,
        video_count: days.reduce((a, d) => a + (d.exercises ?? []).filter((e) => !!e.videoUrl).length, 0),
      })
      .eq('id', programId)
      .select('id');
    if (error) throw error;
    // Zero rows: the owner policy refused it, and PostgREST does not throw.
    if (!data?.length) return { result: 'local', id: programId };
    return { result: 'saved', id: programId };
  } catch (e) {
    const problem = dayProblemMessage((e as { message?: string })?.message ?? '');
    if (problem) return { result: 'refused', id: programId, problem };
    return { result: 'local', id: programId };
  }
}

/** What the server refused, in Azerbaijani. The codes come from schema76. */
export function dayProblemMessage(raw: string): string | null {
  const m = String(raw ?? '').toLowerCase();
  if (m.includes('program_item_bad_video')) return t('Video SPOT-a yüklənməyib — yenidən əlavə et.');
  if (m.includes('program_item_unnamed')) return t('Adı olmayan hərəkət var — adını yaz və ya sil.');
  if (m.includes('program_item_name_long')) return t('Hərəkət adı çox uzundur (80 hərfə qədər).');
  if (m.includes('program_item_reps_long')) return t('Təkrar sahəsi çox uzundur.');
  if (m.includes('program_item_sets_range')) return t('Set sayı 1 ilə 20 arasında olmalıdır.');
  if (m.includes('program_too_many_items')) return t('Bir günə ən çoxu 40 hərəkət qoya bilərsən.');
  if (m.includes('program_too_many_days')) return t('Proqramda ən çoxu 14 gün ola bilər.');
  return null;
}
