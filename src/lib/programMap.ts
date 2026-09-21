/**
 * Server row → Program. Its own module, with no store imports, because both the
 * read hooks (src/lib/hooks.ts) and the write path (src/lib/saveProgram.ts, which
 * the app store imports) need it — living in hooks.ts it closed an import cycle
 * appStore → saveProgram → hooks → appStore.
 */
import { Exercise, Program } from '@/data/types';
import { exerciseLibrary } from '@/store/db';

/**
 * The exercises of one stored day.
 *
 * A day written by the current builder carries `items` — the author's own name,
 * sets, reps (or «45 san») and clip for every row (schema76). Those numbers are
 * used exactly as written; the library is consulted only for the things the
 * author was never asked, like which muscle a move trains and its common
 * mistake.
 *
 * Days saved before that shape existed carry only `exercise_ids`, and for those
 * the library's defaults ARE the author's intent — they had no way to say
 * anything else. That branch is the fallback, not the rule: it used to be the
 * only code here, which is why a coach's «5 set × 5» came back as the library's
 * «3 set × 8-10» under their own name.
 *
 * An id that resolves to nothing is dropped rather than invented.
 */
function mapDayExercises(d: any): Exercise[] {
  const items: any[] = Array.isArray(d?.items) ? d.items : [];
  if (items.length) {
    return items
      .map((it): Exercise | null => {
        const name = String(it?.name ?? '').trim();
        if (!name) return null;
        const lib = it?.exercise_id ? exerciseLibrary.find((x) => x.id === it.exercise_id) : undefined;
        const sets = Number(it?.sets);
        return {
          id: String(it?.exercise_id ?? '') || `own-${name.toLowerCase().replace(/\s+/g, '-')}`,
          name,
          muscle: lib?.muscle ?? String(it?.muscle ?? '').trim(),
          sets: Number.isFinite(sets) && sets > 0 ? Math.round(sets) : 1,
          reps: String(it?.reps ?? '').trim(),
          videoUrl: typeof it?.video_url === 'string' && it.video_url ? it.video_url : null,
          commonMistake: lib?.commonMistake ?? '',
          substitutes: lib?.substitutes ?? [],
        };
      })
      .filter((x): x is Exercise => !!x);
  }

  const ids: string[] = Array.isArray(d?.exercise_ids) ? d.exercise_ids : [];
  return ids
    .map((id) => exerciseLibrary.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => ({
      id: x.id,
      name: x.name,
      muscle: x.muscle,
      sets: x.defaultSets,
      reps: x.reps,
      videoUrl: null,
      commonMistake: x.commonMistake,
      substitutes: x.substitutes,
    }));
}

export function mapProgram(r: any): Program {
  return {
    id: r.id,
    title: r.title,
    /* `description` was written by the create screen and read back by nobody:
       this mapper listed every other column and simply skipped it, so the
       paragraph the author typed — who the program is for, what equipment it
       needs — was visible only on the phone that wrote it. Everyone else saw a
       program with no description and no sign that one existed. */
    desc: r.description ?? undefined,
    creatorName: r.creator_name,
    creatorType: r.creator_type,
    creatorVerified: r.creator_verified,
    weeks: r.weeks,
    daysPerWeek: r.days_per_week,
    level: r.level,
    goal: r.goal,
    paid: r.paid,
    price: r.price ?? undefined,
    rating: r.rating,
    minutes: r.minutes,
    videoCount: r.video_count,
    doneBy: r.done_by,
    hasMealPlan: r.has_meal_plan,
    tags: r.tags ?? [],
    saves: r.saves ?? 0,
    days: (r.days ?? []).map((d: any) => ({ title: d.title, focus: d.focus, exercises: mapDayExercises(d) })),
  };
}
