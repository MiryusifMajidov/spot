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
