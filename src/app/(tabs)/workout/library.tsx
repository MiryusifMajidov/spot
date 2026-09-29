import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ProgramCard } from '@/components/ProgramCard';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Program } from '@/data/types';
import { usePrograms } from '@/lib/hooks';
import { useDb } from '@/store/db';
import { iconSize, palette, shadow, spacing } from '@/theme';
import { searchKey } from '@/lib/az';
import { useT } from '@/lib/useT';

/* Three, not five. «İcma» and «Evdə» were a second and third way to slice a
   list that holds a handful of programs, and «Evdə» depended on a tag almost
   nothing carries — so it was usually an empty screen behind a chip. */
const FILTERS = ['Hamısı', 'Mənimkilər', 'Müəllimlər'];

function matches(p: Program, filter: string, mineIds: string[]) {
  switch (filter) {
    case 'Mənimkilər':
      return mineIds.includes(p.id);
    case 'Müəllimlər':
      return p.creatorType === 'trainer';
    default:
      return true;
  }
}

export default function Library() {
  const router = useRouter();
  const t = useT();
  const remote = usePrograms();
  const mine = useDb((s) => s.myPrograms);
  const [filter, setFilter] = useState('Hamısı');
  const [q, setQ] = useState('');
  /* The FAB is pinned to the bottom of a tab screen, so it has to clear the tab bar.
     Android's Material bar reserves its own space (the tab scene already stops above
     it), and `insets.bottom` there is the system navigation bar the tab bar covers —
     adding it would lift the button twice. iOS 26's Liquid Glass bar FLOATS and
     reserves nothing: the FAB sat underneath it. Inside a tab screen UIKit's safe
     area includes that bar, so `insets.bottom` on iOS is the bar's footprint plus the
     home indicator. The list pads by the same amount so its last card can still be
     scrolled clear of both the bar and the FAB. */
  const insets = useSafeAreaInsets();
  const bottomClearance = Platform.OS === 'ios' ? insets.bottom : 0;

  // The user's own programs always come first and are never hidden by a fetch.
  const all = useMemo(() => {
    const ids = new Set(mine.map((p) => p.id));
    return [...mine, ...remote.filter((p) => !ids.has(p.id))];
  }, [mine, remote]);

  const list = useMemo(() => {
    const needle = searchKey(q.trim());
    return all.filter((p) => {
      if (!matches(p, filter, mine.map((m) => m.id))) return false;
      if (!needle) return true;
      return searchKey(p.title + ' ' + p.creatorName + ' ' + p.tags.join(' ') + ' ' + p.goal).includes(needle);
    });
  }, [all, filter, q, mine]);

  const loading = remote.length === 0 && mine.length === 0;
  const [featured, ...rest] = list;

  return (
    <Screen>
      <View style={styles.top}>
        <AppText variant="largeTitle" style={{ marginBottom: 12 }}>
          {t('Proqramlar')}
        </AppText>
        <View style={styles.search}>
          <Icon name="search" size={17} color={palette.caption} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={t('Proqram, müəllif və ya etiket axtar')}
            placeholderTextColor={palette.caption}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {q ? (
            <PressableScale
              activeScale={0.9}
              haptic={false}
              onPress={() => setQ('')}
              style={styles.clearBtn}
              accessibilityRole="button"
              accessibilityLabel={t('Axtarışı təmizlə')}>
              <Icon name="x" size={17} color={palette.caption} />
            </PressableScale>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ marginTop: 12, marginHorizontal: -spacing.screen }}>
          {FILTERS.map((f) => (
            <Chip key={f} label={t(f)} tone="card" selected={filter === f} onPress={() => setFilter(f)} icon={f === 'Müəllimlər' ? 'verified' : undefined} />
          ))}
        </ScrollView>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 100 + bottomClearance }]}
        keyboardShouldPersistTaps="handled">
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Icon name={loading ? 'timer' : 'search'} size={22} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 10 }}>
              {loading ? t('Proqramlar yüklənir…') : t('Bu filtrə uyğun proqram yoxdur')}
            </AppText>
            {!loading ? (
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
                {t('Filtri dəyiş, axtarışı təmizlə — və ya aşağıdakı düymə ilə öz proqramını yarat.')}
              </AppText>
            ) : null}
          </View>
        ) : null}

        {featured ? (
          <View style={{ marginBottom: 12 }}>
            <ProgramCard program={featured} variant="featured" onPress={() => router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: featured.id } })} />
          </View>
        ) : null}
        {rest.map((p) => (
          <View key={p.id} style={{ marginBottom: 12 }}>
            <ProgramCard program={p} variant="row" onPress={() => router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: p.id } })} />
          </View>
        ))}
      </ScrollView>

      <PressableScale
        onPress={() => router.push('/(tabs)/workout/create')}
        style={[styles.fab, { bottom: 28 + bottomClearance }, shadow.floating as object]}
        accessibilityRole="button"
        accessibilityLabel={t('Yeni proqram yarat')}>
        <Icon name="plus" size={iconSize.inCircle} color={palette.volt} />
      </PressableScale>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.screen },
  search: { backgroundColor: palette.fill, borderRadius: 11, height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
  searchInput: { flex: 1, fontSize: 15, color: palette.inkText },
  chips: { paddingHorizontal: spacing.screen, gap: 7 },
  // paddingBottom is set inline: 100 clears the FAB, plus `bottomClearance` on iOS.
  content: { paddingHorizontal: spacing.screen, paddingTop: 16 },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 24 },
  /* A real 44 x 44 hit area. The field is 38 pt tall, so the button — centred by the
     row — overhangs it by 3 pt above and below; it is transparent, so nothing visible
     moves. A box and not hitSlop: React Native never extends a touch area past the
     parent's bounds (iOS Fabric drops a touch outside a view whose children do not
     overflow it), so a 3 pt slop would have stopped at the field's edge. The negative
     margin gives back the field's 10 pt right padding and paddingRight puts it back
     inside the button, so the glyph keeps its place (mirroring the search glyph on
     the left) — only the touch area grew, reaching into the input side. */
  clearBtn: { width: 44, height: 44, marginRight: -10, paddingRight: 10, alignItems: 'flex-end', justifyContent: 'center' },
  // `bottom` is set inline: 28 above the tab bar, plus `bottomClearance` on iOS.
  fab: { position: 'absolute', right: spacing.screen, width: 54, height: 54, borderRadius: 27, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
});
