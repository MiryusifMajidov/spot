import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Exercise } from '@/data/types';
import { useAppStore } from '@/store/appStore';
import { exerciseLibrary, gymById, LibExercise, useDb } from '@/store/db';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { searchKey } from '@/lib/az';

const MUSCLES = ['Sinə', 'Bel', 'Ayaq', 'Çiyin', 'Qol', 'Core'];
const MUSCLE_GROUPS: Record<string, string[]> = {
  Sinə: ['Sinə'],
  Bel: ['Kürək'],
  Ayaq: ['Ayaq', 'Arxa ayaq', 'Gluteus', 'Baldır'],
  Çiyin: ['Çiyin'],
  Qol: ['Biseps', 'Triseps'],
  Core: ['Qarın'],
};

/** Which amenity proves a gym has this kind of equipment.
 *  Returns null when the gym's data cannot tell us — then we show nothing
 *  instead of claiming something about the user's gym. */
function equipmentStatus(equipment: string, amenities: string[] | undefined): 'own' | 'yes' | null {
  if (equipment === 'Bədən') return 'own';
  if (!amenities?.length) return null;
  const free = ['Ştanq', 'Dumbbell', 'Bar', 'Kettlebell'];
  if (free.includes(equipment) && amenities.includes('Sərbəst ağırlıq')) return 'yes';
  if (equipment === 'Kardio' && amenities.includes('Kardio zonası')) return 'yes';
  return null;
}

const toExercise = (m: LibExercise): Exercise => ({
  id: m.id,
  name: m.name,
  muscle: m.muscle,
  sets: m.defaultSets,
  reps: m.reps,
  commonMistake: m.commonMistake,
  substitutes: m.substitutes,
});

