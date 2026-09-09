import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { GymCard } from '@/components/GymCard';
import { Icon } from '@/components/Icon';
import { SpotMap, type MapMarker } from '@/components/SpotMap';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { Gym } from '@/data/types';
import { getGymsNear } from '@/lib/api';
import { tapFeedback } from '@/lib/feedback';
import { useGyms } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { applyGymFilter, useDiscoverPrefs } from '@/store/discoverPrefs';
import { palette, radius, shadow, spacing } from '@/theme';

type Status = 'idle' | 'asking' | 'loading' | 'ok' | 'denied' | 'error';

/** A gym can only be plotted if someone actually recorded its coordinates. */
const hasCoords = (g: Gym): g is Gym & { lat: number; lng: number } =>
  typeof g.lat === 'number' && typeof g.lng === 'number' && Number.isFinite(g.lat) && Number.isFinite(g.lng);

/**
 * «Xəritə» — real gyms on a real map.
 *
 * The map is OpenStreetMap tiles (SpotMap), one pin per gym that has coordinates,
 * the user's own gym highlighted. Location permission only improves the screen — it
 * centres the map on the user and lets the `gyms_near` RPC return real distances;
 * without it the map still renders and stays usable.
 *
 * Nothing is invented: a gym whose location was never recorded is not given a
 * made-up pin — it is counted out loud in the footer and stays in the list tab.
 */
