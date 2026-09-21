/**
 * How long a workout takes — ONE answer, for every screen that prints one.
 *
 * It used to live in day.tsx and be imported from there by the Məşq tab and the
 * program screen, which was fine until a second copy appeared in the save path
 * and the same program could be «~45 dəq» on one screen and «~38 dəq» on the
 * next. The number is an estimate either way; what it must not be is two
 * different estimates.
 *
 * Structural on purpose: the callers hold a `LibExercise` (a resolved day) or a
 * draft row (a program being written), and neither should have to convert into
 * the other's shape to ask this question.
 */

export interface Timeable {
  /** How many sets. */
  sets: number;
  /** As the author wrote it: «8-10», or «45 san» for a hold. */
  reps?: string;
  equipment?: string;
  isCompound?: boolean;
}

/** The session logger's rule, in one place: a target containing «san» is time,
 *  not repetitions (src/app/(tabs)/workout/session.tsx isTimed). */
export const isTimedTarget = (reps: string | undefined | null) => /san/i.test(reps ?? '');

/** Minutes per set, work plus the rest that follows it. */
function perSet(e: Timeable): number {
  if (isTimedTarget(e.reps)) return 1.2; // a hold and a short rest
  if (e.equipment === 'Bədən') return 1.2;
  return e.isCompound ? 2.8 : 2.2;
}

/** Rounded minutes for one day's work, including a warm-up. 0 for an empty day —
 *  «~5 dəq» over a day with nothing in it is a claim about no work at all. */
export function estimateDuration(exercises: Timeable[]): number {
  if (!exercises.length) return 0;
  const min = exercises.reduce((a, e) => a + Math.max(1, e.sets) * perSet(e), 0);
  return Math.max(10, Math.round(min + 5));
}

/**
 * The first and last number in a rep target: «8-10» → 8 and 10, «45 san» → 45.
 *
 * This replaced two parsers in the session logger that split ONLY on the en
 * dash «–» the library happens to use, then stripped every non-digit from what
 * was left. The builder's own placeholder shows «8-10» with an ordinary hyphen,
 * so an author who typed exactly what the app suggested got «810»: every set
 * ticked without a typed count was logged as 810 repetitions, the session volume
 * came out about a hundred times too large, «Keçən dəfə: 60kg × 810» appeared
 * on the day screen, and the weight suggestion could never be earned. Reading
 * the digit runs instead makes every separator a person might type — «-», «–»,
 * «—», « - », «/», «to» — mean the same thing.
 */
export function repRange(reps: string | null | undefined, fallback = 8): { low: number; high: number } {
  const nums = (reps ?? '').match(/\d+/g)?.map(Number).filter((n) => Number.isFinite(n) && n > 0) ?? [];
  if (!nums.length) return { low: fallback, high: fallback };
  return { low: nums[0], high: nums[nums.length - 1] };
}

/**
 * A rep target as the reader should see it.
 *
 * The STORED form of a hold is «45 san» — Azerbaijani, on purpose: the session
 * logger recognises a hold by that suffix, and it is program data, not UI. But
 * passing it through t() finds nothing (every number is a different key), so a
 * Russian reader saw «45 san» where «45 сек» belonged. A hold is re-rendered
 * from its number; a rep range («8-10», «5–6») has no words and is shown as is.
 * `tr` is the component's translator, so the label follows a language switch.
 */
export function repsText(reps: string | null | undefined, tr: (s: string, v?: Record<string, string | number>) => string): string {
  const r = (reps ?? '').trim();
  if (!r) return '';
  if (isTimedTarget(r)) {
    const n = r.match(/\d+/)?.[0];
    return n ? tr('{n} san', { n }) : r;
  }
  return r;
}
