import type { Workout } from '@/store/db';

/**
 * The three lifts SPOT keeps a personal record for.
 *
 * This list used to live inside the session screen, which was the only place
 * that wrote a record. Deleting a workout has to be able to take that record
 * back with it, and a second copy of the list would have been a second answer
 * to «is this a squat?» — so it lives here and both sides read the same one.
 */
export const LIFTS: { lift: string; test: (n: string) => boolean }[] = [
  { lift: 'Skvat', test: (n) => n.toLowerCase().includes('skvat') },
  { lift: 'Bench', test: (n) => n.toLowerCase().includes('bench') },
  { lift: 'Deadlift', test: (n) => n.toLowerCase().includes('deadlift') && !n.toLowerCase().includes('romanian') },
];

/**
 * The heaviest weight this workout moved on each tracked lift.
 *
 * Only what is actually stored is considered. A workout restored from the
 * server carries no set detail (`exercises` is empty), so it yields nothing —
 * which is correct: whatever record it once set was written on another device
 * and cannot be recomputed from what came back.
 */
export function bestsInWorkout(w: Workout): { lift: string; value: number }[] {
  const out: { lift: string; value: number }[] = [];
  for (const { lift, test } of LIFTS) {
    const value = w.exercises
      .filter((e) => test(e.name))
      .reduce((m, e) => Math.max(m, ...e.sets.map((s) => s.weight)), 0);
    if (value > 0) out.push({ lift, value });
  }
  return out;
}
