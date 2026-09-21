/**
 * The program being written right now.
 *
 * WHY A STORE AND NOT `useState` IN create.tsx.
 *
 * Picking exercises used to be two stacked action sheets: muscle group, then a
 * 250 ms pause, then one move — three taps and a blank second per exercise,
 * twenty-four taps to fill an eight-move day, with no search and no way to see
 * what you had already added. Replacing it with a real picker screen means the
 * selection has to come back from another route, and pushing a list of
 * exercises through URL params is how you lose an author's work to a
 * serialisation bug. The draft lives here instead; both screens edit the same
 * object.
 *
 * Deliberately NOT persisted. A draft restored from disk days later reopens as
 * somebody else's half-finished thought, and the discard prompt in create.tsx
 * is the honest way to handle leaving — asking first, rather than silently
 * keeping it forever.
 */
import { create } from 'zustand';

import { Program } from '@/data/types';
import { t } from '@/lib/i18n';
import { exerciseLibrary } from './db';

/** Repetitions or a hold. Both end up in one `reps` string on the wire — see
 *  `itemReps` — because the session logger reads «san» as timed already. */
export type ItemMode = 'reps' | 'time';

export interface DraftItem {
  /** Stable across re-orders and renames; the library id is not unique in a day
   *  (the same move can legitimately appear twice) and a custom move has none. */
  key: string;
  /** The library move this came from, or null for one the author typed. */
  exerciseId: string | null;
  name: string;
  muscle: string;
  sets: number;
  mode: ItemMode;
  /** «8-10», or the number of seconds when `mode` is 'time'. As typed. */
  value: string;
  /** A clip the author filmed for this row, already uploaded. */
  videoUrl: string | null;
}

export interface DraftDay {
  key: string;
  title: string;
  focus: string;
  items: DraftItem[];
}

let seq = 0;
const nextKey = () => `k${Date.now().toString(36)}-${(seq += 1)}`;

/** What one row means on the wire. «45 san» is what makes the session logger
 *  treat it as a hold rather than as forty-five repetitions. */
export function itemReps(it: DraftItem): string {
  const v = it.value.trim();
  if (!v) return '';
  return it.mode === 'time' ? (/san/i.test(v) ? v : `${v} san`) : v;
}

/** Parse a saved `reps` string back into the two fields the builder edits. */
export function splitReps(reps: string): { mode: ItemMode; value: string } {
  const r = (reps ?? '').trim();
  if (/san/i.test(r)) return { mode: 'time', value: r.replace(/\s*san.*$/i, '').trim() };
  return { mode: 'reps', value: r };
}

export function newDay(index: number): DraftDay {
  return { key: nextKey(), title: t('Gün {n}', { n: index + 1 }), focus: '', items: [] };
}

export function itemFromLibrary(id: string): DraftItem | null {
  const m = exerciseLibrary.find((x) => x.id === id);
  if (!m) return null;
  const { mode, value } = splitReps(m.reps);
  return {
    key: nextKey(),
    exerciseId: m.id,
    name: m.name,
    muscle: m.muscle,
    /* The library's numbers are a STARTING POINT that the author can now
       overwrite — which is the whole point of schema76. Before it, they were
       the final answer no matter what the author typed. */
    sets: m.defaultSets,
    mode,
    value,
    videoUrl: null,
  };
}

export function itemFromName(name: string): DraftItem {
  return {
    key: nextKey(),
    exerciseId: null,
    name: name.trim(),
    muscle: '',
    sets: 3,
    mode: 'reps',
    value: '10',
    videoUrl: null,
  };
}

interface DraftState {
  /** The program being edited, or null when this is a new one. */
  editingId: string | null;
  title: string;
  desc: string;
  days: DraftDay[];
  /** Has anything been typed? Drives the «throw this away?» prompt. */
  touched: boolean;

