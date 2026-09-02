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
import {
  exerciseById,
  LibExercise,
  lastLoggedSet,
  programDayExercises,
  sessionExercises,
  useAllPrograms,
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
export const HOME_MOVES: LibExercise[] = [
  { id: 'h-pushup', name: 'Şınov', muscle: 'Sinə', equipment: 'Bədən', defaultSets: 3, reps: '12', videoUrl: '', commonMistake: 'Beli sallamaq. Bədən bir düz xətt olmalıdır.', substitutes: ['Dizüstü şınov', 'Divara şınov'], isCompound: true },
  { id: 'h-squat', name: 'Çöməltmə (squat)', muscle: 'Ayaq', equipment: 'Bədən', defaultSets: 3, reps: '15', videoUrl: '', commonMistake: 'Dabanı yerdən qaldırmaq. Ağırlıq dabanda qalsın.', substitutes: ['Stula oturub-durma'], isCompound: true },
  { id: 'h-plank', name: 'Plank', muscle: 'Qarın', equipment: 'Bədən', defaultSets: 3, reps: '40 san', videoUrl: '', commonMistake: 'Kalçanı qaldırmaq və ya sallamaq.', substitutes: ['Dizüstü plank'], isCompound: false },
  { id: 'h-lunge', name: 'Addımlı çöküş (lunge)', muscle: 'Ayaq', equipment: 'Bədən', defaultSets: 3, reps: '10 hər ayaq', videoUrl: '', commonMistake: 'Dizi barmaqdan çox qabağa çıxarmaq.', substitutes: ['Yerində çöküş'], isCompound: true },
  { id: 'h-burpee', name: 'Burpee', muscle: 'Tam bədən', equipment: 'Bədən', defaultSets: 3, reps: '8', videoUrl: '', commonMistake: 'Tələsib formanı itirmək. Yavaş, amma düzgün.', substitutes: ['Dağ dırmaşması'], isCompound: true },
  { id: 'h-superman', name: 'Superman', muscle: 'Kürək', equipment: 'Bədən', defaultSets: 3, reps: '15', videoUrl: '', commonMistake: 'Boynu arxaya qatlamaq. Baxış aşağıda qalsın.', substitutes: ['Bird-dog'], isCompound: false },
  { id: 'h-climber', name: 'Dağ dırmaşması', muscle: 'Qarın', equipment: 'Bədən', defaultSets: 3, reps: '30 san', videoUrl: '', commonMistake: 'Kalçanı yuxarı qaldırmaq.', substitutes: ['Plank'], isCompound: false },
  { id: 'h-bridge', name: 'Glute bridge', muscle: 'Gluteus', equipment: 'Bədən', defaultSets: 3, reps: '15', videoUrl: '', commonMistake: 'Beli aşırı əymək. Qabırğanı aşağı saxla.', substitutes: ['Hip thrust'], isCompound: false },
  { id: 'h-db-press', name: 'Dumbbell sinə press', muscle: 'Sinə', equipment: 'Dumbbell', defaultSets: 3, reps: '10–12', videoUrl: '', commonMistake: 'Dirsəkləri 90° açmaq.', substitutes: ['Şınov'], isCompound: true },
  { id: 'h-db-row', name: 'Dumbbell dartma', muscle: 'Kürək', equipment: 'Dumbbell', defaultSets: 3, reps: '10–12', videoUrl: '', commonMistake: 'Gövdəni yelləmək.', substitutes: ['Rezinlə dartma'], isCompound: true },
  { id: 'h-goblet', name: 'Goblet squat', muscle: 'Ayaq', equipment: 'Dumbbell', defaultSets: 3, reps: '12', videoUrl: '', commonMistake: 'Dirsəkləri yana açmaq.', substitutes: ['Çöməltmə'], isCompound: true },
  { id: 'h-band-row', name: 'Rezinlə dartma', muscle: 'Kürək', equipment: 'Rezin', defaultSets: 3, reps: '15', videoUrl: '', commonMistake: 'Çiyni yuxarı qaldırmaq.', substitutes: ['Dumbbell dartma'], isCompound: false },
  { id: 'h-band-press', name: 'Rezinlə çiyin press', muscle: 'Çiyin', equipment: 'Rezin', defaultSets: 3, reps: '15', videoUrl: '', commonMistake: 'Beli əymək.', substitutes: ['Dumbbell çiyin press'], isCompound: false },
  { id: 'h-kb-swing', name: 'Kettlebell swing', muscle: 'Arxa ayaq', equipment: 'Kettlebell', defaultSets: 3, reps: '15', videoUrl: '', commonMistake: 'Skvata çevirmək. Hərəkət kalçadandır.', substitutes: ['Glute bridge'], isCompound: true },
  { id: 'h-step-up', name: 'Skamyaya qalxma', muscle: 'Ayaq', equipment: 'Skamya', defaultSets: 3, reps: '10 hər ayaq', videoUrl: '', commonMistake: 'Arxa ayaqla itələmək.', substitutes: ['Addımlı çöküş'], isCompound: true },
  { id: 'h-bench-dip', name: 'Skamyada dips', muscle: 'Triseps', equipment: 'Skamya', defaultSets: 3, reps: '12', videoUrl: '', commonMistake: 'Çiyni qulağa yaxınlaşdırmaq.', substitutes: ['Şınov'], isCompound: false },
];

const homeMove = (id: string) => HOME_MOVES.find((m) => m.id === id)!;

/** Seconds of work for a home move (drives the session countdown). */
export function homeMoveSeconds(ex: LibExercise): number {
  const m = ex.reps.match(/(\d+)\s*san/);
  if (m) return Number(m[1]);
  if (ex.id === 'h-burpee') return 30;
  return 40;
}

/** Repetitions a completed home move is worth (for real volume). */
export function homeMoveReps(ex: LibExercise): number {
  const n = Number(ex.reps.replace(/[^\d]/g, '').slice(0, 2));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** The circuit for a home workout: only moves the user's equipment allows. */
export function homeCircuit(equipment: string[], count: number): LibExercise[] {
  const has = (e: string) => equipment.includes(e);
  const pool = HOME_MOVES.filter((m) => m.equipment === 'Bədən' || has(m.equipment));
  // Turnik → the real library pull-up (it has a form video).
  const pullup = exerciseById('pullup');
  const full = has('Turnik') && pullup ? [...pool, pullup] : pool;
  // Alternate muscle groups so a circuit does not stack two leg moves in a row.
  const order = ['Sinə', 'Ayaq', 'Kürək', 'Qarın', 'Tam bədən', 'Gluteus', 'Çiyin', 'Triseps', 'Arxa ayaq'];
  const sorted = [...full].sort((a, b) => order.indexOf(a.muscle) - order.indexOf(b.muscle));
  const out: LibExercise[] = [];
  const byMuscle = new Map<string, LibExercise[]>();
  for (const m of sorted) byMuscle.set(m.muscle, [...(byMuscle.get(m.muscle) ?? []), m]);
  const groups = [...byMuscle.values()];
  let i = 0;
  while (out.length < count && groups.some((g) => g.length)) {
    const g = groups[i % groups.length];
    const next = g.shift();
    if (next) out.push(next);
    i += 1;
  }
  return out;
}

export interface HomePlan {
  circuit: LibExercise[];
  rounds: number;
  /** flattened running order: circuit repeated `rounds` times */
  moves: LibExercise[];
  minutes: number;
}

/** A real home-workout plan whose move count and round count match the
 *  equipment and the minutes the user actually picked. */
export function homeWorkoutPlan(equipment: string[], minutes: number): HomePlan {
  const mins = Math.max(5, Math.min(90, minutes || 20));
  const count = mins <= 10 ? 4 : mins <= 20 ? 5 : 6;
  const circuit = homeCircuit(equipment, count);
  const perMove = 55; // ~40 san iş + ~15 san keçid
  const rounds = Math.max(1, Math.round((mins * 60) / (Math.max(1, circuit.length) * perMove)));
  const moves: LibExercise[] = [];
  for (let r = 0; r < rounds; r += 1) moves.push(...circuit);
  return { circuit, rounds, moves, minutes: Math.round((moves.length * perMove) / 60) };
}

const HOME_TAGS = ['evdə', 'avadanlıqsız', 'bodyweight', 'ev'];
export function isHomeProgram(p: Program | undefined): boolean {
  if (!p) return false;
  return (p.tags ?? []).some((t) => HOME_TAGS.includes(t.toLowerCase()));
}

/** The exercises of a program day.
 *  1) the day's own exercises when the program's author really wrote them,
 *  2) otherwise NOTHING. A program day whose author left it empty stays empty —
 *     the app must never invent moves from a day title and present them as a
 *     trainer's (or any author's) programming.
 *  The title-derived plan below serves only the program-less «Sərbəst məşq»
 *  session, where the app is openly the one choosing the moves. */
export function resolveDayExercises(program: Program | undefined, dayIndex: number, title: string): LibExercise[] {
  const day = program?.days?.[dayIndex];
  if (day?.exercises?.length) return programDayExercises(program, dayIndex);
  if (program) return [];
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
  const programs = useAllPrograms();
  const program = params.programId ? programs.find((p) => p.id === params.programId) : undefined;
  const dayIndex = Number(params.dayIndex) || 0;
  const day = program?.days?.[dayIndex];
  const title = params.title || day?.title || 'Gün 1';
  const focus = params.focus || day?.focus || 'Tam bədən';

  const exercises = useMemo(() => resolveDayExercises(program, dayIndex, title), [program, dayIndex, title]);
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
            <AppText variant="headline" style={{ marginTop: 10 }}>
              Bu günə hərəkət əlavə olunmayıb
            </AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
              Proqramın müəllifi bu günün hərəkətlərini hələ yazmayıb. Hərəkət kitabxanasından özün seçib başlaya bilərsən.
            </AppText>
            <Button title="Hərəkət kitabxanası" variant="secondary" onPress={() => router.push('/(tabs)/workout/exercises')} style={{ marginTop: 14 }} />
            {isHomeProgram(program) ? (
              <Button
                title="Evdə məşq qur"
                variant="secondary"
                onPress={() => router.push('/(tabs)/workout/home')}
                style={{ marginTop: 8 }}
              />
            ) : null}
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
