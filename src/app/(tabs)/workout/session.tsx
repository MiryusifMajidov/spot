import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { successFeedback, tapFeedback } from '@/lib/feedback';
import { useProgram } from '@/lib/hooks';
import { LIFTS } from '@/lib/lifts';
import { parseDecimal } from '@/lib/az';
import { decimalSeparator } from '@/lib/format';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Platform, ScrollView, StatusBar, StyleSheet, TextInput, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { PressableScale } from '@/components/ui/PressableScale';
import { logPR, logWorkout as logWorkoutApi } from '@/lib/api';
import { repRange, repsText } from '@/lib/duration';
import { useAuthGate } from '@/lib/authGate';
import { getMyAssignedProgram } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import {
  exerciseById,
  exercisesFromPicks,
  LibExercise,
  lastLoggedSet,
  OverloadSuggestion,
  seedById,
  suggestNext,
  useDb,
} from '@/store/db';
import { useSessionPick } from '@/store/sessionPick';
import { confirm, toast } from '@/store/ui';
import { dark, iconSize, palette, radius, spacing, inputTintDark } from '@/theme';
import { resolveDayExercises } from './day';

/* `id` is the set's identity for its whole life on this screen — the React key of
   its row and what every edit, tick and removal addresses. Rows used to be keyed
   by position, which was harmless while sets could only be appended; once a
   middle set can be removed, a positional key hands the removed row's component
   (its swiped-open offset, a focused field) to the set that slides into its
   place. */
type SetState = { id: string; kg: string; reps: string; done: boolean };
type ExLog = {
  ex: LibExercise;
  prev: string;
  hint: string;
  timed: boolean;
  bodyweight: boolean;
  /** The progressive-overload rule's verdict for this exercise, kept so the user
   *  can accept it by hand when it must not be applied for them (trainer case). */
  suggestion: OverloadSuggestion | null;
  sets: SetState[];
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/* A logged load, written back EXACTLY, only with the language's decimal mark
   («61,25», not «61.25»). `weight()` in src/lib/format.ts rounds to one decimal — fine for a label, wrong
   for a figure that is prefilled into a kq field and saved again: a 61,25 kq set came
   back as «61,3» and was logged as 61,3. `save` reads it with `parseDecimal`. */
const kgExact = (n: number) => String(n).replace('.', decimalSeparator());

/** The load a fresh set of this exercise starts with: the progressive-overload
 *  verdict (applied, or last time's load when it must not be applied for them),
 *  else simply what was lifted last time. */
const planKg = (s: OverloadSuggestion | null, lastWeight: number | undefined, apply: boolean) =>
  s ? kgExact(apply ? s.weight : s.prevWeight) : lastWeight != null ? kgExact(lastWeight) : '';

let setSeq = 0;
/** Unique within the app's lifetime and across a restored draft (the time part). */
/* The program editor and the database allow 1–20 sets (program_item_sets_range); a
   session keeps to the same ceiling, so rapid taps on + cannot pile up rows. */
const MAX_SETS = 20;
const newSetId = () => `s${Date.now().toString(36)}${(setSeq++).toString(36)}`;

/** A minus drawn exactly like the icon set's plus (src/components/Icon.tsx has none). */
function MinusGlyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M5 12h14" fill="none" stroke={color} strokeWidth={2.1} strokeLinecap="round" />
    </Svg>
  );
}

/* Both read the digit runs (src/lib/duration.ts repRange). They used to split
   on the en dash only, so a hand-typed «8-10» became 810 — see repRange. */
const topRepOf = (reps: string): number => repRange(reps).high;
/** The rep/second target a ticked set defaults to when the field is left empty. */
const baseRepOf = (reps: string): number => repRange(reps).low;
const isTimed = (reps: string) => /san/i.test(reps);
const isBodyweight = (eq: string) => eq === 'Bədən' || eq === 'Turnik' || eq === 'Bar';