export default function GymMap() {
  const router = useRouter();
  const gymFilter = useDiscoverPrefs((s) => s.gymFilter);
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const fallback = useGyms();
  const [near, setNear] = useState<Gym[] | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [tab, setTab] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setStatus('asking');
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      setStatus('loading');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setMe(here);
      // Distances are a bonus — if the backend is absent or fails, the map still works.
      if (hasSupabaseConfig) {
        try {
          setNear(await getGymsNear(here.lat, here.lng));
        } catch {
          setNear(null);
        }
      }
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (status === 'idle') locate();
  }, [status, locate]);

  const list = useMemo(() => applyGymFilter(near ?? fallback, gymFilter), [near, fallback, gymFilter]);
  const plottable = useMemo(() => list.filter(hasCoords), [list]);
  const missing = list.length - plottable.length;

  const markers: MapMarker[] = useMemo(
    () =>
      plottable.map((g) => ({
        id: g.id,
        lat: g.lat,
        lng: g.lng,
        title: g.name,
        subtitle: [g.district, `${g.priceMonth} ₼/ay`].filter(Boolean).join(' · '),
        active: g.id === homeGymId,
      })),
    [plottable, homeGymId]
  );

  const selected = selectedId ? plottable.find((g) => g.id === selectedId) ?? null : null;

  const notice =
    status === 'asking' || status === 'loading'
      ? 'Məkan müəyyən olunur…'
      : status === 'denied'
        ? 'Məkan icazəsi verilmədi — xəritə ümumi görünüşdə açılıb, məsafələr hesablanmır.'
        : status === 'error'
          ? 'Məkan alınmadı — xəritə ümumi görünüşdə açılıb.'
          : near
            ? null
            : hasSupabaseConfig
              ? 'Xəritə sənin yerinə görə mərkəzləndi. Məsafələr alınmadı.'
              : 'Xəritə sənin yerinə görə mərkəzləndi. Məsafələr üçün internet lazımdır.';

  /* There is no «bu pin təxminidir» line any more, and there must not be a fake
     one. It was computed from `Gym.approxLocation`, which only the deleted seed
     objects ever carried: `mapGym()` — the one place a database row becomes a
     Gym — never sets it, so the disclosure could not appear for a single gym on
     this map and was silently dead. Every pin drawn here is a coordinate a gym
     owner actually recorded; if approximate locations are ever stored again, the
     precision has to come back from the server before the footer may claim it. */
  const footer =
    list.length === 0
      ? 'Filtrə uyğun zal yoxdur.'
      : plottable.length === 0
        ? `${list.length} zalın heç birinin yeri hələ qeyd olunmayıb — «Siyahı»ya bax.`
        : missing > 0
          ? `${missing} zalın yeri hələ qeyd olunmayıb — onlar «Siyahı»dadır.`
          : null;

  return (
    <Screen edges={['top']}>
      <NavBar title="Zallar xəritəsi" />
      <View style={styles.tabs}>
        <Segmented options={['Xəritə', 'Siyahı']} value={tab} onChange={setTab} />
      </View>

      {tab === 0 ? (
        <View style={styles.mapWrap}>
          {/* remount once the real position arrives so the map recentres on the user */}
          <SpotMap
            key={me ? `me:${me.lat.toFixed(3)},${me.lng.toFixed(3)}` : 'default'}
            markers={markers}
            center={me ?? undefined}
            zoom={me ? 13 : 12}
            onMarkerPress={(id) => {
              tapFeedback();
              setSelectedId(id);
            }}
            style={styles.map}
          />

          {notice ? (
            <View style={[styles.pill, styles.pillTop, shadow.card as object]}>
              <Icon name="pin" size={15} color={palette.textSecondary} />
              <AppText variant="footnote" color={palette.textSecondary} style={styles.pillText}>
                {notice}
              </AppText>
              {status === 'denied' || status === 'error' ? (
                <PressableScale activeScale={0.94} onPress={locate} hitSlop={10}>
                  <AppText style={styles.retry}>Yenidən</AppText>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          {selected ? (
            <View style={[styles.card, shadow.floating as object]}>
              <PressableScale
                haptic={false}
                activeScale={0.9}
                onPress={() => setSelectedId(null)}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Bağla">
                <Icon name="x" size={14} color={palette.textSecondary} />
              </PressableScale>

              <View style={styles.cardHead}>
                <View style={{ flex: 1, paddingRight: 28 }}>
                  <View style={styles.nameRow}>
                    <AppText variant="title3" numberOfLines={1}>
                      {selected.name}
                    </AppText>
                    {selected.verified ? <Icon name="verified" size={15} color={palette.blue} /> : null}
                  </View>
                  <AppText variant="footnote" color={palette.caption} style={{ marginTop: 4 }}>
                    {[
                      selected.district,
                      selected.distanceKm > 0 ? `${selected.distanceKm} km` : null,
                      selected.reviewCount > 0 ? `★ ${selected.rating}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText style={styles.price}>{selected.priceMonth} ₼</AppText>
                  <AppText variant="caption" color={palette.caption}>
                    aylıq
                  </AppText>
                </View>
              </View>

              {selected.liveCount > 0 ? (
                <View style={styles.live}>
                  <Icon name="users" size={13} color={palette.voltDeep} />
                  <AppText style={styles.liveText}>İndi zalda {selected.liveCount} nəfər</AppText>
                </View>
              ) : null}

              <Button
                title="Zala bax"
                full
                onPress={() => router.push({ pathname: '/(tabs)/discover/gym/[id]', params: { id: selected.id } })}
                style={{ height: 46, marginTop: 12 }}
              />
            </View>
          ) : footer ? (
            <View style={[styles.pill, styles.pillBottom, shadow.card as object]}>
              <Icon name="pin" size={15} color={palette.tertiary} />
              <AppText variant="footnote" color={palette.textSecondary} style={styles.pillText}>
                {footer}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {list.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="pin" size={26} color={palette.tertiary} />
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 260, lineHeight: 21 }}>
                Filtrə uyğun zal tapılmadı.
              </AppText>
            </View>
          ) : (
            list.map((g) => (
              <View key={g.id} style={{ marginBottom: 12 }}>
                <GymCard
                  gym={g}
                  variant="compact"
                  onPress={() => router.push({ pathname: '/(tabs)/discover/gym/[id]', params: { id: g.id } })}
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: spacing.screen, paddingBottom: 10 },
  mapWrap: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  pill: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pillTop: { top: 10 },
  pillBottom: { bottom: 12 },
  pillText: { flex: 1, lineHeight: 18 },
  retry: { fontSize: 13, fontWeight: '600', color: palette.blue },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: palette.white,
    borderRadius: radius.cardLg,
    padding: 15,
  },
  close: { position: 'absolute', top: 10, right: 10, width: 26, height: 26, borderRadius: 13, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontSize: 17, fontWeight: '700', color: palette.inkText },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(198,255,61,0.22)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 11, alignSelf: 'flex-start' },
  liveText: { fontSize: 12.5, fontWeight: '600', color: '#3F5500' },
  content: { paddingHorizontal: spacing.screen, paddingTop: 4, paddingBottom: 40 },
  empty: { alignItems: 'center', paddingVertical: 50 },
});
