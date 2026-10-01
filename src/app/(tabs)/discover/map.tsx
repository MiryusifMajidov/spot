import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GymCard } from '@/components/GymCard';
import { Icon } from '@/components/Icon';
import { SpotMap, type MapMarker, type UserLocation } from '@/components/SpotMap';
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
import { useFormat, useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { applyGymFilter, useDiscoverPrefs } from '@/store/discoverPrefs';
import { palette, radius, shadow, spacing } from '@/theme';

type Status = 'asking' | 'loading' | 'ok' | 'denied' | 'error';

/** A gym can only be plotted if someone actually recorded its coordinates. */
const hasCoords = (g: Gym): g is Gym & { lat: number; lng: number } =>
  typeof g.lat === 'number' && typeof g.lng === 'number' && Number.isFinite(g.lat) && Number.isFinite(g.lng);

/* Outside the component: a `??` inside the try in `locate` would make the
   React Compiler skip the whole screen. */
const fixOf = (pos: Location.LocationObject): UserLocation => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: pos.coords.accuracy ?? null,
});

/**
 * «Xəritə» — real gyms on a real map.
 *
 * The map is SpotMap (MapLibre + OpenFreeMap vector tiles in SPOT's colours), one
 * marker per gym that has coordinates, the user's own gym in volt. Location
 * permission only improves the screen — it flies the map to the user, draws the
 * live blue dot and lets the `gyms_near` RPC return real distances; without it
 * the map still renders and stays usable. The position is watched only while
 * this screen is focused, and it never leaves the device except as the one
 * `gyms_near` query (which stores nothing).
 *
 * Nothing is invented: a gym whose location was never recorded is not given a
 * made-up pin — it is counted out loud in the footer and stays in the list tab.
 */