export default function ExerciseLibrary() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('Sinə');
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const gym = homeGymId ? gymById(homeGymId) : undefined;
  const myPrograms = useDb((s) => s.myPrograms);
  const updateProgram = useDb((s) => s.updateProgram);

  const list = useMemo(() => {
    const base = exerciseLibrary.filter((e) =>
      q ? searchKey(e.name + ' ' + e.muscle + ' ' + e.equipment).includes(searchKey(q)) : (MUSCLE_GROUPS[muscle] ?? []).includes(e.muscle)
    );
    // available-at-your-gym first — so the caption below is actually true
    return [...base].sort((a, b) => {
      const rank = (e: LibExercise) => (equipmentStatus(e.equipment, gym?.amenities) ? 0 : 1);
      return rank(a) - rank(b);
    });
  }, [q, muscle, gym?.amenities]);

  /** Add an exercise to a day of one of the user's own programs — a real write. */
  const addToProgram = (e: LibExercise) => {
    if (!myPrograms.length) {
      confirm('Hələ proqramın yoxdur', 'Hərəkəti proqrama əlavə etmək üçün əvvəlcə öz proqramını yarat.', [
        { label: 'İndi yox', style: 'cancel' },
        { label: 'Proqram yarat', style: 'primary', onPress: () => router.push('/(tabs)/workout/create') },
      ]);
      return;
    }
    actionSheet({
      title: `${e.name} — hansı proqrama?`,
      actions: [
        ...myPrograms.map((p) => ({
          label: p.title,
          onPress: () =>
            setTimeout(() => {
              const days = p.days ?? [];
              if (days.length <= 1) {
                appendTo(p.id, 0, e);
                return;
              }
              actionSheet({
                title: 'Hansı günə?',
                actions: [
                  ...days.map((d, i) => ({ label: d.title || `Gün ${i + 1}`, onPress: () => appendTo(p.id, i, e) })),
                  { label: 'Bağla', style: 'cancel' as const },
                ],
              });
            }, 250),
        })),
        { label: 'Bağla', style: 'cancel' as const },
      ],
    });
  };

  const appendTo = (programId: string, dayIndex: number, e: LibExercise) => {
    const p = useDb.getState().myPrograms.find((x) => x.id === programId);
    if (!p) return;
    const days = p.days?.length ? [...p.days] : [{ title: 'Gün 1', focus: '', exercises: [] }];
    const day = days[dayIndex] ?? days[0];
    if (day.exercises.some((x) => x.id === e.id)) {
      toast(`${e.name} artıq bu gündədir`, 'info');
      return;
    }
    days[dayIndex] = { ...day, exercises: [...day.exercises, toExercise(e)] };
    updateProgram(programId, { days });
    toast(`${e.name} → ${p.title} · ${day.title || `Gün ${dayIndex + 1}`}`);
  };

  return (
    <Screen edges={['top']}>
      <NavBar title="Hərəkətlər" />
      <View style={{ paddingHorizontal: spacing.screen }}>
        <View style={styles.search}>
          <Icon name="search" size={17} color={palette.tertiary} />
          <TextInput value={q} onChangeText={setQ} placeholder="Hərəkət və ya əzələ axtar" placeholderTextColor={palette.tertiary} style={styles.searchInput} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 12 }}>
          {MUSCLES.map((m) => (
            <PressableScale key={m} activeScale={0.95} onPress={() => setMuscle(m)} style={[styles.chip, muscle === m && styles.chipOn]}>
              <AppText style={{ fontSize: 12.5, fontWeight: '600', color: muscle === m ? palette.white : palette.inkText }}>{m}</AppText>
            </PressableScale>
          ))}
        </ScrollView>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 }}>
        <AppText variant="caption" color={palette.tertiary} style={{ marginBottom: 12 }}>
          {q ? `Axtarış · ${list.length} nəticə` : `${muscle} · ${list.length} hərəkət`}
          {gym ? ` · ${gym.name}-də olanlar öndədir` : ''}
        </AppText>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="headline">Nəticə tapılmadı</AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center' }}>
              Başqa ad və ya əzələ qrupu yaz.
            </AppText>
          </View>
        ) : null}
        <View style={{ gap: 10 }}>
          {list.map((e) => {
            const status = equipmentStatus(e.equipment, gym?.amenities);
            return (
              <View key={e.id} style={styles.row}>
                <PressableScale activeScale={0.97} onPress={() => router.push({ pathname: '/(tabs)/workout/exercise', params: { id: e.id } })} style={styles.thumb}>
                  <View style={styles.playDot}>
                    <Icon name="play" size={13} color={palette.white} />
                  </View>
                </PressableScale>
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontSize: 15, fontWeight: '600' }}>{e.name}</AppText>
                  <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 5 }}>{e.muscle} · {e.equipment}</AppText>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 7 }}>
                    <View style={styles.tag}>
                      <AppText style={styles.tagText}>{e.defaultSets}×{e.reps}</AppText>
                    </View>
                    {status ? (
                      <View style={[styles.tag, { backgroundColor: 'rgba(198,255,61,0.3)' }]}>
                        <AppText style={[styles.tagText, { color: '#3F5500' }]}>
                          {status === 'own' ? 'Avadanlıq lazım deyil' : 'Zalında var'}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                </View>
                <PressableScale activeScale={0.9} onPress={() => addToProgram(e)} style={styles.addBtn}>
                  <Icon name="plus" size={16} color={palette.textSecondary} />
                </PressableScale>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(118,118,128,0.12)', borderRadius: 11, height: 40, paddingHorizontal: 10 },
  searchInput: { flex: 1, fontSize: 15, color: palette.inkText },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: palette.white },
  chipOn: { backgroundColor: palette.ink },
  row: { backgroundColor: palette.white, borderRadius: 16, padding: 12, flexDirection: 'row', gap: 12, alignItems: 'center' },
  thumb: { width: 70, height: 70, borderRadius: 13, backgroundColor: '#D9D9DF', alignItems: 'center', justifyContent: 'center' },
  playDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(11,11,14,0.6)', alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: palette.grouped },
  tagText: { fontSize: 10.5, fontWeight: '600', color: '#3A3A42' },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0F0F3', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 22, marginBottom: 12 },
});
