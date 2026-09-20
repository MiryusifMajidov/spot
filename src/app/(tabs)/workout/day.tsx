import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Program } from '@/data/types';
import { useProgram, useProgramPhase } from '@/lib/hooks';
import {
  exerciseById,
  LibExercise,
  lastLoggedSet,
  programDayExercises,
  sessionExercises,
  useDb,
} from '@/store/db';
import { palette, spacing } from '@/theme';

/* ------------------------------------------------------------------ *
 * Shared workout helpers (single source of truth for the Məşq tab).
 * day.tsx owns them; session.tsx / home-session.tsx / home.tsx / index.tsx import.
 * ------------------------------------------------------------------ */

/** Bodyweight moves for the "zalım yoxdur" mode. They are NOT in the shared
 *  exercise library (which is barbell-first), so they are declared here with the
 *  same shape. `videoUrl` is empty on purpose — we do not pretend a form clip
 *  exists; screens check `exerciseById(id)` before offering a video. */
/* The «Evdə məşq» engine used to live here: HOME_MOVES, homeCircuit,
   homeWorkoutPlan, homeMoveReps, isHomeProgram — a second, parallel way of
   building and logging a workout, with its own screen and its own session
   logger. Having two of everything is most of why this tab was impossible to
   follow: a person could not tell which kind of workout they were in, and the
   program builder could only reach one of the two exercise lists.

   The sixteen bodyweight moves were not deleted with it — they are ordinary
   exercises and now sit in `exerciseLibrary` (src/store/db.ts) beside the
   barbell ones, so there is one library, one builder and one logger. */

export function resolveDayExercises(
  program: Program | undefined,
  dayIndex: number,
  title: string,
  programRequested = false
): LibExercise[] {
  const day = program?.days?.[dayIndex];
  if (day?.exercises?.length) return programDayExercises(program, dayIndex);
  if (program || programRequested) return [];
  return sessionExercises(title || '');
}

/** One shared duration estimate (work + rest per set), so no two screens disagree. */
export function estimateDurationMin(exercises: LibExercise[]): number {
  if (!exercises.length) return 0;
  const min = exercises.reduce((a, e) => {
    const perSet = e.equipment === 'Bədən' ? 1.2 : e.isCompound ? 2.8 : 2.2; // dəq/set (iş + fasilə)
    return a + e.defaultSets * perSet;
  }, 0);
  return Math.max(10, Math.round(min + 5)); // + isinmə
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export default function DayDetail() {
  const router = useRouter();
  const params = useLocalSearchParams<{ programId?: string; dayIndex?: string; title?: string; focus?: string }>();
  const workouts = useDb((s) => s.workouts);
  /* `useProgram`, not `useAllPrograms().find()`. The list hook holds only what is
     on this device — the person's own programs and the seeds — so any program
     read from the server was simply absent here, and the day opened with
     invented moves (see `resolveDayExercises`). `useProgram` is the same hook
     the program screen uses: own copy first, then the server. */
  const programId = params.programId ?? '';
  const remote = useProgram(programId);
  const phase = useProgramPhase(programId);
  const program = programId ? (remote ?? undefined) : undefined;
  const dayIndex = Number(params.dayIndex) || 0;
  const day = program?.days?.[dayIndex];
  const title = params.title || day?.title || 'Gün 1';
  const focus = params.focus || day?.focus || 'Tam bədən';

  const exercises = useMemo(() => resolveDayExercises(program, dayIndex, title, !!programId), [program, dayIndex, title, programId]);
  const minutes = program?.minutes || estimateDurationMin(exercises);

  const start = () =>
    router.replace({ pathname: '/(tabs)/workout/session', params: { programId: params.programId ?? '', dayIndex: String(dayIndex), title } });

  /* No 'bottom' edge: the tab scene is already padded by the floating bar's footprint
     (the native tab bar reserves it), which folds the home indicator in. The
     «Məşqə başla» footer sits at the bottom of that padded area. */
  return (
    <Screen edges={['top']}>
      <NavBar />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="title">{title}</AppText>
        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 4 }}>
          {exercises.length ? `${focus} · ${exercises.length} hərəkət · ~${minutes} dəq` : focus}
        </AppText>

        {exercises.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="dumbbell" size={22} color={palette.tertiary} />
            {/* Three different reasons for an empty day, and they are not the
                same sentence. Blaming the author for a day we could not read is
                the same class of lie as inventing the moves was. */}
            <AppText variant="headline" style={{ marginTop: 10 }}>
              {programId && !program
                ? phase === 'failed'
                  ? 'Proqram yüklənmədi'
                  : 'Proqram yüklənir…'
                : 'Bu günə hərəkət əlavə olunmayıb'}
            </AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
              {programId && !program
                ? phase === 'failed'
                  ? 'Bu günün hərəkətlərini oxuya bilmədik — bu, günün boş olduğu demək deyil. Bağlantını yoxla və yenidən aç.'
                  : 'Bir az gözlə.'
                : 'Proqramın müəllifi bu günün hərəkətlərini hələ yazmayıb. Hərəkət kitabxanasından özün seçib başlaya bilərsən.'}
            </AppText>
            <Button title="Hərəkət kitabxanası" variant="secondary" onPress={() => router.push('/(tabs)/workout/exercises')} style={{ marginTop: 14 }} />
          </View>
        ) : (
          <View style={{ marginTop: 20 }}>
            {exercises.map((ex, i) => (
              <ExerciseRow
                key={`${ex.id}-${i}`}
                ex={ex}
                last={lastLoggedSet(workouts, ex.name)}
                onPress={exerciseById(ex.id) ? () => router.push({ pathname: '/(tabs)/workout/exercise', params: { id: ex.id } }) : undefined}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {exercises.length ? (
        <View style={styles.footer}>
          <Button title="Məşqə başla" icon="play" full onPress={start} />
        </View>
      ) : null}
    </Screen>
  );
}

function ExerciseRow({ ex, last, onPress }: { ex: LibExercise; last: { weight: number; reps: number } | null; onPress?: () => void }) {
  return (
    <PressableScale activeScale={onPress ? 0.98 : 1} haptic={!!onPress} onPress={onPress} style={styles.row}>
      <View style={styles.thumb}>
        <Icon name={onPress ? 'play' : 'dumbbell'} size={18} color={palette.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{ex.name}</AppText>
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3 }}>
          {ex.defaultSets} set × {ex.reps} · {ex.muscle}
        </AppText>
        {last ? (
          <View style={styles.lastRow}>
            <Icon name="clock" size={12} color={palette.caption} />
            <AppText variant="caption" color={palette.caption}>
              Keçən dəfə: {last.weight}kg × {last.reps}
            </AppText>
          </View>
        ) : null}
      </View>
      {onPress ? <Icon name="chevR" size={18} color={palette.tertiary} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: palette.white, borderRadius: 14, padding: 12, marginBottom: 10 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 22, marginTop: 20 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
