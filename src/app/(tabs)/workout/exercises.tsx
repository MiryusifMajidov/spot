import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Exercise } from '@/data/types';
import { useAppStore } from '@/store/appStore';
import { exerciseLibrary, gymById, LibExercise, useDb } from '@/store/db';
import { saveProgramDays } from '@/lib/saveProgram';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, spacing, inputTint } from '@/theme';
import { searchKey } from '@/lib/az';
import { useT } from '@/lib/useT';

// «Qarın», not «Core»: an English word in the Azerbaijani chip row (ru Пресс, en Core).
const MUSCLES = ['Sinə', 'Bel', 'Ayaq', 'Çiyin', 'Qol', 'Qarın'];
const MUSCLE_GROUPS: Record<string, string[]> = {
  Sinə: ['Sinə'],
  Bel: ['Kürək'],
  Ayaq: ['Ayaq', 'Arxa ayaq', 'Gluteus', 'Baldır'],
  Çiyin: ['Çiyin'],
  Qol: ['Biseps', 'Triseps'],
  Qarın: ['Qarın'],
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
  const t = useT();
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState('Sinə');
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const gym = homeGymId ? gymById(homeGymId) : undefined;
  const myPrograms = useDb((s) => s.myPrograms);

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
    /* The list keeps taps while the search keyboard is up, so this can run with
       the keyboard still open. The action sheet is drawn at the bottom of the
       app's window and does not lift itself, so it would open behind the keyboard. */
    Keyboard.dismiss();
    if (!myPrograms.length) {
      confirm(t('Hələ proqramın yoxdur'), t('Hərəkəti proqrama əlavə etmək üçün əvvəlcə öz proqramını yarat.'), [
        { label: t('İndi yox'), style: 'cancel' },
        { label: t('Proqram yarat'), style: 'primary', onPress: () => router.push('/(tabs)/workout/create') },
      ]);
      return;
    }
    actionSheet({
      title: t('{name} — hansı proqrama?', { name: t(e.name) }),
      actions: [
        ...myPrograms.map((p) => ({
          label: p.title,
          onPress: () =>
            setTimeout(() => {
              const days = p.days ?? [];
              if (days.length <= 1) {
                void appendTo(p.id, 0, e);
                return;
              }
              actionSheet({
                title: t('Hansı günə?'),
                actions: [
                  ...days.map((d, i) => ({ label: d.title || t('Gün {n}', { n: i + 1 }), onPress: () => void appendTo(p.id, i, e) })),
                  { label: t('Bağla'), style: 'cancel' as const },
                ],
              });
            }, 250),
        })),
        { label: t('Bağla'), style: 'cancel' as const },
      ],
    });
  };

  /**
   * Put one exercise into a day of one of my programs.
   *
   * It used to call `useDb.updateProgram` and stop — AsyncStorage on this
   * phone. So an exercise added to a program other people follow was added for
   * nobody but the person who added it, under a toast that said it had worked.
   * It goes through `saveProgramDays` now, the same write the builder uses, and
   * reports the same three answers.
   */
  const appendTo = async (programId: string, dayIndex: number, e: LibExercise) => {
    const p = useDb.getState().myPrograms.find((x) => x.id === programId);
    if (!p) return;
    const days = p.days?.length ? [...p.days] : [{ title: 'Gün 1', focus: '', exercises: [] }];
    const day = days[dayIndex] ?? days[0];
    if (day.exercises.some((x) => x.id === e.id)) {
      toast(t('{name} artıq bu gündədir', { name: t(e.name) }), 'info');
      return;
    }
    days[dayIndex] = { ...day, exercises: [...day.exercises, toExercise(e)] };
    const where = `${p.title} · ${day.title || t('Gün {n}', { n: dayIndex + 1 })}`;

    const { result, problem } = await saveProgramDays(programId, days);
    if (result === 'failed') {
      toast(t('Əlavə olunmadı. Yenidən cəhd et.'), 'error');
      return;
    }
    if (result === 'refused') {
      toast(problem ?? t('Server qəbul etmədi.'), 'error');
      return;
    }
    if (result === 'local') {
      toast(t('{name} → {where} — hələlik yalnız bu cihazda', { name: t(e.name), where }), 'info');
      return;
    }
    toast(`${t(e.name)} → ${where}`);
  };

  return (
    <Screen edges={['top']}>
      <NavBar title={t('Hərəkətlər')} />
      <View style={{ paddingHorizontal: spacing.screen }}>
        <View style={styles.search}>
          <Icon name="search" size={17} color={palette.tertiary} />
          <TextInput {...inputTint} value={q} onChangeText={setQ} placeholder={t('Hərəkət və ya əzələ axtar')} placeholderTextColor={palette.tertiary} style={styles.searchInput} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 12 }}>
          {MUSCLES.map((m) => (
            <PressableScale
              key={m}
              activeScale={0.95}
              onPress={() => setMuscle(m)}
              /* The chip is drawn 35 pt tall (7 + the 21 pt line + 7); the slop makes the
                 target 45 pt. It stays inside the row's 12 pt vertical padding, so
                 Android honours it too. */
              hitSlop={{ top: 5, bottom: 5 }}
              style={[styles.chip, muscle === m && styles.chipOn]}>
              <AppText style={{ fontSize: 12.5, fontWeight: '600', color: muscle === m ? palette.white : palette.inkText }}>{t(m)}</AppText>
            </PressableScale>
          ))}
        </ScrollView>
      </View>

      {/* A TAB screen: iOS 26's Liquid Glass tab bar floats over it, and 40 pt of end
          padding left the last rows — and their «+» — under the glass. "automatic"
          insets the list by the safe area, which inside a tab includes the bar;
          Android ignores it, the tab scene there already stops above the bar.
          "handled": with the search keyboard up, the first tap on «+» or a thumbnail
          used to be spent closing the keyboard, so the button seemed dead. Both
          now close it themselves. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 }}>
        <AppText variant="caption" color={palette.tertiary} style={{ marginBottom: 12 }}>
          {q
            ? t('Axtarış · {n} nəticə', { n: list.length, count: list.length })
            : t('{muscle} · {n} hərəkət', { muscle: t(muscle), n: list.length, count: list.length })}
          {gym ? ` · ${t('{gym} zalında olanlar öndədir', { gym: gym.name })}` : ''}
        </AppText>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <AppText variant="headline">{t('Nəticə tapılmadı')}</AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center' }}>
              {t('Başqa ad və ya əzələ qrupu yaz.')}
            </AppText>
          </View>
        ) : null}
        <View style={{ gap: 10 }}>
          {list.map((e) => {
            const status = equipmentStatus(e.equipment, gym?.amenities);
            return (
              <View key={e.id} style={styles.row}>
                <PressableScale
                  activeScale={0.97}
                  onPress={() => {
                    Keyboard.dismiss();
                    router.push({ pathname: '/(tabs)/workout/exercise', params: { id: e.id } });
                  }}
                  style={styles.thumb}>
                  <View style={styles.playDot}>
                    <Icon name="play" size={13} color={palette.white} />
                  </View>
                </PressableScale>
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontSize: 15, fontWeight: '600' }}>{t(e.name)}</AppText>
                  <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 5 }}>{t(e.muscle)} · {t(e.equipment)}</AppText>
                  {/* Wraps: «Avadanlıq lazım deyil» next to the sets tag is wider than
                      this column on a 375 pt phone, and unwrapped it slid under the «+». */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                    <View style={styles.tag}>
                      <AppText style={styles.tagText}>{e.defaultSets}×{t(e.reps)}</AppText>
                    </View>
                    {status ? (
                      <View style={[styles.tag, { backgroundColor: 'rgba(198,255,61,0.3)' }]}>
                        <AppText style={[styles.tagText, { color: palette.voltText }]}>
                          {status === 'own' ? t('Avadanlıq lazım deyil') : t('Zalında var')}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                </View>
                <PressableScale
                  activeScale={0.9}
                  onPress={() => addToProgram(e)}
                  style={styles.addBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('Proqrama əlavə et')}>
                  <View style={styles.addDot}>
                    <Icon name="plus" size={20} color={palette.textSecondary} />
                  </View>
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
  /* «Add to a program». It was a 30 pt circle with a 16 px plus, and the circle was
     the whole target. The target is now a real 44 x 44 box (the 70 pt thumbnail
     makes the row taller than that, so it fits without growing it), with a 36 pt
     circle and a 20 px plus inside. marginRight gives back the box's side room, so
     the circle stays flush with the row's content edge and the target reaches 4 pt
     into the row padding. */
  addBtn: { width: 44, height: 44, marginRight: -4, alignItems: 'center', justifyContent: 'center' },
  addDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0F0F3', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 22, marginBottom: 12 },
});
