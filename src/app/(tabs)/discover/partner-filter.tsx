import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { GOALS, LEVELS, TIME_SLOTS, WORKOUT_TYPES } from '@/data/mock';
import { usePartnersForGym } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { AGE_BUCKETS, applyPartnerFilter, useDiscoverPrefs, womenOnlyAllowed } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';

export default function PartnerFilter() {
  const router = useRouter();
  // No fallback gym: the count below must describe the user's real pool, not a
  // catalogue gym's. With no gym chosen there is no pool and we say so.
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const gender = useAppStore((s) => s.profile.gender);
  // The SWITCH is offered to women only — see the comment on it below.
  const isWoman = gender === 'qadın';
  /* Whether the women-only flag is actually HONOURED is a different question
     («not a man» — see womenOnlyAllowed), and it is the one the count has to ask. */
  const canWomenOnly = womenOnlyAllowed(gender);
  const f = useDiscoverPrefs((s) => s.partnerFilter);
  const setFilter = useDiscoverPrefs((s) => s.setPartnerFilter);
  const reset = useDiscoverPrefs((s) => s.resetPartnerFilter);
  const partners = usePartnersForGym(homeGymId ?? '');

  const next = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const toggle = (key: 'levels' | 'goals' | 'types' | 'slots') => (v: string) => {
    const patch: Partial<typeof f> = {};
    patch[key] = next(f[key], v);
    setFilter(patch);
  };

  /* Real number — how many partners this filter actually leaves in the list.
     The third argument was missing, so `viewerIsWoman` defaulted to false and the
     women-only branch never ran HERE while it ran everywhere the list is drawn:
     the footer promised «9 yoldaş göstər» and opened a list with one woman in it,
     on the one filter the sheet calls «Təhlükəsizlik üçün». */
  const matched = useMemo(() => applyPartnerFilter(partners, f, canWomenOnly), [partners, f, canWomenOnly]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <PressableScale haptic={false} activeScale={0.94} onPress={reset}>
          <AppText variant="body" color={palette.blue}>Sıfırla</AppText>
        </PressableScale>
        <AppText variant="headline">Yoldaş filtri</AppText>
        <PressableScale haptic={false} activeScale={0.94} onPress={() => router.back()}>
          <AppText variant="body" color={palette.blue}>Bağla</AppText>
        </PressableScale>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* «Yalnız qadınlar» is a safety choice a WOMAN makes for herself. Shown to
            everyone, it was a one-tap way for a man to filter the list down to
            women — under a label that says «Təhlükəsizlik üçün». That is the
            exact scenario the product's «dating deyil» position exists to
            prevent, so the switch only exists for women. Anyone whose gender is
            not set does not get it either: this must not be reachable by leaving
            a field blank. */}
        {isWoman ? (
          <View style={styles.safetyRow}>
            <View style={{ flex: 1 }}>
              <AppText variant="headline">Yalnız qadınlar</AppText>
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2, lineHeight: 18 }}>
                Təhlükəsizlik üçün — kartlarda və siyahıda yalnız qadın yoldaşlar görünəcək.
              </AppText>
            </View>
            <Switch
              value={f.womenOnly}
              onValueChange={(v) => setFilter({ womenOnly: v })}
              trackColor={{ true: palette.voltDeep, false: palette.separator }}
            />
          </View>
        ) : null}

        <Section title="Səviyyə">
          {LEVELS.map((l) => (
            <Chip key={l} label={l} tone="card" selected={f.levels.includes(l)} onPress={() => toggle('levels')(l)} />
          ))}
        </Section>
        <Section title="Məqsəd">
          {GOALS.map((g) => (
            <Chip key={g} label={g} tone="card" selected={f.goals.includes(g)} onPress={() => toggle('goals')(g)} />
          ))}
        </Section>
        <Section title="Məşq tipi">
          {WORKOUT_TYPES.slice(0, 6).map((t) => (
            <Chip key={t} label={t} tone="card" selected={f.types.includes(t)} onPress={() => toggle('types')(t)} />
          ))}
        </Section>
        <Section title="Vaxt">
          {TIME_SLOTS.map((t) => (
            <Chip key={t} label={t} tone="card" selected={f.slots.includes(t)} onPress={() => toggle('slots')(t)} />
          ))}
        </Section>
        <Section title="Yaş (məcburi deyil)">
          {AGE_BUCKETS.map((a, i) => (
            <Chip
              key={a.label}
              label={a.label}
              tone="card"
              selected={f.ageBucket === i}
              onPress={() => setFilter({ ageBucket: f.ageBucket === i ? null : i })}
            />
          ))}
        </Section>

        <AppText variant="footnote" color={palette.caption} style={{ lineHeight: 18 }}>
          {homeGymId
            ? 'Filtr yoldaş siyahısına, kartlara və həftəlik təkliflərə dərhal tətbiq olunur.'
            : 'Əsas zalın seçilməyib — yoldaşlar zala görə tapılır, ona görə hələ say göstərə bilmirik.'}
        </AppText>
      </ScrollView>

      <View style={styles.footer}>
        {!homeGymId ? (
          <Button title="Zalını seç" full onPress={() => router.push('/(tabs)/profile/edit')} />
        ) : (
          <Button
            title={matched.length === 0 ? 'Uyğun yoldaş yoxdur' : `${matched.length} yoldaş göstər`}
            full
            disabled={matched.length === 0}
            onPress={() => router.back()}
          />
        )}
      </View>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <AppText variant="overline" color={palette.caption} style={{ marginBottom: 12 }}>
        {title}
      </AppText>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: palette.separator, marginTop: 8, marginBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingVertical: 8 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 24 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  safetyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 16, marginBottom: 20 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
