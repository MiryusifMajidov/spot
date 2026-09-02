import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ProgramCard } from '@/components/ProgramCard';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Program } from '@/data/types';
import { usePrograms } from '@/lib/hooks';
import { useDb } from '@/store/db';
import { palette, shadow, spacing } from '@/theme';
import { searchKey } from '@/lib/az';

const FILTERS = ['Hamısı', 'Mənimkilər', 'Müəllimlər', 'İcma', 'Evdə'];

function matches(p: Program, filter: string, mineIds: string[]) {
  switch (filter) {
    case 'Mənimkilər':
      return mineIds.includes(p.id);
    case 'Müəllimlər':
      return p.creatorType === 'trainer';
    // SPOT's own starter plans are neither a trainer's nor the community's, so
    // they appear under «Hamısı» only — claiming them for either would be false.
    case 'İcma':
      return p.creatorType === 'user';
    case 'Evdə':
      return p.tags.some((t) => t.toLowerCase().includes('evdə'));
    default:
      return true;
  }
}

export default function Library() {
  const router = useRouter();
  const remote = usePrograms();
  const mine = useDb((s) => s.myPrograms);
  const [filter, setFilter] = useState('Hamısı');
  const [q, setQ] = useState('');

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
          Proqramlar
        </AppText>
        <View style={styles.search}>
          <Icon name="search" size={17} color={palette.caption} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Proqram, müəllif və ya etiket axtar"
            placeholderTextColor={palette.caption}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {q ? (
            <PressableScale activeScale={0.9} haptic={false} onPress={() => setQ('')}>
              <Icon name="x" size={15} color={palette.caption} />
            </PressableScale>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ marginTop: 12, marginHorizontal: -spacing.screen }}>
          {FILTERS.map((f) => (
            <Chip key={f} label={f} tone="card" selected={filter === f} onPress={() => setFilter(f)} icon={f === 'Müəllimlər' ? 'verified' : undefined} />
          ))}
        </ScrollView>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Icon name={loading ? 'timer' : 'search'} size={22} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 10 }}>
              {loading ? 'Proqramlar yüklənir…' : 'Bu filtrə uyğun proqram yoxdur'}
            </AppText>
            {!loading ? (
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6, textAlign: 'center', lineHeight: 18 }}>
                Filtri dəyiş, axtarışı təmizlə — və ya aşağıdakı düymə ilə öz proqramını yarat.
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

      <PressableScale onPress={() => router.push('/(tabs)/workout/create')} style={[styles.fab, shadow.floating as object]}>
        <Icon name="plus" size={26} color={palette.volt} />
      </PressableScale>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.screen },
  search: { backgroundColor: palette.fill, borderRadius: 11, height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
  searchInput: { flex: 1, fontSize: 15, color: palette.inkText },
  chips: { paddingHorizontal: spacing.screen, gap: 7 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 16, paddingBottom: 100 },
  empty: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 16, padding: 24 },
  fab: { position: 'absolute', right: spacing.screen, bottom: 28, width: 54, height: 54, borderRadius: 27, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
});
