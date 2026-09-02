import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useGyms } from '@/lib/hooks';
import { applyGymFilter, useDiscoverPrefs } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';

const DISTANCE: { label: string; km: number }[] = [
  { label: '1 km', km: 1 },
  { label: '2 km', km: 2 },
  { label: '5 km', km: 5 },
  { label: '10 km', km: 10 },
];
const PRICE: { label: string; max: number }[] = [
  { label: '30 ₼', max: 30 },
  { label: '50 ₼', max: 50 },
  { label: '70 ₼', max: 70 },
  { label: '100 ₼', max: 100 },
];
const HOURS: { label: string; value: 'open' | '24h' }[] = [
  { label: 'İndi açıq', value: 'open' },
  { label: '24 saat', value: '24h' },
];
const AMENITIES = ['Duş', 'Park', 'Sauna', 'Basseyn', 'Kardio zonası', 'Qrup dərsləri', 'Wi-Fi'];

export default function Filter() {
  const router = useRouter();
  const gyms = useGyms();
  const f = useDiscoverPrefs((s) => s.gymFilter);
  const setFilter = useDiscoverPrefs((s) => s.setGymFilter);
  const reset = useDiscoverPrefs((s) => s.resetGymFilter);

  const toggleAmenity = (a: string) =>
    setFilter({ amenities: f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a] });

  // Real number — the length of the list this filter actually produces.
  const matched = useMemo(() => applyGymFilter(gyms, f), [gyms, f]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <PressableScale haptic={false} activeScale={0.94} onPress={reset}>
          <AppText variant="body" color={palette.blue}>
            Sıfırla
          </AppText>
        </PressableScale>
        <AppText variant="headline">Filtr</AppText>
        <PressableScale haptic={false} activeScale={0.94} onPress={() => router.back()}>
          <AppText variant="body" color={palette.blue}>
            Bağla
          </AppText>
        </PressableScale>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Section title="Məsafə">
          {DISTANCE.map((d) => (
            <Chip
              key={d.label}
              label={d.label}
              tone="card"
              selected={f.maxDistanceKm === d.km}
              onPress={() => setFilter({ maxDistanceKm: f.maxDistanceKm === d.km ? null : d.km })}
            />
          ))}
        </Section>
        <Section title="Aylıq qiymət (dək)">
          {PRICE.map((p) => (
            <Chip
              key={p.label}
              label={p.label}
              tone="card"
              selected={f.maxPrice === p.max}
              onPress={() => setFilter({ maxPrice: f.maxPrice === p.max ? null : p.max })}
            />
          ))}
        </Section>
        <Section title="İş saatı">
          {HOURS.map((h) => (
            <Chip
              key={h.value}
              label={h.label}
              tone="card"
              selected={f.hours === h.value}
              onPress={() => setFilter({ hours: f.hours === h.value ? null : h.value })}
            />
          ))}
        </Section>
        <Section title="İmkanlar">
          {AMENITIES.map((a) => (
            <Chip key={a} label={a} tone="card" selected={f.amenities.includes(a)} onPress={() => toggleAmenity(a)} />
          ))}
        </Section>

        <AppText variant="footnote" color={palette.caption} style={{ lineHeight: 18 }}>
          Məsafə yalnız məsafəsi bilinən zallara tətbiq olunur. Filtr Kəşf siyahısına dərhal işləyir.
        </AppText>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={matched.length === 0 ? 'Uyğun zal yoxdur' : `${matched.length} zal göstər`}
          full
          disabled={matched.length === 0}
          onPress={() => router.back()}
        />
      </View>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
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
  footer: { paddingHorizontal: spacing.screen, paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
