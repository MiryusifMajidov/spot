import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { searchKey } from '@/lib/az';
import { exerciseLibrary } from '@/store/db';
import { itemFromLibrary, itemFromName, useProgramDraft } from '@/store/programDraft';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * Choosing what goes into a day.
 *
 * What this replaces: two stacked action sheets — muscle group, a 250 ms pause,
 * then one exercise, sheet closes. Three taps and a blank second per move, so
 * an eight-move day cost twenty-four taps, with no search, no way to see what
 * was already in the day, and no way to add a move SPOT's library has never
 * heard of. People who coach for a living do not have a barbell-only
 * vocabulary.
 *
 * So: one screen, search, tap to select as many as you like, and one button to
 * put them all in. Plus a field for a move the author names themselves, which
 * is the only reason a real trainer can write a real program here.
 */

const GROUPS: { label: string; muscles: string[] }[] = [
  { label: 'Hamısı', muscles: [] },
  { label: 'Sinə', muscles: ['Sinə'] },
  { label: 'Kürək', muscles: ['Kürək'] },
  { label: 'Ayaq', muscles: ['Ayaq', 'Arxa ayaq', 'Gluteus', 'Baldır'] },
  { label: 'Çiyin', muscles: ['Çiyin'] },
  { label: 'Qol', muscles: ['Biseps', 'Triseps'] },
  { label: 'Core', muscles: ['Qarın'] },
  { label: 'Tam bədən', muscles: ['Tam bədən'] },
];

export default function PickExercises() {
  const router = useRouter();
  const { dayKey } = useLocalSearchParams<{ dayKey?: string }>();
  const addItems = useProgramDraft((s) => s.addItems);
  const days = useProgramDraft((s) => s.days);
  const day = days.find((d) => d.key === dayKey);

  const [q, setQ] = useState('');
  const [group, setGroup] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState('');

  const list = useMemo(() => {
    const key = searchKey(q.trim());
    return exerciseLibrary.filter((e) => {
      if (key) return searchKey(`${e.name} ${e.muscle} ${e.equipment}`).includes(key);
      const g = GROUPS[group];
      return g.muscles.length === 0 || g.muscles.includes(e.muscle);
    });
  }, [q, group]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const done = () => {
    if (!dayKey) return;
    // Kept in the order they were TAPPED, not the order the library lists them:
    // the author is writing a sequence, and a program that reorders their day
    // behind their back is the same class of bug as rewriting their sets.
    const items = picked.map(itemFromLibrary).filter((x): x is NonNullable<typeof x> => !!x);
    const typed = own.trim();
    if (typed) items.push(itemFromName(typed));
    if (!items.length) {
      toast('Ən azı bir hərəkət seç', 'info');
      return;
    }
    addItems(dayKey, items);
    router.back();
  };

  const count = picked.length + (own.trim() ? 1 : 0);

  return (
    <Screen edges={['top']}>
      <NavBar title={day ? day.title : 'Hərəkət seç'} />

      <View style={styles.searchWrap}>
        <Icon name="search" size={17} color={palette.caption} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Hərəkət axtar"
          placeholderTextColor={palette.caption}
          style={styles.search}
          autoCorrect={false}
        />
        {q ? (
          <PressableScale activeScale={0.9} haptic={false} onPress={() => setQ('')}>
            <Icon name="x" size={16} color={palette.caption} />
          </PressableScale>
        ) : null}
      </View>

      {!q ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {GROUPS.map((g, i) => (
            <PressableScale
              key={g.label}
              activeScale={0.95}
              onPress={() => setGroup(i)}
              style={[styles.chip, i === group ? styles.chipOn : null]}>
              <AppText variant="subhead" color={i === group ? palette.white : palette.textSecondary}>
                {g.label}
              </AppText>
            </PressableScale>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {list.map((e) => {
          const on = picked.includes(e.id);
          return (
            <PressableScale key={e.id} activeScale={0.98} onPress={() => toggle(e.id)} style={[styles.row, on ? styles.rowOn : null]}>
              <View style={{ flex: 1 }}>
                <AppText variant="headline">{e.name}</AppText>
                <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
                  {e.muscle} · {e.equipment}
                </AppText>
              </View>
              <View style={[styles.check, on ? styles.checkOn : null]}>
                {on ? <Icon name="check" size={14} color={palette.ink} /> : null}
              </View>
            </PressableScale>
          );
        })}

        {list.length === 0 ? (
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 26, lineHeight: 21 }}>
            «{q}» üçün kitabxanada nəticə yoxdur. Aşağıda öz adınla yaza bilərsən.
          </AppText>
        ) : null}

        {/* A move SPOT has never heard of. The library is barbell-first and
            finite; a coach's own progression, a machine in their gym, a
            rehab drill — none of it is in there, and before this the program
            simply could not contain it. */}
        <View style={styles.ownBox}>
          <AppText variant="overline" color={palette.caption}>
            Öz hərəkətini yaz
          </AppText>
          <TextInput
            value={own}
            onChangeText={setOwn}
            placeholder="Məsələn: Bolqar split skvat"
            placeholderTextColor={palette.caption}
            maxLength={80}
            style={styles.ownInput}
          />
          <AppText variant="caption" color={palette.caption} style={{ marginTop: 6, lineHeight: 17 }}>
            Kitabxanada olmayan hərəkəti buraya yaz — set və təkrarını növbəti ekranda özün təyin edəcəksən.
          </AppText>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={count === 0 ? 'Hərəkət seç' : count === 1 ? '1 hərəkət əlavə et' : `${count} hərəkət əlavə et`}
          full
          disabled={count === 0}
          onPress={done}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: spacing.screen,
    paddingHorizontal: 13,
    height: 44,
    borderRadius: radius.field,
    backgroundColor: palette.grouped,
  },
  search: { flex: 1, fontSize: 16, color: palette.inkText, padding: 0 },
  chips: { paddingHorizontal: spacing.screen, gap: 8, paddingVertical: 12 },
  chip: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: palette.ink },
  content: { paddingHorizontal: spacing.screen, paddingTop: 6, paddingBottom: 30 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.separator,
    padding: 13,
    marginBottom: 8,
  },
  rowOn: { borderColor: palette.ink },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: palette.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.volt, borderColor: palette.volt },
  ownBox: { backgroundColor: palette.white, borderRadius: 16, padding: 14, marginTop: 14 },
  ownInput: {
    marginTop: 10,
    backgroundColor: palette.grouped,
    borderRadius: radius.field,
    paddingHorizontal: 13,
    height: 48,
    fontSize: 16,
    color: palette.inkText,
  },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