export default function GymMap() {
  const router = useRouter();
  const t = useT();
  const fmt = useFormat();
  /* This screen is pushed inside the Kəşf TAB, and the gym card, the footer pill
     and the end of the list all sit at its bottom. On Android the Material bar
     reserves its own space (the inset here is the navigation bar it already
     covers — adding it would count it twice). On iOS 26 the Liquid Glass bar
     FLOATS over the content: «Zala bax» sat behind the glass, and so would the
     map's locate button and its credit, which sit in the map's bottom corners.
     Inside a tab screen UIKit's safe area already includes that bar, so the map
     area stops at it and the list pads by it — by the inset, not a guessed bar
     height. */
  const insets = useSafeAreaInsets();
  const iosBottom = Platform.OS === 'ios' ? insets.bottom : 0;
  /* The marker list is memoized, and its text is translated: without the active
     language in the deps the pins would keep the language they were built in. */
  const gymFilter = useDiscoverPrefs((s) => s.gymFilter);
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const fallback = useGyms();
  const [near, setNear] = useState<Gym[] | null>(null);
  const [me, setMe] = useState<UserLocation | null>(null);
  /* The live position for the blue dot — watched only while this screen is
     focused and only once permission is known to be granted. */
  const [live, setLive] = useState<UserLocation | null>(null);
  const [granted, setGranted] = useState(false);
  /* «asking» from the very first render, because the request below is started
     during mount and there is no moment at which we are not asking. The screen
     used to start at an 'idle' status that no notice described, so the first
     frame read «Xəritə sənin yerinə görə mərkəzləndi» — a claim about a position
     we had not obtained yet. */
  const [status, setStatus] = useState<Status>('asking');
  const [tab, setTab] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /* Heights of what lies over the map's bottom edge (the gym card, the footer
     pill), so the locate button, the credit and the camera stay above it. */
  const [cardH, setCardH] = useState(0);
  const [pillH, setPillH] = useState(0);

  const locate = useCallback(async () => {
    setStatus('asking');
    try {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      setGranted(true);
      setStatus('loading');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = fixOf(pos);
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

  // `locate` is stable, so this asks exactly once, when the screen mounts.
  useEffect(() => {
    void (async () => {
      await locate();
    })();
  }, [locate]);

  /* Balanced accuracy, a new fix every ~10 m: enough for a dot on a city map,
     and the watch stops the moment another screen covers this one — or the
     «Siyahı» tab replaces the map (the dot is the only thing it feeds). */
  const mapShown = tab === 0;
  useFocusEffect(
    useCallback(() => {
      if (!granted || !mapShown) return undefined;
      let alive = true;
      let sub: Location.LocationSubscription | null = null;
      Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10 }, (pos) =>
        setLive(fixOf(pos))
      )
        .then((s) => {
          if (alive) sub = s;
          else s.remove();
        })
        .catch(() => {
          /* the one-off fix above still centres the map; the dot just stops moving */
        });
      return () => {
        alive = false;
        sub?.remove();
      };
    }, [granted, mapShown])
  );

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
        subtitle: [g.district, t('{price} ₼/ay', { price: g.priceMonth })].filter(Boolean).join(' · '),
        active: g.id === homeGymId,
      })),
    [plottable, homeGymId, t]
  );

  const selected = selectedId ? plottable.find((g) => g.id === selectedId) ?? null : null;

  const notice =
    status === 'asking' || status === 'loading'
      ? t('Məkan müəyyən olunur…')
      : status === 'denied'
        ? t('Məkan icazəsi verilmədi — xəritə ümumi görünüşdə açılıb, məsafələr hesablanmır.')
        : status === 'error'
          ? t('Məkan alınmadı — xəritə ümumi görünüşdə açılıb.')
          : near
            ? null
            : hasSupabaseConfig
              ? t('Xəritə sənin yerinə görə mərkəzləndi. Məsafələr alınmadı.')
              : t('Xəritə sənin yerinə görə mərkəzləndi. Məsafələr üçün internet lazımdır.');

  /* There is no «bu pin təxminidir» line any more, and there must not be a fake
     one. It was computed from `Gym.approxLocation`, which only the deleted seed
     objects ever carried: `mapGym()` — the one place a database row becomes a
     Gym — never sets it, so the disclosure could not appear for a single gym on
     this map and was silently dead. Every pin drawn here is a coordinate a gym
     owner actually recorded; if approximate locations are ever stored again, the
     precision has to come back from the server before the footer may claim it. */
  const footer =
    list.length === 0
      ? t('Filtrə uyğun zal yoxdur.')
      : plottable.length === 0
        ? t('{n} zalın heç birinin yeri hələ qeyd olunmayıb — «Siyahı»ya bax.', { n: list.length, count: list.length })
        : missing > 0
          ? t('{n} zalın yeri hələ qeyd olunmayıb — onlar «Siyahı»dadır.', { n: missing, count: missing })
          : null;

  // the card sits 12 pt above the map's bottom edge, the pill too
  const bottomInset = selected ? cardH + 12 : footer ? pillH + 12 : 0;

  return (
    <Screen edges={['top']}>
      <NavBar title={t('Zallar xəritəsi')} />
      <View style={styles.tabs}>
        <Segmented options={[t('Xəritə'), t('Siyahı')]} value={tab} onChange={setTab} />
      </View>

      {tab === 0 ? (
        <View style={[styles.mapWrap, { marginBottom: iosBottom }]}>
          {/* Never remounted: new markers, the selection and the position are
              pushed into the live map, so a refreshed list keeps the user's
              pan/zoom. The first fix flies the map to the user (zoom 13) unless
              they have already moved it themselves. */}
          <SpotMap
            markers={markers}
            zoom={12}
            selectedId={selected ? selected.id : null}
            onMarkerPress={(id) => {
              tapFeedback();
              setSelectedId(id);
            }}
            onMapPress={() => setSelectedId(null)}
            userLocation={live ?? me}
            centerOnFirstFix={13}
            locateButton
            onLocate={() => {
              // permission was just granted from the map's own button: fetch
              // the distances and start the live dot, as a normal start would
              if (status === 'denied' || status === 'error') void locate();
            }}
            bottomInset={bottomInset}
            style={styles.map}
          />

          {notice ? (
            <View style={[styles.pill, styles.pillTop, shadow.card as object]}>
              <Icon name="pin" size={15} color={palette.textSecondary} />
              <AppText variant="footnote" color={palette.textSecondary} style={styles.pillText}>
                {notice}
              </AppText>
              {status === 'denied' || status === 'error' ? (
                // 17 pt line (AppText: 13 × 1.3) + 14 + 14 = a 45 pt tall target
                <PressableScale activeScale={0.94} onPress={locate} hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}>
                  <AppText style={styles.retry}>{t('Yenidən')}</AppText>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          {selected ? (
            <View
              style={[styles.card, shadow.floating as object]}
              onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height))}>
              <View style={styles.cardHead}>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    {/* shrinks, so a long name ends in «…» instead of pushing the tick out */}
                    <AppText variant="title3" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {selected.name}
                    </AppText>
                    {selected.verified ? <Icon name="verified" size={15} color={palette.voltDeep} /> : null}
                  </View>
                  <AppText variant="footnote" color={palette.caption} style={{ marginTop: 4 }}>
                    {[
                      selected.district,
                      // decimal comma in az/ru: the API rounds to 0.1, raw it read «1.3 km»
                      selected.distanceKm > 0 ? t('{km} km', { km: fmt.decimal(selected.distanceKm, 1) }) : null,
                      selected.reviewCount > 0 ? `★ ${fmt.decimal(selected.rating, 1)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText style={styles.price}>{selected.priceMonth} ₼</AppText>
                  <AppText variant="caption" color={palette.caption}>
                    {t('aylıq')}
                  </AppText>
                </View>
                {/* In the row, not floated over the corner: absolutely placed it sat
                    on top of the price. A 30 pt circle inside a 44 pt target — see
                    styles.closeHit for why the ring is padding and not hitSlop. */}
                <PressableScale
                  haptic={false}
                  activeScale={0.9}
                  onPress={() => setSelectedId(null)}
                  style={styles.closeHit}
                  accessibilityRole="button"
                  accessibilityLabel={t('Bağla')}>
                  <View style={styles.close}>
                    <Icon name="x" size={16} color={palette.textSecondary} />
                  </View>
                </PressableScale>
              </View>

              {selected.liveCount > 0 ? (
                <View style={styles.live}>
                  <Icon name="users" size={13} color={palette.voltDeep} />
                  <AppText style={styles.liveText}>{t('İndi zalda {n} nəfər', { n: selected.liveCount, count: selected.liveCount })}</AppText>
                </View>
              ) : null}

              <Button
                title={t('Zala bax')}
                full
                onPress={() => router.push({ pathname: '/(tabs)/discover/gym/[id]', params: { id: selected.id } })}
                style={{ height: 46, marginTop: 12 }}
              />
            </View>
          ) : footer ? (
            <View
              style={[styles.pill, styles.pillBottom, shadow.card as object]}
              onLayout={(e) => setPillH(Math.round(e.nativeEvent.layout.height))}>
              <Icon name="pin" size={15} color={palette.tertiary} />
              <AppText variant="footnote" color={palette.textSecondary} style={styles.pillText}>
                {footer}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: 40 + iosBottom }]}>
          {list.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="pin" size={26} color={palette.tertiary} />
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 260, lineHeight: 21 }}>
                {t('Filtrə uyğun zal tapılmadı.')}
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
  /* Full width: the map's locate button and its credit are lifted above the
     pill through SpotMap's bottomInset instead of sharing the row with it. */
  pillBottom: { bottom: 12 },
  pillText: { flex: 1, lineHeight: 18 },
  retry: { fontSize: 13, fontWeight: '600', color: palette.inkText },
  card: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: palette.white,
    borderRadius: radius.cardLg,
    padding: 15,
  },
  /* The 7 pt ring around the circle is PADDING, not hitSlop. The button sits in
     cardHead's top-right corner, and with the New Architecture a hitSlop that
     pokes outside the parent row is never hit-tested (a parent whose children do
     not overflow it acts as if it clipped), so a hitSlop of 7 only added 7 pt on
     the left and bottom — a 37 pt target. The negative margins cancel the padding
     in layout, so the circle sits exactly where a plain 30 pt circle would, 12 pt
     after the price (row gap 8 + 4). */
  closeHit: { padding: 7, margin: -7, marginLeft: -3 },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontSize: 17, fontWeight: '700', color: palette.inkText },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(198,255,61,0.22)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 11, alignSelf: 'flex-start' },
  liveText: { fontSize: 12.5, fontWeight: '600', color: palette.voltText },
  // paddingBottom is set inline: 40 plus the floating tab bar on iOS.
  content: { paddingHorizontal: spacing.screen, paddingTop: 4 },
  empty: { alignItems: 'center', paddingVertical: 50 },
});
