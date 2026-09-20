/**
 * Writing a program — the one path, used by both «Yarat» and «Yadda saxla».
 *
 * Editing used to land only on the device: `useDb.updateProgram` writes to
 * zustand/AsyncStorage and nothing sent the change up, so an author who fixed a
 * typo in a program other people were following fixed it for themselves alone.
 * Create and edit now go through the same function and report the same three
 * outcomes, honestly:
 *
 *   'saved'  — the server has it.
 *   'local'  — the device has it, the server does not, and the caller SAYS so.
 *   'failed' — nothing was written anywhere.
 *
 * There is no fourth, quieter outcome. A write that did not happen never
 * reports success.
 */
import { Program } from '@/data/types';
import { getMyProfile } from '@/lib/api';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useDb } from '@/store/db';
import { DraftDay, draftDaysForSave, itemReps } from '@/store/programDraft';

export type SaveResult = 'saved' | 'local' | 'failed';

/** Rough minutes for one day's work. Rendered as «~X dəq», never as a fact. */
export function estimateMinutes(days: DraftDay[]): number {
  const day = days.find((d) => d.items.length > 0);
  if (!day) return 0;
  const min = day.items.reduce((a, it) => a + it.sets * (it.mode === 'time' ? 1.2 : 2.5), 0);
  return Math.max(10, Math.round(min + 5));
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
}): Promise<{ result: SaveResult; id: string }> {
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
    level: program.level,
    goal: program.goal,
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
      if (!data?.length) return { result: 'local', id };
      return { result: 'saved', id };
    }

    // owner_id is a FK to profiles(id) — NOT the auth uid — and schema34's
    // insert policy REQUIRES it. An ownerless program can never be edited by
    // anybody, including its author, so no profile means no server copy.
    const me = await getMyProfile();
    if (!me?.id) return { result: 'local', id };

    const { error } = await supabase.from('programs').insert({
      ...base,
      id,
      creator_name: program.creatorName,
      creator_type: program.creatorType,
      owner_id: me.id,
    });
    if (error) throw error;
    return { result: 'saved', id };
  } catch {
    return { result: 'local', id };
  }
}

/** What the server refused, in Azerbaijani. The codes come from schema76. */
export function dayProblemMessage(raw: string): string | null {
  const m = String(raw ?? '').toLowerCase();
  if (m.includes('program_item_bad_video')) return 'Video SPOT-a yüklənməyib — yenidən əlavə et.';
  if (m.includes('program_item_unnamed')) return 'Adı olmayan hərəkət var — adını yaz və ya sil.';
  if (m.includes('program_item_name_long')) return 'Hərəkət adı çox uzundur (80 hərfə qədər).';
  if (m.includes('program_item_reps_long')) return 'Təkrar sahəsi çox uzundur.';
  if (m.includes('program_item_sets_range')) return 'Set sayı 1 ilə 20 arasında olmalıdır.';
  if (m.includes('program_too_many_items')) return 'Bir günə ən çoxu 40 hərəkət qoya bilərsən.';
  if (m.includes('program_too_many_days')) return 'Proqramda ən çoxu 14 gün ola bilər.';
  return null;
}