export default function Session() {
  const router = useRouter();
  const t = useT();
  const gate = useAuthGate();
  const params = useLocalSearchParams<{
    programId?: string;
    dayIndex?: string;
    title?: string;
    partnerId?: string;
    /** A workout of the person's own: the library ids they picked, in order… */
    exIds?: string;
    /** …and a move they typed that the library does not have. */
    own?: string;
  }>();
  const workouts = useDb((s) => s.workouts);
  const setActiveProgram = useDb((s) => s.setActiveProgram);
  const restSeconds = useAppStore((s) => s.restSeconds);
  // Records set on a device whose set detail never left it — see `save` below.
  const serverPRs = useDb((s) => s.serverPRs);
  const logWorkout = useDb((s) => s.logWorkout);
  /* Bodyweight tracking is gone, so there is nothing to pre-fill a bodyweight
     exercise with. `null` keeps every downstream check («do we know their
     weight?») answering honestly instead of guessing a number. */
  const bodyweight: number | null = null;

  /* Same source as the day screen: `useAllPrograms()` holds only this device's
     own programs and the seeds, so a program read from the server resolved to
     `undefined` here — and the session was then built from moves the app had
     derived from the day TITLE and presented as the author's programming. */
  const programId = params.programId ?? '';
  const remoteProgram = useProgram(programId);
  const program = programId ? (remoteProgram ?? undefined) : undefined;
  const dayIndex = Number(params.dayIndex) || 0;
  const title = params.title || program?.days?.[dayIndex]?.title || 'Sərbəst məşq';
  const partner = params.partnerId ? seedById(params.partnerId) : null;

  /* «Məşqçin varsa, çəki təklifi ona gedir və avtomatik tətbiq olunmur.»
     SPOT has no channel from this screen to the trainer — there is no
     student→trainer write — so we do not pretend the suggestion was delivered.
     What we CAN honour is the half that protects the student: with a trainer the
     load is never raised for them behind their back. It stays a suggestion they
     accept with one tap, and the hint says so.
     `null` = not known yet (or the read failed) → also treated as "do not apply". */
  const [hasTrainer, setHasTrainer] = useState<boolean | null>(hasSupabaseConfig ? null : false);
  useEffect(() => {
    if (!hasSupabaseConfig) return;
    let alive = true;
    getMyAssignedProgram()
      .then((a) => {
        if (alive) setHasTrainer(!!a);
      })
      .catch(() => {
        /* A failed read is not "you have no trainer": stay on the safe side. */
      });
    return () => {
      alive = false;
    };
  }, []);
  const autoApply = hasTrainer === false;

  /* One exercise's plan: the sets, prefilled with the progressive-overload
     target. Shared by the plan below and by «+ Hərəkət əlavə et», so a move added
     mid-workout gets the same suggestion and hint as a planned one. */
  const planLog = (ex: LibExercise, setId: (si: number) => string): ExLog => {
    const timed = isTimed(ex.reps);
    const bw = isBodyweight(ex.equipment);
    const top = topRepOf(ex.reps);
    const last = lastLoggedSet(workouts, ex.name);
    // The full rule (Asan → +2.5 üst / +5 ayaq, Normal → +2.5 yalnız hədəf
    // vurulubsa, Ağır → eyni çəki, ardıcıl iki Ağır → −5% deload) lives in
    // `suggestNext`; the muscle group decides the upper/lower step.
    const suggestion = timed ? null : suggestNext(workouts, ex.name, top, { muscle: ex.muscle });
    /* Written with the language's decimal mark («62,5», not «62.5») — the same
       figure the «qəbul et» button shows. Exact, not rounded (see kgExact):
       `suggestion.weight` is the raw logged load whenever the rule keeps it. */
    let kg = planKg(suggestion, last?.weight, autoApply);
    let hint = suggestion?.note ?? '';
    if (suggestion && hasTrainer === true) {
      hint = t('{note}. Məşqçin var — SPOT çəkini özü dəyişmir, təklifi sən qəbul edirsən.', { note: suggestion.note });
    }
    if (!kg && bw && bodyweight) kg = String(bodyweight);
    if (!hint) hint = timed ? t('Hədəf {reps}', { reps: repsText(ex.reps, t) }) : bw ? t('Öz çəkinlə işlə — əlavə ağırlıq varsa kq-a yaz') : t('Hədəf {reps} təkrar', { reps: repsText(ex.reps, t) });
    return {
      ex,
      prev: last ? `${kgExact(last.weight)}×${last.reps}` : '—',
      hint,
      timed,
      bodyweight: bw,
      suggestion,
      sets: Array.from({ length: ex.defaultSets }, (_, si) => ({ id: setId(si), kg, reps: '', done: false })),
    };
  };

  /* The workout's moves: the ones the person picked (exIds — a workout of their
     own), else the program's day. */
  const picks = params.exIds;
  const ownPick = params.own ?? '';

  // Build the exercise plan + prefill each set with a progressive-overload target.
  const initial = useMemo<ExLog[]>(() => {
    const exs =
      picks !== undefined
        ? exercisesFromPicks(picks.split(',').filter(Boolean), ownPick ? [ownPick] : [])
        : resolveDayExercises(program, dayIndex, title, !!programId);
    /* Positional ids for the PLAN, not newSetId(): this memo is rebuilt when
       the trainer lookup resolves, and an untouched plan is then swapped in
       (below). Fresh random ids there changed every row's key and remounted
       the whole list — a kg field tapped in the first second lost its focus
       and keyboard. `p…` never meets newSetId()'s `s…`. */
    return exs.map((ex, ei) => planLog(ex, (si) => `p${ei}.${si}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, program?.id, dayIndex, autoApply, hasTrainer, picks, ownPick]);

  const [logs, setLogs] = useState<ExLog[]>(initial);
  /* The trainer lookup resolves after the first render, so `initial` can be
     rebuilt mid-session. Never overwrite work the user has already typed or
     ticked — only an untouched plan may be replaced. */
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setLogs(initial);
  }, [initial]);
  const [ci, setCi] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const restRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The set whose tick started the running rest — removing that set ends it. */
  const restFor = useRef<string | null>(null);
  /** The swipe-to-delete handle of every set row on screen, by set id. */
  const swipeRows = useRef(new Map<string, SwipeableMethods>());
  /** Whether a row may be standing open (set when one swipes open, cleared by closeRows). */
  const rowOpen = useRef(false);

  /* Duration from a START TIMESTAMP, not from counting ticks.
     `setInterval(() => setElapsed(e => e + 1), 1000)` only fires while the JS
     thread is awake: lock the phone or take a call in the middle of a set and
     the timer silently stops, so a 62-minute workout was logged as 40. The
     stamp is also what makes the session survivable — see the persistence
     below. */
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));

  /* The whole session, on disk.
     It used to live only in React state, so Android killing the app in the
     background — routine on a phone with the camera or a call in front — threw
     away every set of an hour's work with no warning and no way back. The
     draft is written on every change and cleared the moment the workout is
     saved or deliberately abandoned. */
  /* A workout of your own is keyed by what was picked too: two different free
     workouts must not restore each other's sets. */
  const draftKey = `spot-session:${params.programId || 'free'}:${dayIndex}:${title}${picks ? `:${picks}:${ownPick}` : ''}`;
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(draftKey)
      .then((raw) => {
        if (!alive || !raw) {
          if (alive) setRestored(true);
          return;
        }
        try {
          const d = JSON.parse(raw) as { logs: ExLog[]; ci: number; startedAt: number };
          // A draft older than 12 hours is not a workout somebody is still in.
          if (!d?.logs?.length || Date.now() - d.startedAt > 12 * 3600 * 1000) {
            AsyncStorage.removeItem(draftKey).catch(() => {});
            setRestored(true);
            return;
          }
          touched.current = true;
          /* A draft written before sets carried an id (see SetState) gets them
             now — every edit, tick and removal addresses a set by it. */
          setLogs(d.logs.map((e) => ({ ...e, sets: (e.sets ?? []).map((s) => (s.id ? s : { ...s, id: newSetId() })) })));
          setCi(Math.min(d.ci ?? 0, d.logs.length - 1));
          setStartedAt(d.startedAt);
          toast(t('Yarımçıq məşqin bərpa olundu'), 'info');
        } catch {
          AsyncStorage.removeItem(draftKey).catch(() => {});
        }
        setRestored(true);
      })
      .catch(() => alive && setRestored(true));
    return () => {
      alive = false;
    };
  }, [draftKey, t]);

  useEffect(() => {
    // Only after the restore has run, or an empty first render would overwrite
    // the draft it is about to load.
    if (!restored || !touched.current) return;
    AsyncStorage.setItem(draftKey, JSON.stringify({ logs, ci, startedAt })).catch(() => {});
  }, [restored, logs, ci, startedAt, draftKey]);

  /* The screen stays awake while the workout is open: between sets the phone
     used to lock, and unlocking with chalked hands mid-set is exactly when a
     rep gets miscounted. */
  useKeepAwake();

  /* Light clock over this dark screen, only while it is the one in front.
     A mount-time <StatusBar style="light" /> pushed its entry onto React Native's
     status-bar stack once and kept it for as long as the session stayed mounted —
     and a workout in progress stays mounted while the person switches tabs, so the
     white clock carried over onto the white Kəşf and Profil screens. The entry is
     now pushed on every focus and popped on blur (a tab switch, or opening the
     exercise card, which pushes its own). On iOS the style is also set directly,
     because the stack skips the native call when it believes the bar already has
     that style; that also rewrites the stack's bottom default, which never shows
     because the root layout's own «dark» entry always sits above it. Same approach
     as the exercise card (workout/exercise.tsx). */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios') StatusBar.setBarStyle('light-content', true);
      const entry = StatusBar.pushStackEntry({ barStyle: 'light-content', animated: true });
      return () => StatusBar.popStackEntry(entry);
    }, [])
  );

  /* Clearance under the exercise nav / «Məşqi bitir» row.
     iOS 26: the tab bar is the Liquid Glass FLOATING bar. It reserves no layout
     space — this scene runs to the bottom of the window and the bar is drawn over
     it, so «Məşqi bitir» sat under the bar. The tab scene's own SafeAreaProvider
     (NativeTabs wraps every iOS tab in one) counts the bar in its bottom inset,
     so that inset is exactly what the row has to clear.
     Android: the Material bar DOES reserve its space (NativeTabs pads the scene's
     bottom edge), and useSafeAreaInsets().bottom there is not the bar — the test
     device reports ~220px under NativeTabs (see feed/index.tsx BOTTOM_GAP) — so
     adding it would float the row into the middle of the screen. */
  const insets = useSafeAreaInsets();
  const navBottom = Platform.OS === 'ios' ? insets.bottom + 8 : 6;

  const clearDraft = () => AsyncStorage.removeItem(draftKey).catch(() => {});
  useEffect(() => () => { if (restRef.current) clearInterval(restRef.current); }, []);

  /* The set list is where the workout is actually logged, and Android edge-to-edge does
     not resize the window when the numeric keyboard opens: on a 4–5 set exercise the
     lower rows ended up behind it, so the weight being entered was invisible while it
     was typed. Shrink the scroller by the overlap (the rest bar and the «Məşqi bitir»
     row stay at the bottom, under the keyboard, while it is open), then push the content
     up by the same amount so the row just tapped stays where it was. */
  const lift = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lifted = useRef(0);
  useEffect(() => {
    const delta = lift - lifted.current;
    lifted.current = lift;
    if (delta > 0) scroller.current?.scrollTo({ y: scrollY.current + delta, animated: true });
  }, [lift]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  const current = logs[ci];

  /* «+ Hərəkət əlavə et»: the picker (mode=add) leaves its choice in
     store/sessionPick and pops back here; on focus the moves are appended with
     the same plan a planned move gets, and the workout jumps to the first of
     them. Keyed on the length so the jump index is the one before appending. */
  useFocusEffect(
    useCallback(() => {
      const p = useSessionPick.getState().take();
      if (!p) return;
      const added = exercisesFromPicks(p.ids, p.typed).map((ex) => planLog(ex, () => newSetId()));
      if (!added.length) return;
      touched.current = true;
      setLogs((prev) => [...prev, ...added]);
      setCi(logs.length);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logs.length])
  );
  const addExercise = () => router.push({ pathname: '/(tabs)/workout/pick-exercises', params: { mode: 'add' } });

  /* ±30 s on a running rest. A fixed 90 s was too long between curls and too
     short between heavy squats; the default itself is set in Parametrlər. */
  const adjustRest = (delta: number) => setRest((r) => (r === null ? r : Math.max(5, r + delta)));

  /* «Keç» used to only hide the bar: the interval kept firing, once a second,
     until the next tick or the end of the session. */
  const stopRest = () => {
    if (restRef.current) clearInterval(restRef.current);
    restRef.current = null;
    restFor.current = null;
    setRest(null);
  };

  const startRest = (setId: string) => {
    if (restRef.current) clearInterval(restRef.current);
    restFor.current = setId;
    setRest(restSeconds);
    restRef.current = setInterval(() => {
      setRest((r) => {
        if (r === null) return null;
        if (r <= 1) {
          if (restRef.current) clearInterval(restRef.current);
          successFeedback();
          return null;
        }
        return r - 1;
      });
    }, 1000);
  };

  const update = (id: string, key: 'kg' | 'reps', val: string) => {
    touched.current = true;
    setLogs((prev) => prev.map((e, ei) => (ei === ci ? { ...e, sets: e.sets.map((s) => (s.id === id ? { ...s, [key]: val } : s)) } : e)));
  };

  /* The suggestion the rule produced, offered instead of applied — see the
     trainer note above. It fills only the sets that are still open. */
  const acceptSuggestion = () => {
    const s = current.suggestion;
    if (!s) return;
    tapFeedback();
    touched.current = true;
    setLogs((prev) =>
      prev.map((e, ei) => (ei === ci ? { ...e, sets: e.sets.map((st) => (st.done ? st : { ...st, kg: kgExact(s.weight) })) } : e))
    );
  };

  const toggleSet = (id: string) => {
    const target = current.sets.find((s) => s.id === id);
    if (!target) return;
    touched.current = true;
    const nowDone = !target.done;
    setLogs((prev) =>
      prev.map((e, ei) =>
        ei === ci
          ? {
              ...e,
              sets: e.sets.map((s) =>
                s.id === id
                  ? {
                      ...s,
                      done: !s.done,
                      // A ticked set must never be silently dropped: an empty field
                      // falls back to the exercise's own target.
                      reps: !s.done && !s.reps.trim() ? String(baseRepOf(e.ex.reps)) : s.reps,
                      kg: !s.done && !s.kg.trim() && e.bodyweight && bodyweight ? String(bodyweight) : s.kg,
                    }
                  : s
              ),
            }
          : e
      )
    );
    if (nowDone) {
      successFeedback();
      startRest(id);
    }
  };

  /* A new set carries the last set's load — the working weight they are on right
     now, the progressive-overload prefill unless they changed it. With no set to
     copy from (a move planned with 0 sets) it starts from the plan itself. */
  const addSet = () => {
    touched.current = true;
    // Minted once, outside the updater: React may run an updater more than once
    // (Strict Mode, a rebased render) and each run would give the row a new key.
    const id = newSetId();
    setLogs((prev) =>
      prev.map((e, ei) => {
        if (ei !== ci || e.sets.length >= MAX_SETS) return e;
        const last = e.sets[e.sets.length - 1];
        const kg = last ? last.kg : planKg(e.suggestion, lastLoggedSet(workouts, e.ex.name)?.weight, autoApply);
        return { ...e, sets: [...e.sets, { id, kg, reps: '', done: false }] };
      })
    );
  };

  /** Slide every swiped-open row shut, except `keep`. */
  const closeRows = (keep?: string) => {
    rowOpen.current = false;
    swipeRows.current.forEach((row, key) => {
      if (key !== keep) row.close();
    });
  };
  /* A row left showing «Sil» shuts as soon as the hand moves on — a scroll, a
     touch on another set's field or tick, the set-count stepper — as swipe rows
     do in Mail. Only when one may be open, so an ordinary tap on a field does not
     send a close to every row. */
  const closeOpenRow = () => {
    if (rowOpen.current) closeRows();
  };

  /* Removing sets. «Setlər» − takes the last one; swiping a row left reveals
     «Sil» for that one. An exercise always keeps one set: with none left there
     is no row to tick, and the exercise would silently vanish from the log.
     Addressed by id and looked up in whichever exercise holds it, so the
     confirm dialog's late callback cannot remove from the wrong exercise. The
     rows below renumber from their position; each keeps its own values and tick
     because it is keyed by that id. */
  const dropSet = (id: string) => {
    touched.current = true;
    // A row left open elsewhere would keep showing «Sil» — possibly on the one
    // set that is now the last and may not be removed.
    closeRows(id);
    setLogs((prev) =>
      prev.map((e) => (e.sets.length > 1 && e.sets.some((s) => s.id === id) ? { ...e, sets: e.sets.filter((s) => s.id !== id) } : e))
    );
    // The rest that set's tick started belongs to a set that no longer exists.
    if (restFor.current === id) stopRest();
  };

  /* An open set holds nothing yet, so it goes at once. A ticked one holds a
     logged result — that is asked about first. Rows close before the question:
     dismissing the dialog by its backdrop runs no action, and a row must not be
     left open showing «Sil». */
  const requestRemove = (id: string) => {
    if (current.sets.length <= 1) return;
    const idx = current.sets.findIndex((s) => s.id === id);
    if (idx < 0) return;
    if (!current.sets[idx].done) {
      dropSet(id);
      return;
    }
    closeRows();
    confirm(t('Qeyd olunmuş set silinsin?'), t('{n} nömrəli setin nəticəsi silinəcək.', { n: idx + 1 }), [
      { label: t('Ləğv et'), style: 'cancel' },
      { label: t('Sil'), style: 'destructive', onPress: () => dropSet(id) },
    ]);
  };

  const removeLastSet = () => {
    const last = current.sets[current.sets.length - 1];
    if (last) requestRemove(last.id);
  };

  const doneCount = logs.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);

  const save = () => {
    if (restRef.current) clearInterval(restRef.current);
    successFeedback();
    const exercises = logs
      .map((e) => ({
        name: e.ex.name,
        muscle: e.ex.muscle,
        timed: e.timed,
        sets: e.sets
          .filter((s) => s.done)
          /* `parseDecimal`, not `Number`: a comma-typed weight («72,5» — the
             decimal key on an Azerbaijani keypad) was NaN, and `|| 0` then
             recorded the set as 0 kg. The set counted, the weight vanished, and
             the session's whole volume figure was quietly wrong. */
          .map((s) => ({ weight: parseDecimal(s.kg) ?? 0, reps: parseDecimal(s.reps) ?? baseRepOf(e.ex.reps), done: true })),
      }))
      .filter((e) => e.sets.length > 0);

    // Time-based work (plank etc.) has no kg × təkrar volume — count it as 0
    // instead of multiplying seconds by bodyweight.
    const volumeKg = Math.round(
      exercises.reduce((sum, e) => sum + (e.timed ? 0 : e.sets.reduce((a, s) => a + s.weight * s.reps, 0)), 0)
    );
    const setsDone = exercises.reduce((a, e) => a + e.sets.length, 0);
    const maxKg = exercises.reduce((m, e) => Math.max(m, ...e.sets.map((s) => s.weight)), 0);
    const durationMin = Math.max(1, Math.round(elapsed / 60));
    const clean = exercises.map(({ name, muscle, sets }) => ({ name, muscle, sets }));

    // The id the engine assigns is the id the server row gets — that shared key
    // is what makes the two copies one history (src/lib/trainingSync.ts).
    /* Training a program's day is following it: the Məşq tab's card now shows
       this program's next day. */
    if (params.programId) setActiveProgram(params.programId);
    const workoutId = logWorkout({
      programId: params.programId || undefined,
      dayIndex,
      title,
      exercises: clean,
      volumeKg,
      durationMin,
      partnerId: params.partnerId || undefined,
    });

    // Mirror to Supabase (best-effort) so the trainer / gym / admin panels see it.
    if (hasSupabaseConfig) {
      logWorkoutApi({ id: workoutId, programId: params.programId || null, dayIndex, title, durationSec: elapsed, volumeKg, setsDone }).catch(() => {});
      for (const { lift, test } of LIFTS) {
        const best = clean
          .filter((e) => test(e.name))
          .reduce((m, e) => Math.max(m, ...e.sets.map((s) => s.weight)), 0);
        if (!best) continue;
        /* The record already on the server counts too.
           A workout restored from the server comes back `summaryOnly`, with an
           EMPTY `exercises` array (src/lib/trainingSync.ts), so on a rebuilt
           device this reduce found 0 for every lift and the first session there
           was written to `prs` as a new record. Elvin's 100 kg bench, logged on
           his old phone, was overwritten on his profile by the 80 kg he opened
           the new one with. `serverPRs` is that history — see `computeStats`. */
        const serverBest = serverPRs.find((p) => p.lift === lift)?.value ?? 0;
        const prevBest = Math.max(
          serverBest,
          workouts.reduce(
            (m, w) => Math.max(m, ...w.exercises.filter((e) => test(e.name)).flatMap((e) => e.sets.map((s) => s.weight)), 0),
            0
          )
        );
        if (best > prevBest) logPR(lift, best).catch(() => {});
      }
    }

    clearDraft();
    router.replace({
      pathname: '/(tabs)/workout/summary',
      params: { title, durationSec: String(elapsed), volumeKg: String(volumeKg), setsDone: String(setsDone), maxKg: String(maxKg) },
    });
  };

  const finish = () => {
    if (doneCount === 0) {
      confirm(t('Heç bir set qeyd olunmayıb'), t('Bu məşq statistikana yazılmayacaq. Bağlayaq?'), [
        { label: t('Məşqə qayıt'), style: 'cancel' },
        { label: t('Qeydiyyatsız bağla'), style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    gate(save, t('Məşqi yadda saxlamaq üçün'));
  };

  const quit = () => {
    if (doneCount === 0) {
      clearDraft();
      router.back();
      return;
    }
    // Leaving no longer means losing it: the draft is kept and offered back the
    // next time this workout is opened, so «Məşqə davam et» is a real option
    // even after the phone kills the app.
    confirm(t('Məşqi dayandır?'), t('{n} set qeyd etmisən. İndi saxlamasan, məşqi növbəti dəfə açanda qaldığın yerdən davam edə bilərsən.', { n: doneCount, count: doneCount }), [
      { label: t('Bitir və yadda saxla'), style: 'primary', onPress: () => gate(save, t('Məşqi yadda saxlamaq üçün')) },
      { label: t('Məşqə davam et'), style: 'cancel' },
      { label: t('Sonra davam edərəm'), onPress: () => router.back() },
      { label: t('Sil və çıx'), style: 'destructive', onPress: () => { clearDraft(); router.back(); } },
    ]);
  };

  if (!current) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
          <Icon name="dumbbell" size={26} color={dark.textTertiary} />
          <AppText style={{ color: palette.white, fontSize: 17, fontWeight: '600', marginTop: 12, textAlign: 'center' }}>
            {t('Bu günə hərəkət təyin olunmayıb')}
          </AppText>
          {/* It used to send the person to the exercise library to «build their own
              workout» — a browsing screen that cannot start one. The picker can. */}
          <AppText style={{ color: dark.textSecondary, fontSize: 13.5, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            {t('Proqramın bu gününə hərəkət əlavə olunmayıb. Hərəkətləri özün seçib məşqə başlaya bilərsən.')}
          </AppText>
          <PressableScale onPress={addExercise} style={[styles.nextBtn, { marginTop: 20, paddingHorizontal: 24, flex: undefined, backgroundColor: palette.volt }]}>
            <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '700' }}>{t('Hərəkət seç')}</AppText>
          </PressableScale>
          <PressableScale onPress={() => router.back()} style={[styles.nextBtn, { marginTop: 10, paddingHorizontal: 24, flex: undefined }]}>
            <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '600' }}>{t('Geri')}</AppText>
          </PressableScale>
        </SafeAreaView>
      </View>
    );
  }

  /* Two different questions, and they were being answered by one flag.
     `exerciseById(...)` only says the move is in the library — it says nothing
     about footage. Since no exercise carries a video any more, that flag lit a
     volt PLAY button on every exercise and promised a demonstration that does
     not exist. The library entry is still worth opening (target sets/reps, the
     most common mistake, substitutes), so the tap stays — the play icon goes. */
  /* Offer the «qəbul et» tap only while the suggestion is genuinely unapplied:
     it changes the load, it was not prefilled, and the open sets do not already
     carry it. Compared as a number: «62,5» typed on the keypad and «62.5» are the
     same load. */
  const openSet = current.sets.find((s) => !s.done);
  const showAccept =
    !!current.suggestion &&
    !autoApply &&
    current.suggestion.weight !== current.suggestion.prevWeight &&
    !!openSet &&
    parseDecimal(openSet.kg) !== current.suggestion.weight;

  const setCount = current.sets.length;
  const canRemove = setCount > 1;
  const canAdd = setCount < MAX_SETS;

  const libraryEntry = exerciseById(current.ex.id);
  /* `current.ex` already carries the author's clip when they filmed one
     (store/db.ts programDayExercises). Reading the library entry instead meant a
     coach's own technique video existed in the program and was unreachable from
     the one screen where somebody is actually doing the exercise. */
  const clip = current.ex.videoUrl || libraryEntry?.videoUrl || '';
  const hasVideo = !!clip;
  const hasDetail = !!libraryEntry || hasVideo;

  return (
    <View style={styles.root}>
      {/* No 'bottom' edge, on purpose — the nav row below pads itself (`navBottom`).
          On Android the Material tab bar reserves its own space and the Məşq tab scene
          already stops above it, so the bottom inset taken again here pushed «Məşqi bitir»
          up by another inset's worth and left a dead band under it. On iOS 26 the floating
          Liquid Glass bar reserves nothing, and only the row itself needs to clear it —
          the scroller above may keep running to the row. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <PressableScale activeScale={0.9} onPress={quit} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={t('Bağla')}>
            <Icon name="x" size={iconSize.action} color={palette.white} />
          </PressableScale>
          {/* flex: 1 — a long day title («Sinə, çiyin və triseps…») is truncated by
              numberOfLines instead of pushing the timer off the screen edge. */}
          <View style={{ flex: 1, alignItems: 'center', marginHorizontal: 8 }}>
            <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{t(title)}</AppText>
            <AppText style={{ color: dark.textTertiary, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              {t('Hərəkət {n} / {total}', { n: ci + 1, total: logs.length })}{partner ? ` · ${t('{name} ilə', { name: partner.name })}` : ''}
            </AppText>
          </View>
          <View style={styles.timer}>
            <Icon name="timer" size={14} color={palette.volt} />
            <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{fmt(elapsed)}</AppText>
          </View>
        </View>

        <ScrollView
          ref={scroller}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          style={{ marginBottom: lift }}
          onScroll={onScroll}
          onScrollBeginDrag={closeOpenRow}
          scrollEventThrottle={16}>
          {/* Exercise + form video */}
          <View style={styles.exercise}>
            <PressableScale
              activeScale={hasDetail ? 0.92 : 1}
              haptic={hasDetail}
              onPress={
                hasDetail
                  ? () =>
                      router.push({
                        pathname: '/(tabs)/workout/exercise',
                        params: {
                          id: current.ex.id,
                          name: current.ex.name,
                          muscle: current.ex.muscle,
                          sets: String(current.ex.defaultSets),
                          reps: current.ex.reps,
                          video: clip,
                        },
                      })
                  : undefined
              }
              style={styles.thumb}>
              <Icon name={hasVideo ? 'play' : 'target'} size={22} color={hasDetail ? palette.volt : dark.textTertiary} />
            </PressableScale>
            <View style={{ flex: 1 }}>
              <AppText style={{ color: palette.white, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>{t(current.ex.name)}</AppText>
              <AppText style={{ color: dark.textSecondary, fontSize: 13.5, marginTop: 4 }}>
                {[t('{n} set', { n: current.sets.length, count: current.sets.length }), repsText(current.ex.reps, t), t(current.ex.muscle)].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>

          {/* Progressive-overload hint */}
          <View style={styles.hint}>
            <View style={styles.hintRow}>
              <Icon name={current.suggestion?.deload ? 'shield' : 'target'} size={13} color={palette.volt} />
              <AppText style={{ color: dark.textSecondary, fontSize: 12.5, flex: 1 }}>
                {t('Keçən dəfə: {prev}. {hint}', { prev: current.prev, hint: current.hint })}
              </AppText>
            </View>
            {showAccept ? (
              <PressableScale activeScale={0.97} onPress={acceptSuggestion} style={styles.accept} hitSlop={{ top: 4, bottom: 4 }}>
                <Icon name="check" size={14} color={palette.volt} />
                <AppText style={{ color: palette.volt, fontSize: 12.5, fontWeight: '700' }}>
                  {t('Təklifi qəbul et — {kg} kq', { kg: kgExact(current.suggestion!.weight) })}
                </AppText>
              </PressableScale>
            ) : null}
          </View>

          {/* Column headers */}
          <View style={styles.cols}>
            <AppText style={[styles.colH, { width: 34 }]}>{t('SET')}</AppText>
            <AppText style={[styles.colH, { flex: 1 }]}>{t('ƏVVƏLKİ')}</AppText>
            <AppText style={[styles.colH, { width: 64, textAlign: 'center' }]}>{t('KQ')}</AppText>
            <AppText style={[styles.colH, { width: 64, textAlign: 'center' }]}>{current.timed ? t('SANİYƏ') : t('TƏKRAR')}</AppText>
            <View style={{ width: 40 }} />
          </View>

          {/* Sets */}
          <View style={{ paddingHorizontal: 20 }}>
            {current.sets.map((s, i) => (
              /* Swipe left → «Sil» for this one set. It only opens on a clearly
                 sideways drag (20 pt either way before it claims the touch): a
                 vertical drag stays the ScrollView's, a tap stays the field's or
                 the tick's. No full-swipe delete — a sweaty overshoot must not
                 remove a set; «Sil» is a deliberate second tap. Off while this is
                 the only set. */
              <ReanimatedSwipeable
                key={s.id}
                ref={(row: SwipeableMethods | null) => {
                  if (row) swipeRows.current.set(s.id, row);
                  else swipeRows.current.delete(s.id);
                }}
                enabled={canRemove}
                friction={1}
                overshootRight={false}
                dragOffsetFromRightEdge={20}
                dragOffsetFromLeftEdge={20}
                onSwipeableWillOpen={() => {
                  closeRows(s.id);
                  rowOpen.current = true;
                }}
                containerStyle={styles.swipeBox}
                childrenContainerStyle={styles.swipeFace}
                renderRightActions={() => (
                  /* activeScale 1: the block is flush with the row's edge, and
                     shrinking it would open a gap. The press still buzzes.
                     Hidden from screen readers: it sits (invisible) UNDER the row
                     while the row is shut, so VoiceOver's activation tap would land
                     on the row's tick instead; the same removal is offered to them
                     as the tick's «Seti sil» action below. */
                  <PressableScale
                    activeScale={1}
                    onPress={() => requestRemove(s.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t('{n} nömrəli seti sil', { n: i + 1 })}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.swipeDelete}>
                    <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '700' }}>{t('Sil')}</AppText>
                  </PressableScale>
                )}>
                <View style={[styles.setRow, s.done && styles.setRowDone]} onTouchStart={closeOpenRow}>
                  <AppText style={[styles.setIndex, { width: 34 }]}>{i + 1}</AppText>
                  <AppText style={{ flex: 1, color: dark.textTertiary, fontSize: 13 }}>{current.prev}</AppText>
                  <TextInput {...inputTintDark}
                    value={s.kg}
                    onChangeText={(v) => update(s.id, 'kg', v)}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholder={current.bodyweight ? t('öz') : '—'}
                    placeholderTextColor={dark.textTertiary}
                  />
                  <TextInput {...inputTintDark}
                    value={s.reps}
                    onChangeText={(v) => update(s.id, 'reps', v)}
                    keyboardType="numeric"
                    style={styles.input}
                    placeholder={String(baseRepOf(current.ex.reps))}
                    placeholderTextColor={dark.textTertiary}
                  />
                  {/* The box stays 40 so the set grid keeps its columns on a narrow phone;
                      hitSlop takes the touch area to 48 (the row is 52 tall).
                      A swipe is invisible to a screen reader, so the same removal
                      is offered as this element's «Seti sil» action. */}
                  <PressableScale
                    activeScale={0.85}
                    onPress={() => toggleSet(s.id)}
                    hitSlop={4}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: s.done }}
                    accessibilityLabel={t('Set {n}', { n: i + 1 })}
                    accessibilityActions={canRemove ? [{ name: 'delete', label: t('Seti sil') }] : undefined}
                    onAccessibilityAction={(e) => {
                      if (e.nativeEvent.actionName === 'delete') requestRemove(s.id);
                    }}
                    style={[styles.check, s.done && { backgroundColor: palette.volt, borderColor: palette.volt }]}>
                    <Icon name="check" size={16} color={s.done ? palette.inkText : dark.textTertiary} />
                  </PressableScale>
                </View>
              </ReanimatedSwipeable>
            ))}

            {/* Set count: − N +. A stepper rather than two word buttons because the
                complaint is about a NUMBER («standart 4 set, azaltmaq olmur»): the
                count sits between the two controls, so each tap shows its result
                where the thumb already is, and − / + read at a glance mid-set with
                no words to parse. It is one compact row, the height of a set row,
                so the list does not grow. − takes the LAST set (a specific one:
                swipe its row left) and is dimmed and disabled at one set. */}
            <View style={styles.setCount} onTouchStart={closeOpenRow}>
              <AppText style={styles.setCountLabel}>{t('Setlər')}</AppText>
              <View style={styles.stepper}>
                <PressableScale
                  activeScale={0.88}
                  onPress={removeLastSet}
                  disabled={!canRemove}
                  accessibilityRole="button"
                  accessibilityLabel={t('Son seti sil')}
                  accessibilityState={{ disabled: !canRemove }}
                  style={[styles.stepBtn, !canRemove && styles.stepBtnOff]}>
                  <MinusGlyph size={iconSize.inCircle} color={palette.white} />
                </PressableScale>
                <AppText style={styles.stepCount} accessibilityLabel={t('{n} set', { n: setCount, count: setCount })}>
                  {String(setCount)}
                </AppText>
                <PressableScale
                  activeScale={0.88}
                  onPress={addSet}
                  disabled={!canAdd}
                  accessibilityRole="button"
                  accessibilityLabel={t('Set əlavə et')}
                  accessibilityState={{ disabled: !canAdd }}
                  style={[styles.stepBtn, !canAdd && styles.stepBtnOff]}>
                  <Icon name="plus" size={iconSize.inCircle} color={palette.white} />
                </PressableScale>
              </View>
            </View>

            {/* A move that was not planned — the machine is taken, or there is time
                for one more. Before this a workout could only ever contain what it
                started with. */}
            <PressableScale activeScale={0.97} onPress={addExercise} style={styles.addExercise} accessibilityRole="button">
              <Icon name="plus" size={16} color={dark.textSecondary} />
              <AppText style={{ color: dark.textSecondary, fontSize: 13.5, fontWeight: '600' }}>{t('Hərəkət əlavə et')}</AppText>
            </PressableScale>
          </View>
        </ScrollView>

        {/* Rest bar */}
        {rest !== null ? (
          <View style={styles.restBar}>
            <AppText style={{ color: palette.volt, fontSize: 14, fontWeight: '700' }}>{t('Fasilə {time}', { time: fmt(rest) })}</AppText>
            <View style={styles.restActions}>
              <PressableScale
                activeScale={0.9}
                onPress={() => adjustRest(-30)}
                accessibilityRole="button"
                accessibilityLabel={t('Fasiləni 30 saniyə azalt')}
                style={styles.restBtn}>
                <AppText style={styles.restBtnText}>−30</AppText>
              </PressableScale>
              <PressableScale
                activeScale={0.9}
                onPress={() => adjustRest(30)}
                accessibilityRole="button"
                accessibilityLabel={t('Fasiləni 30 saniyə artır')}
                style={styles.restBtn}>
                <AppText style={styles.restBtnText}>+30</AppText>
              </PressableScale>
              <PressableScale activeScale={0.94} onPress={stopRest} accessibilityRole="button" style={styles.restSkip}>
                <AppText style={{ color: dark.textSecondary, fontSize: 14, fontWeight: '600' }}>{t('Keç')}</AppText>
              </PressableScale>
            </View>
          </View>
        ) : null}

        {/* Exercise nav + finish */}
        <View style={[styles.navRow, { paddingBottom: navBottom }]}>
          <PressableScale
            activeScale={0.94}
            onPress={() => setCi((c) => Math.max(0, c - 1))}
            disabled={ci === 0}
            accessibilityRole="button"
            accessibilityLabel={t('Əvvəlki hərəkət')}
            accessibilityState={{ disabled: ci === 0 }}
            style={[styles.navBtn, ci === 0 && { opacity: 0.4 }]}>
            <Icon name="chevL" size={iconSize.inCircle} color={palette.white} />
          </PressableScale>
          {ci < logs.length - 1 ? (
            <PressableScale onPress={() => setCi((c) => c + 1)} style={styles.nextBtn}>
              <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '600' }}>{t('Növbəti hərəkət')}</AppText>
            </PressableScale>
          ) : (
            <PressableScale onPress={finish} style={[styles.nextBtn, { backgroundColor: palette.volt }]}>
              <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '700' }}>{t('Məşqi bitir')}</AppText>
            </PressableScale>
          )}
          <PressableScale activeScale={0.94} onPress={finish} style={styles.navBtn} accessibilityRole="button" accessibilityLabel={t('Məşqi bitir')}>
            <Icon name="check" size={iconSize.inCircle} color={palette.volt} />
          </PressableScale>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.inkText },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 48 },
  // 44×44 hit area; the glyph stays left-aligned with the content column below.
  iconBtn: { width: 44, height: 44, justifyContent: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: dark.fill, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center' },
  hint: { gap: 10, marginHorizontal: 20, marginBottom: 14, backgroundColor: 'rgba(198,255,61,0.10)', borderRadius: 12, padding: 12 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accept: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(198,255,61,0.45)' },
  cols: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  colH: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: dark.textTertiary },
  /* The swipeable's outer box clips the red «Sil» to the row's rounded shape and
     carries the gap between rows (the row itself slides, so it cannot). */
  swipeBox: { borderRadius: 12, marginBottom: spacing.sm },
  /* An opaque base under the row: a ticked row's volt tint is translucent, and
     while it slides the red action behind it would show through. Same colour as
     the screen, so at rest nothing changes. */
  swipeFace: { backgroundColor: palette.inkText, borderRadius: 12 },
  swipeDelete: { width: 84, backgroundColor: palette.red, alignItems: 'center', justifyContent: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: dark.surface, borderRadius: 12, paddingHorizontal: 12, height: 52 },
  setRowDone: { backgroundColor: 'rgba(198,255,61,0.14)' },
  setIndex: { color: palette.white, fontSize: 15, fontWeight: '700' },
  input: { width: 64, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', color: palette.white, textAlign: 'center', fontSize: 15, fontWeight: '600' },
  check: { width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: dark.hairline, alignItems: 'center', justifyContent: 'center' },
  // The label lines up with the set numbers above (the rows' own 12 pt inset).
  setCount: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.md, marginTop: spacing.xs },
  setCountLabel: { color: dark.textSecondary, fontSize: 13.5, fontWeight: '600' },
  // 52 tall in all — a set row's height; the buttons inside are 44 × 44 boxes.
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: dark.surface, borderRadius: radius.field, padding: spacing.xs },
  stepBtn: { width: 44, height: 44, borderRadius: radius.input, backgroundColor: dark.fill, alignItems: 'center', justifyContent: 'center' },
  stepBtnOff: { opacity: 0.35 },
  stepCount: { minWidth: 40, textAlign: 'center', color: palette.white, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  restBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 10, backgroundColor: dark.surface, borderRadius: 14, paddingLeft: 16, paddingRight: 4, paddingVertical: 4 },
  restActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // 44 pt boxes: the bar is one row of them, so its own height is the target.
  restBtn: { minWidth: 52, height: 44, borderRadius: 11, backgroundColor: dark.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  restBtnText: { color: palette.white, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  restSkip: { minWidth: 52, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  addExercise: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, marginTop: spacing.sm },
  // paddingBottom is per platform — see `navBottom` in the component.
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20 },
  navBtn: { width: 52, height: 52, borderRadius: 15, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center' },
  nextBtn: { flex: 1, height: 52, borderRadius: 15, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
});
