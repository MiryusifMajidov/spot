import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { estimateDuration, repsText } from '@/lib/duration';
import { weight as formatWeight } from '@/lib/format';
import { useT } from '@/lib/useT';
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

/** One shared duration estimate, so no two screens disagree — the rule itself
 *  now lives in src/lib/duration.ts, because the program SAVE path needs the
 *  same answer and a screen is the wrong place for a library to import from. */
export function estimateDurationMin(exercises: LibExercise[]): number {
  return estimateDuration(
    exercises.map((e) => ({ sets: e.defaultSets, reps: e.reps, equipment: e.equipment, isCompound: e.isCompound }))
  );
}

/* ------------------------------------------------------------------ *
 * Screen
 * ------------------------------------------------------------------ */

export default function DayDetail() {
  const router = useRouter();
  const t = useT();
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

  /* The bottom differs per platform, so it is not a Screen edge. Android's Material
     tab bar reserves its own space (the tab scene already stops above it), and
     `insets.bottom` there is the system navigation bar the tab bar covers — adding
     it would lift the footer twice. iOS 26's Liquid Glass bar FLOATS and reserves
     nothing: content runs underneath it, and it hid «Məşqə başla». Inside a tab
     screen UIKit's safe area includes that bar, so `insets.bottom` on iOS is the
     bar's footprint plus the home indicator — the footer pads by exactly that. */
  const insets = useSafeAreaInsets();
  const bottomClearance = Platform.OS === 'ios' ? insets.bottom : 0;
  const hasFooter = exercises.length > 0;

  return (
    <Screen edges={['top']}>
      <NavBar />
      {/* With the footer below it in the layout flow, the list already ends where the
          footer begins. Without one (an empty day) the content must still clear the
          floating bar on iOS. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: (hasFooter ? 0 : bottomClearance) + spacing.lg }]}>
        <AppText variant="title">{t(title)}</AppText>
        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 4 }}>
          {exercises.length
            ? t('{focus} · {n} hərəkət · ~{min} dəq', { focus: t(focus), n: exercises.length, min: minutes, count: exercises.length })
            : t(focus)}
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
                  ? t('Proqram yüklənmədi')
                  : t('Proqram yüklənir…')
                : t('Bu günə hərəkət əlavə olunmayıb')}
            </AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
              {programId && !program
                ? phase === 'failed'
                  ? t('Bu günün hərəkətlərini oxuya bilmədik — bu, günün boş olduğu demək deyil. Bağlantını yoxla və yenidən aç.')
                  : t('Bir az gözlə.')
                : t('Proqramın müəllifi bu günün hərəkətlərini hələ yazmayıb. Hərəkətləri özün seçib başlaya bilərsən.')}
            </AppText>
            {/* To the picker, which can start a workout — not to the exercise
                library, which is for browsing and cannot. Only when the day is
                really empty: a day that failed to load is not an invitation to
                replace it. */}
            {programId && !program ? null : (
              <Button
                title={t('Hərəkət seç')}
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/workout/pick-exercises',
                    params: { mode: 'session', programId, dayIndex: String(dayIndex), title },
                  })
                }
                style={{ marginTop: 14 }}
              />
            )}
          </View>
        ) : (
          <View style={{ marginTop: 20 }}>
            {exercises.map((ex, i) => (
              <ExerciseRow
                key={`${ex.id}-${i}`}
                ex={ex}
                last={lastLoggedSet(workouts, ex.name)}
                /* Openable when SPOT knows the move OR when the program's
                   author filmed it themselves. The second case is the whole
                   point of a coach attaching a clip: the person doing the
                   workout has to be able to watch it. */
                onPress={
                  exerciseById(ex.id) || ex.videoUrl
                    ? () =>
                        router.push({
                          pathname: '/(tabs)/workout/exercise',
                          params: {
                            id: ex.id,
                            name: ex.name,
                            muscle: ex.muscle,
                            sets: String(ex.defaultSets),
                            reps: ex.reps,
                            video: ex.videoUrl || '',
                          },
                        })
                    : undefined
                }
              />
            ))}
          </View>
        )}
      </ScrollView>

      {hasFooter ? (
        <View style={[styles.footer, { paddingBottom: bottomClearance + spacing.sm }]}>
          <Button title={t('Məşqə başla')} icon="play" full onPress={start} />
        </View>
      ) : null}
    </Screen>
  );
}

function ExerciseRow({ ex, last, onPress }: { ex: LibExercise; last: { weight: number; reps: number } | null; onPress?: () => void }) {
  const t = useT();
  return (
    <PressableScale activeScale={onPress ? 0.98 : 1} haptic={!!onPress} onPress={onPress} style={styles.row}>
      <View style={styles.thumb}>
        <Icon name={onPress ? 'play' : 'dumbbell'} size={18} color={palette.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{t(ex.name)}</AppText>
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3 }}>
          {/* Joined, not concatenated with «·» between fixed slots. An
              exercise the author typed themselves has no muscle — the library
              is where that comes from — and the fixed version rendered
              «3 set × 45 san · » with a dangling separator. */}
          {[t('{sets} set × {reps}', { sets: ex.defaultSets, reps: repsText(ex.reps, t), count: ex.defaultSets }).trim(), t(ex.muscle)].filter(Boolean).join(' · ')}
        </AppText>
        {/* `lastLoggedSet` falls back to the first set when none was ticked done, and
            that set can be empty — «Keçən dəfə: 0 təkrar» says nothing, so no row. */}
        {last && (last.weight > 0 || last.reps > 0) ? (
          <View style={styles.lastRow}>
            <Icon name="clock" size={12} color={palette.caption} />
            <AppText variant="caption" color={palette.caption}>
              {/* The set is written the way the history screen writes it: «22,5 kq × 8»
                  (the language's decimal mark, the app's own unit), and a bodyweight
                  move shows its reps alone instead of «0 kq × 15». */}
              {t('Keçən dəfə: {set}', {
                set:
                  last.weight > 0
                    ? t('{weight} kq × {reps}', { weight: formatWeight(last.weight), reps: last.reps })
                    : t('{n} təkrar', { n: last.reps, count: last.reps }),
              })}
            </AppText>
          </View>
        ) : null}
      </View>
      {onPress ? <Icon name="chevR" size={18} color={palette.tertiary} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: palette.white, borderRadius: 14, padding: 12, marginBottom: 10 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 22, marginTop: 20 },
  // paddingBottom is set inline: it carries the iOS floating-bar clearance.
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
