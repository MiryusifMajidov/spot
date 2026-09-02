import { useLocalSearchParams, useRouter } from 'expo-router';
import { successFeedback } from '@/lib/feedback';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { logWorkout as logWorkoutApi } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb, useLatestWeight } from '@/store/db';
import { confirm } from '@/store/ui';
import { palette } from '@/theme';
import { homeMoveReps, homeMoveSeconds, homeWorkoutPlan } from './day';

const R = 82;
const CIRC = 2 * Math.PI * R;

export default function HomeSession() {
  const router = useRouter();
  const gate = useAuthGate();
  const params = useLocalSearchParams<{ equip?: string; minutes?: string }>();
  const bodyweight = useLatestWeight();

  const plan = useMemo(
    () => homeWorkoutPlan((params.equip ?? 'Heç nə').split(',').filter(Boolean), Number(params.minutes) || 20),
    [params.equip, params.minutes]
  );

  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(() => homeMoveSeconds(plan.moves[0]));
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const advancing = useRef(false);

  const move = plan.moves[idx];
  const perRound = Math.max(1, plan.circuit.length);
  const round = Math.floor(idx / perRound) + 1;

  // total session clock
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // move countdown — auto-advances (with a haptic) when it hits zero
  useEffect(() => {
    if (paused) return;
    timer.current = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, idx]);

  useEffect(() => {
    if (remaining > 0 || advancing.current) return;
    advancing.current = true;
    if (timer.current) clearInterval(timer.current);
    successFeedback();
    next();
    setTimeout(() => (advancing.current = false), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  const saveAndFinish = (completed: number) => {
    const done = plan.moves.slice(0, completed);
    // Bodyweight work is real work: each completed move is one set at the user's
    // own bodyweight (0 until they log a weight — never an invented number).
    const byName = new Map<string, { name: string; muscle: string; timed: boolean; sets: { weight: number; reps: number; done: boolean }[] }>();
    for (const m of done) {
      const entry = byName.get(m.name) ?? { name: m.name, muscle: m.muscle, timed: /san/i.test(m.reps), sets: [] };
      entry.sets.push({ weight: bodyweight ?? 0, reps: homeMoveReps(m), done: true });
      byName.set(m.name, entry);
    }
    const exercises = [...byName.values()];
    // Time-based work (plank, dağ dırmaşması) has no kq × təkrar volume — count it as 0,
    // exactly like session.tsx does, instead of multiplying seconds by bodyweight.
    const volumeKg = Math.round(
      exercises.reduce((s, e) => s + (e.timed ? 0 : e.sets.reduce((a, x) => a + x.weight * x.reps, 0)), 0)
    );
    const setsDone = exercises.reduce((a, e) => a + e.sets.length, 0);
    const durationMin = Math.max(1, Math.round(elapsed / 60));
    const title = `Evdə · ${plan.circuit.length} hərəkət`;
    const clean = exercises.map(({ name, muscle, sets }) => ({ name, muscle, sets }));

    const workoutId = useDb.getState().logWorkout({ title, exercises: clean, volumeKg, durationMin });
    if (hasSupabaseConfig) {
      logWorkoutApi({ id: workoutId, title, durationSec: elapsed, volumeKg, setsDone }).catch(() => {});
    }
    router.replace({
      pathname: '/(tabs)/workout/summary',
      params: { title, durationSec: String(elapsed), volumeKg: String(volumeKg), setsDone: String(setsDone), maxKg: '0' },
    });
  };

  const next = () => {
    const completed = idx + 1;
    setDoneCount(completed);
    if (completed >= plan.moves.length) {
      if (timer.current) clearInterval(timer.current);
      gate(() => saveAndFinish(completed), 'Məşqi yadda saxlamaq üçün');
      return;
    }
    setIdx(completed);
    setRemaining(homeMoveSeconds(plan.moves[completed]));
  };

  const prev = () => {
    if (idx === 0) return;
    setIdx(idx - 1);
    setRemaining(homeMoveSeconds(plan.moves[idx - 1]));
  };

  const quit = () => {
    if (doneCount === 0 && idx === 0) {
      router.replace('/(tabs)/workout');
      return;
    }
    confirm('Məşqi dayandır?', `${idx} hərəkət bitirmisən. Yadda saxlayaq?`, [
      { label: 'Bitir və yadda saxla', style: 'primary', onPress: () => gate(() => saveAndFinish(idx), 'Məşqi yadda saxlamaq üçün') },
      { label: 'Məşqə davam et', style: 'cancel' },
      { label: 'Saxlamadan çıx', style: 'destructive', onPress: () => router.replace('/(tabs)/workout') },
    ]);
  };

  if (!move) return null;
  const total = homeMoveSeconds(move);
  const progress = 1 - remaining / total;

  return (
    <View style={styles.root}>
      {/* No 'bottom' edge: the Məşq tab scene is already clear of the native tab bar
          in (tabs)/_layout — the floating pill's footprint plus the home indicator. Claiming
          the bottom inset a second time only pushed the «Bitdi · növbəti» row upward. */}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <PressableScale activeScale={0.9} onPress={quit} style={styles.iconBtn}>
            <Icon name="x" size={17} color={palette.white} />
          </PressableScale>
          <View style={{ alignItems: 'center' }}>
            <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>
              Dövrə {round} / {plan.rounds}
            </AppText>
            <AppText style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10.5, marginTop: 5 }}>
              Hərəkət {idx + 1} / {plan.moves.length}
            </AppText>
          </View>
          <PressableScale activeScale={0.9} onPress={() => setPaused((p) => !p)} style={styles.iconBtn}>
            <Icon name={paused ? 'play' : 'timer'} size={17} color={palette.white} />
          </PressableScale>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <AppText style={{ color: palette.white, fontSize: 30, fontWeight: '700', letterSpacing: -0.7, textAlign: 'center' }}>{move.name}</AppText>
            <AppText style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 9, textAlign: 'center' }}>
              {move.reps} · {move.muscle}
            </AppText>

            <View style={{ marginTop: 26, width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={180} height={180} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={90} cy={90} r={R} stroke="rgba(198,255,61,0.18)" strokeWidth={8} fill="none" />
                <Circle cx={90} cy={90} r={R} stroke={palette.volt} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)} />
              </Svg>
              <AppText style={{ color: palette.white, fontSize: 52, fontWeight: '200', letterSpacing: -2 }}>{remaining}</AppText>
              <AppText style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11.5, marginTop: 4 }}>saniyə qalıb</AppText>
            </View>

            <View style={styles.cue}>
              <Icon name="shield" size={14} color={palette.streak} />
              <AppText style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12.5, flex: 1, lineHeight: 18 }}>{move.commonMistake}</AppText>
            </View>

            {idx + 1 < plan.moves.length ? (
              <AppText style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 14 }}>
                Növbəti: {plan.moves[idx + 1].name}
              </AppText>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, paddingBottom: 12 }}>
            <PressableScale activeScale={0.92} onPress={prev} style={styles.sideBtn}>
              <Icon name="chevL" size={21} color={palette.white} />
            </PressableScale>
            <PressableScale activeScale={0.97} onPress={next} style={styles.nextBtn}>
              <AppText style={{ color: palette.inkText, fontSize: 16, fontWeight: '600' }}>
                {idx + 1 >= plan.moves.length ? 'Bitir və yadda saxla' : 'Bitdi · növbəti'}
              </AppText>
            </PressableScale>
            <PressableScale activeScale={0.92} onPress={next} style={styles.sideBtn}>
              <Icon name="chevR" size={21} color={palette.white} />
            </PressableScale>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 8 }}>
            {plan.circuit.map((_, i) => {
              const doneInRound = i < idx % perRound;
              const activeCell = i === idx % perRound;
              return (
                <View key={i} style={[styles.laneCell, doneInRound && styles.laneDone, activeCell && styles.laneActive]}>
                  {doneInRound ? <Icon name="check" size={16} color={palette.volt} /> : null}
                </View>
              );
            })}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.inkText },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  cue: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 24, backgroundColor: 'rgba(255,107,53,0.14)', borderRadius: 14, padding: 13 },
  sideBtn: { width: 56, height: 52, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  nextBtn: { flex: 1, height: 52, borderRadius: 15, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  laneCell: { flex: 1, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  laneDone: { opacity: 0.45 },
  laneActive: { backgroundColor: '#2A2A34', borderWidth: 2, borderColor: palette.volt },
});