  startNew: () => void;
  startEdit: (p: Program) => void;
  set: (patch: Partial<Pick<DraftState, 'title' | 'desc'>>) => void;
  addDay: () => void;
  removeDay: (key: string) => void;
  patchDay: (key: string, patch: Partial<Pick<DraftDay, 'title' | 'focus'>>) => void;
  addItems: (dayKey: string, items: DraftItem[]) => void;
  patchItem: (dayKey: string, itemKey: string, patch: Partial<DraftItem>) => void;
  removeItem: (dayKey: string, itemKey: string) => void;
}

export const useProgramDraft = create<DraftState>((set) => ({
  editingId: null,
  title: '',
  desc: '',
  days: [newDay(0)],
  touched: false,

  startNew: () =>
    set({
      editingId: null,
      title: '',
      desc: '',
      days: [newDay(0)],
      touched: false,
    }),

  startEdit: (p) => {
    /* `(p.days ?? []).map(...) || [newDay(0)]` was the intent here and could
       never fire: `[].map()` returns `[]`, which is truthy. A program with no
       days opened the editor with no day and no row to type into. */
    const days = (p.days ?? []).map((d, i) => ({
      key: nextKey(),
      title: d.title || t('Gün {n}', { n: i + 1 }),
      focus: d.focus ?? '',
      items: (d.exercises ?? []).map((e) => {
        const { mode, value } = splitReps(e.reps);
        return {
          key: nextKey(),
          // A row read back from `exercise_ids` has a library id; one the
          // author typed has the synthetic `own-…` id the mapper made, which
          // is not a library move and must not pretend to be.
          exerciseId: exerciseLibrary.some((x) => x.id === e.id) ? e.id : null,
          name: e.name,
          muscle: e.muscle ?? '',
          sets: e.sets || 3,
          mode,
          value,
          videoUrl: e.videoUrl ?? null,
        };
      }),
    }));
    set({
      editingId: p.id,
      title: p.title ?? '',
      desc: p.desc ?? '',
      days: days.length ? days : [newDay(0)],
      touched: false,
    });
  },

  set: (patch) => set((s) => ({ ...s, ...patch, touched: true })),

  addDay: () => set((s) => ({ days: [...s.days, newDay(s.days.length)], touched: true })),

  removeDay: (key) =>
    set((s) => (s.days.length > 1 ? { days: s.days.filter((d) => d.key !== key), touched: true } : s)),

  patchDay: (key, patch) =>
    set((s) => ({
      days: s.days.map((d) => (d.key === key ? { ...d, ...patch } : d)),
      touched: true,
    })),

  addItems: (dayKey, items) =>
    set((s) => ({
      days: s.days.map((d) => (d.key === dayKey ? { ...d, items: [...d.items, ...items] } : d)),
      touched: true,
    })),

  patchItem: (dayKey, itemKey, patch) =>
    set((s) => ({
      days: s.days.map((d) =>
        d.key === dayKey
          ? {
              ...d,
              items: d.items.map((it) => (it.key === itemKey ? { ...it, ...patch } : it)),
            }
          : d
      ),
      touched: true,
    })),

  removeItem: (dayKey, itemKey) =>
    set((s) => ({
      days: s.days.map((d) => (d.key === dayKey ? { ...d, items: d.items.filter((it) => it.key !== itemKey) } : d)),
      touched: true,
    })),
}));

/** Days with at least one exercise, in the shape schema76 stores. */
export function draftDaysForSave(days: DraftDay[]) {
  return days
    .filter((d) => d.items.length > 0)
    .map((d) => ({
      title: d.title.trim() || 'Gün',
      focus:
        d.focus.trim() ||
        d.items
          .map((it) => it.muscle)
          .filter((m, i, a) => !!m && a.indexOf(m) === i)
          .join(', '),
      items: d.items.map((it) => ({
        name: it.name.trim(),
        exercise_id: it.exerciseId,
        sets: it.sets,
        reps: itemReps(it),
        video_url: it.videoUrl,
      })),
      /* Written alongside `items` for the moves the library knows. A phone still
         running the previous build reads only this field, and without it every
         day of a newly written program would look empty there. */
      exercise_ids: d.items.map((it) => it.exerciseId).filter((x): x is string => !!x),
    }));
}
