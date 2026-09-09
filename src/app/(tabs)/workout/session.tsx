import { useLocalSearchParams, useRouter } from 'expo-router';
import { successFeedback, tapFeedback } from '@/lib/feedback';
import { parseDecimal } from '@/lib/az';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { PressableScale } from '@/components/ui/PressableScale';
import { logPR, logWorkout as logWorkoutApi } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { getMyAssignedProgram } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import {
  exerciseById,
  LibExercise,
  lastLoggedSet,
  OverloadSuggestion,
  seedById,
  suggestNext,
  useAllPrograms,
  useDb,
  useLatestWeight,
} from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { dark, palette } from '@/theme';
import { resolveDayExercises } from './day';

type SetState = { kg: string; reps: string; done: boolean };
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

function topRepOf(reps: string): number {
  const n = Number(reps.split('–').pop()?.replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 8;
}
/** The rep/second target a ticked set defaults to when the field is left empty. */
function baseRepOf(reps: string): number {
  const n = Number(reps.split('–')[0]?.replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 8;
}
const isTimed = (reps: string) => /san/i.test(reps);
const isBodyweight = (eq: string) => eq === 'Bədən' || eq === 'Turnik' || eq === 'Bar';

const LIFTS: { lift: string; test: (n: string) => boolean }[] = [
  { lift: 'Skvat', test: (n) => n.toLowerCase().includes('skvat') },
  { lift: 'Bench', test: (n) => n.toLowerCase().includes('bench') },
  { lift: 'Deadlift', test: (n) => n.toLowerCase().includes('deadlift') && !n.toLowerCase().includes('romanian') },
];

export default function Session() {
  const router = useRouter();
  const gate = useAuthGate();
  const params = useLocalSearchParams<{ programId?: string; dayIndex?: string; title?: string; partnerId?: string }>();
  const workouts = useDb((s) => s.workouts);
  // Records set on a device whose set detail never left it — see `save` below.
  const serverPRs = useDb((s) => s.serverPRs);
  const logWorkout = useDb((s) => s.logWorkout);
  const bodyweight = useLatestWeight();

  const programs = useAllPrograms();
  const program = params.programId ? programs.find((p) => p.id === params.programId) : undefined;
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

  // Build the exercise plan + prefill each set with a progressive-overload target.
  const initial = useMemo<ExLog[]>(() => {
    const exs = resolveDayExercises(program, dayIndex, title);
    return exs.map((ex) => {
      const timed = isTimed(ex.reps);
      const bw = isBodyweight(ex.equipment);
      const top = topRepOf(ex.reps);
      const last = lastLoggedSet(workouts, ex.name);
      // The full rule (Asan → +2.5 üst / +5 ayaq, Normal → +2.5 yalnız hədəf
      // vurulubsa, Ağır → eyni çəki, ardıcıl iki Ağır → −5% deload) lives in
      // `suggestNext`; the muscle group decides the upper/lower step.
      const suggestion = timed ? null : suggestNext(workouts, ex.name, top, { muscle: ex.muscle });
      let kg = suggestion ? String(autoApply ? suggestion.weight : suggestion.prevWeight) : last ? String(last.weight) : '';
      let hint = suggestion?.note ?? '';
      if (suggestion && hasTrainer === true) {
        hint = `${suggestion.note}. Məşqçin var — SPOT çəkini özü dəyişmir, təklifi sən qəbul edirsən.`;
      }
      if (!kg && bw && bodyweight) kg = String(bodyweight);
      if (!hint) hint = timed ? `Hədəf ${ex.reps}` : bw ? 'Öz çəkinlə işlə — əlavə ağırlıq varsa kq-a yaz' : `Hədəf ${ex.reps} təkrar`;
      return {
        ex,
        prev: last ? `${last.weight}×${last.reps}` : '—',
        hint,
        timed,
        bodyweight: bw,
        suggestion,
        sets: Array.from({ length: ex.defaultSets }, () => ({ kg, reps: '', done: false })),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, program?.id, dayIndex, autoApply, hasTrainer]);

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
  const draftKey = `spot-session:${params.programId || 'free'}:${dayIndex}:${title}`;
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
          setLogs(d.logs);
          setCi(Math.min(d.ci ?? 0, d.logs.length - 1));
          setStartedAt(d.startedAt);
          toast('Yarımçıq məşqin bərpa olundu', 'info');
        } catch {
          AsyncStorage.removeItem(draftKey).catch(() => {});
        }
        setRestored(true);
      })
      .catch(() => alive && setRestored(true));
    return () => {
      alive = false;
    };
  }, [draftKey]);

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

  const clearDraft = () => AsyncStorage.removeItem(draftKey).catch(() => {});
  useEffect(() => () => { if (restRef.current) clearInterval(restRef.current); }, []);

  /* The set list is where the workout is actually logged, and Android edge-to-edge does
     not resize the window when the numeric keyboard opens: on a 4–5 set exercise the
     lower rows ended up behind it, so the weight being entered was invisible while it
     was typed. Shrink the scroller by the overlap (which also lifts the rest bar and the
     «Məşqi bitir» row with it), then push the content up by the same amount so the row
     just tapped stays where it was. */
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

  const startRest = () => {
    if (restRef.current) clearInterval(restRef.current);
    setRest(90);
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

  const update = (si: number, key: 'kg' | 'reps', val: string) => {
    touched.current = true;
    setLogs((prev) => prev.map((e, ei) => (ei === ci ? { ...e, sets: e.sets.map((s, i) => (i === si ? { ...s, [key]: val } : s)) } : e)));
  };

  /* The suggestion the rule produced, offered instead of applied — see the
     trainer note above. It fills only the sets that are still open. */
  const acceptSuggestion = () => {
    const s = current.suggestion;
    if (!s) return;
    tapFeedback();
    touched.current = true;
    setLogs((prev) =>
      prev.map((e, ei) => (ei === ci ? { ...e, sets: e.sets.map((st) => (st.done ? st : { ...st, kg: String(s.weight) })) } : e))
    );
  };

  const toggleSet = (si: number) => {
    touched.current = true;
    const nowDone = !current.sets[si].done;
    setLogs((prev) =>
      prev.map((e, ei) =>
        ei === ci
          ? {
              ...e,
              sets: e.sets.map((s, i) =>
                i === si
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
      startRest();
    }
  };

  const addSet = () => {
    touched.current = true;
    setLogs((prev) => prev.map((e, ei) => (ei === ci ? { ...e, sets: [...e.sets, { kg: e.sets[e.sets.length - 1]?.kg ?? '', reps: '', done: false }] } : e)));
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
      logWorkoutApi({ id: workoutId, programId: params.programId || null, title, durationSec: elapsed, volumeKg, setsDone }).catch(() => {});
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
      confirm('Heç bir set qeyd olunmayıb', 'Bu məşq statistikana yazılmayacaq. Bağlayaq?', [
        { label: 'Məşqə qayıt', style: 'cancel' },
        { label: 'Qeydiyyatsız bağla', style: 'destructive', onPress: () => router.back() },
      ]);
      return;
    }
    gate(save, 'Məşqi yadda saxlamaq üçün');
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
    confirm('Məşqi dayandır?', `${doneCount} set qeyd etmisən. İndi saxlamasan, məşqi növbəti dəfə açanda qaldığın yerdən davam edə bilərsən.`, [
      { label: 'Bitir və yadda saxla', style: 'primary', onPress: () => gate(save, 'Məşqi yadda saxlamaq üçün') },
      { label: 'Məşqə davam et', style: 'cancel' },
      { label: 'Sonra davam edərəm', onPress: () => router.back() },
      { label: 'Sil və çıx', style: 'destructive', onPress: () => { clearDraft(); router.back(); } },
    ]);
  };

  if (!current) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView edges={['top']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 }}>
          <Icon name="dumbbell" size={26} color={dark.textTertiary} />
          <AppText style={{ color: palette.white, fontSize: 17, fontWeight: '600', marginTop: 12, textAlign: 'center' }}>
            Bu günə hərəkət təyin olunmayıb
          </AppText>
          <AppText style={{ color: dark.textSecondary, fontSize: 13.5, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            Proqramın bu gününə hərəkət əlavə olunmayıb. Kitabxanadan hərəkət seçib öz məşqini qura bilərsən.
          </AppText>
          <PressableScale onPress={() => router.back()} style={[styles.nextBtn, { marginTop: 20, paddingHorizontal: 24, flex: undefined }]}>
            <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '600' }}>Geri</AppText>
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
     carry it. */
  const openSet = current.sets.find((s) => !s.done);
  const showAccept =
    !!current.suggestion &&
    !autoApply &&
    current.suggestion.weight !== current.suggestion.prevWeight &&
    !!openSet &&
    openSet.kg !== String(current.suggestion.weight);

  const libraryEntry = exerciseById(current.ex.id);
  const hasDetail = !!libraryEntry;
  const hasVideo = !!libraryEntry?.videoUrl;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* No 'bottom' edge: this screen lives inside the Məşq tab scene, which (tabs)/_layout
          already pads by the native tab bar's own reserved space,
          home indicator included. Taking the bottom inset again here pushed «Məşqi bitir»
          up by another inset's worth and left a dead band under it. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <PressableScale activeScale={0.9} onPress={quit} style={styles.iconBtn}>
            <Icon name="x" size={22} color={palette.white} />
          </PressableScale>
          <View style={{ alignItems: 'center' }}>
            <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{title}</AppText>
            <AppText style={{ color: dark.textTertiary, fontSize: 12, marginTop: 2 }}>
              Hərəkət {ci + 1} / {logs.length}{partner ? ` · ${partner.name} ilə` : ''}
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
          scrollEventThrottle={16}>
          {/* Exercise + form video */}
          <View style={styles.exercise}>
            <PressableScale
              activeScale={hasDetail ? 0.92 : 1}
              haptic={hasDetail}
              onPress={hasDetail ? () => router.push({ pathname: '/(tabs)/workout/exercise', params: { id: current.ex.id } }) : undefined}
              style={styles.thumb}>
              <Icon name={hasVideo ? 'play' : 'target'} size={22} color={hasDetail ? palette.volt : dark.textTertiary} />
            </PressableScale>
            <View style={{ flex: 1 }}>
              <AppText style={{ color: palette.white, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>{current.ex.name}</AppText>
              <AppText style={{ color: dark.textSecondary, fontSize: 13.5, marginTop: 4 }}>
                {current.sets.length} set · {current.ex.reps} · {current.ex.muscle}
              </AppText>
            </View>
          </View>

          {/* Progressive-overload hint */}
          <View style={styles.hint}>
            <View style={styles.hintRow}>
              <Icon name={current.suggestion?.deload ? 'shield' : 'target'} size={13} color={palette.volt} />
              <AppText style={{ color: dark.textSecondary, fontSize: 12.5, flex: 1 }}>
                Keçən dəfə: {current.prev}. {current.hint}
              </AppText>
            </View>
            {showAccept ? (
              <PressableScale activeScale={0.97} onPress={acceptSuggestion} style={styles.accept}>
                <Icon name="check" size={14} color={palette.volt} />
                <AppText style={{ color: palette.volt, fontSize: 12.5, fontWeight: '700' }}>
                  Təklifi qəbul et — {current.suggestion!.weight} kq
                </AppText>
              </PressableScale>
            ) : null}
          </View>

          {/* Column headers */}
          <View style={styles.cols}>
            <AppText style={[styles.colH, { width: 34 }]}>SET</AppText>
            <AppText style={[styles.colH, { flex: 1 }]}>ƏVVƏLKİ</AppText>
            <AppText style={[styles.colH, { width: 64, textAlign: 'center' }]}>KQ</AppText>
            <AppText style={[styles.colH, { width: 64, textAlign: 'center' }]}>{current.timed ? 'SANİYƏ' : 'TƏKRAR'}</AppText>
            <View style={{ width: 40 }} />
          </View>

          {/* Sets */}
          <View style={{ paddingHorizontal: 20 }}>
            {current.sets.map((s, i) => (
              <View key={i} style={[styles.setRow, s.done && styles.setRowDone]}>
                <AppText style={[styles.setIndex, { width: 34 }]}>{i + 1}</AppText>
                <AppText style={{ flex: 1, color: dark.textTertiary, fontSize: 13 }}>{current.prev}</AppText>
                <TextInput
                  value={s.kg}
                  onChangeText={(v) => update(i, 'kg', v)}
                  keyboardType="numeric"
                  style={styles.input}
                  placeholder={current.bodyweight ? 'öz' : '—'}
                  placeholderTextColor={dark.textTertiary}
                />
                <TextInput
                  value={s.reps}
                  onChangeText={(v) => update(i, 'reps', v)}
                  keyboardType="numeric"
                  style={styles.input}
                  placeholder={String(baseRepOf(current.ex.reps))}
                  placeholderTextColor={dark.textTertiary}
                />
                <PressableScale activeScale={0.85} onPress={() => toggleSet(i)} style={[styles.check, s.done && { backgroundColor: palette.volt, borderColor: palette.volt }]}>
                  <Icon name="check" size={16} color={s.done ? palette.inkText : dark.textTertiary} />
                </PressableScale>
              </View>
            ))}
            <PressableScale activeScale={0.97} onPress={addSet} style={styles.addSet}>
              <Icon name="plus" size={16} color={dark.textSecondary} />
              <AppText style={{ color: dark.textSecondary, fontSize: 13.5, fontWeight: '600' }}>Set əlavə et</AppText>
            </PressableScale>
          </View>
        </ScrollView>

        {/* Rest bar */}
        {rest !== null ? (
          <View style={styles.restBar}>
            <AppText style={{ color: palette.volt, fontSize: 14, fontWeight: '700' }}>Fasilə {fmt(rest)}</AppText>
            <PressableScale activeScale={0.94} onPress={() => setRest(null)}>
              <AppText style={{ color: dark.textSecondary, fontSize: 14, fontWeight: '600' }}>Keç</AppText>
            </PressableScale>
          </View>
        ) : null}

        {/* Exercise nav + finish */}
        <View style={styles.navRow}>
          <PressableScale activeScale={0.94} onPress={() => setCi((c) => Math.max(0, c - 1))} disabled={ci === 0} style={[styles.navBtn, ci === 0 && { opacity: 0.4 }]}>
            <Icon name="chevL" size={20} color={palette.white} />
          </PressableScale>
          {ci < logs.length - 1 ? (
            <PressableScale onPress={() => setCi((c) => c + 1)} style={styles.nextBtn}>
              <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '600' }}>Növbəti hərəkət</AppText>
            </PressableScale>
          ) : (
            <PressableScale onPress={finish} style={[styles.nextBtn, { backgroundColor: palette.volt }]}>
              <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '700' }}>Məşqi bitir</AppText>
            </PressableScale>
          )}
          <PressableScale activeScale={0.94} onPress={finish} style={styles.navBtn}>
            <Icon name="check" size={20} color={palette.volt} />
          </PressableScale>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.inkText },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, height: 48 },
  iconBtn: { width: 40, height: 40, justifyContent: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: dark.fill, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  exercise: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 16 },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center' },
  hint: { gap: 10, marginHorizontal: 20, marginBottom: 14, backgroundColor: 'rgba(198,255,61,0.10)', borderRadius: 12, padding: 12 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accept: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(198,255,61,0.45)' },
  cols: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  colH: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: dark.textTertiary },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: dark.surface, borderRadius: 12, paddingHorizontal: 12, height: 52, marginBottom: 8 },
  setRowDone: { backgroundColor: 'rgba(198,255,61,0.14)' },
  setIndex: { color: palette.white, fontSize: 15, fontWeight: '700' },
  input: { width: 64, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', color: palette.white, textAlign: 'center', fontSize: 15, fontWeight: '600' },
  check: { width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: dark.hairline, alignItems: 'center', justifyContent: 'center' },
  addSet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, marginTop: 2 },
  restBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginBottom: 10, backgroundColor: dark.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 6 },
  navBtn: { width: 52, height: 52, borderRadius: 15, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center' },
  nextBtn: { flex: 1, height: 52, borderRadius: 15, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
});
