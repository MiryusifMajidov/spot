/**
 * A real, live map — MapLibre GL JS drawing OpenFreeMap vector tiles, inside a
 * WebView, painted in SPOT's own colours.
 *
 * Why this stack:
 *   - No key. `react-native-maps` on Android needs a Google Maps API key tied to
 *     the owner's Google Cloud account and renders a blank grey square without
 *     one. OpenFreeMap (tiles.openfreemap.org) is free, keyless and allows
 *     commercial use; MapLibre GL JS 5.24 (the last UMD build — 6.x is ESM-only)
 *     comes from unpkg with jsDelivr as the fallback.
 *   - Vector, not raster. The style is fetched and re-painted in the page before
 *     the map is created (spotMapHtml.ts): theme greys, soft water, white roads,
 *     no shields or relief, labels in the app's language (name:az / name:ru /
 *     name:en). The old raw OSM raster tiles were busy, dated, and their usage
 *     policy forbids app-scale traffic to tile.openstreetmap.org.
 *   - The flag. Leaflet 1.9 prefixes its attribution with a Ukrainian-flag SVG —
 *     that was the flag the owner saw. MapLibre has no such prefix, and the
 *     credit is MapLibre's compact control: «OpenFreeMap © OpenMapTiles Data
 *     from OpenStreetMap», shown at load and folded into an ⓘ after the first
 *     drag or five seconds (the licences require the credit; nothing else).
 *
 * The page is built ONCE per mount (and retry). Markers, the selection, the
 * user's position, the label language and the bottom inset are pushed in as
 * messages afterwards, so a refreshed list never resets the user's pan/zoom.
 *
 * Modes:
 *   markers — gyms as ink discs (volt when `active` or selected); a tap calls
 *             `onMarkerPress`; a tap on empty map calls `onMapPress`
 *   picker  — `pickable`: a tap drops a draggable volt pin, `onPick` reports it
 *
 * Location: `userLocation` (the screen's own live fix) or `trackUser` (the map
 * watches by itself, only if permission was ALREADY granted, only while the
 * screen is focused) draws the blue dot. `locateButton` adds a native «where am
 * I» button that asks for permission when it is needed. The coordinate stays on
 * the device — it only ever goes into this WebView.
 */
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { useLang, useT } from '@/lib/useT';
import { toast } from '@/store/ui';
import { palette, radius, shadow } from '@/theme';

import {
  buildSpotMapHtml,
  spotMapInjection,
  type SpotMapInbound,
  type SpotMapOutbound,
  type SpotMapPalette,
  type SpotMapUserLocation,
} from './spotMapHtml';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  active?: boolean;
}

/** A position fix; `accuracy` is the radius in metres, when the OS reports one. */
export type UserLocation = SpotMapUserLocation;

type Status = 'loading' | 'ready' | 'failed';

interface Props {
  markers?: MapMarker[];
  /** where the map opens; without it the map opens on the user (see
   *  `centerOnFirstFix`), else fits the markers, else Baku */
  center?: { lat: number; lng: number };
  zoom?: number;
  /** show a draggable/tappable pin and report where it lands */
  pickable?: boolean;
  /** the pin at mount (remount the map to move it from outside) */
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
  onMarkerPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
  /** Told whether the map actually came up, so a screen can offer a way around it. */
  onStatus?: (s: Status) => void;

  /** The selected gym, owned by the screen (e.g. the one its card shows). Leave
   *  undefined to let the map keep its own selection. */
  selectedId?: string | null;
  /** a tap on the map that hit no marker (not called in picker mode) */
  onMapPress?: () => void;
  /** the user's live position, supplied by the screen; null = not known */
  userLocation?: UserLocation | null;
  /** without `userLocation`: watch the position here — never prompts, only
   *  when permission is already granted, only while the screen is focused */
  trackUser?: boolean;
  /** when the map has no `center`, fly to the user on the first fix (true =
   *  zoom 14, a number = that zoom) unless the user already moved the map */
  centerOnFirstFix?: boolean | number;
  /** the native «where am I» button, bottom-right */
  locateButton?: boolean;
  /** a read-only thumbnail (its caller blocks touches): a short credit that
   *  never folds, since the foldable ⓘ could not be pressed there */
  preview?: boolean;
  /** the locate button found the user (permission granted, position known) */
  onLocate?: (p: UserLocation) => void;
  /** points of the map's bottom edge the screen covers with its own overlays;
   *  the button, the credit and camera moves stay above it */
  bottomInset?: number;
}

const BAKU = { lat: 40.4093, lng: 49.8671 };

/* The inline page is given the app's own site as its base URL instead of the
   default opaque origin ("null" / about:blank). Under an opaque origin the
   WebView's HTTP cache is partitioned away — measured in Chromium: 0 cache hits
   on the second mount, so the ~1 MB MapLibre build, the style and the glyphs
   came over the network every time the map opened — and MapLibre's blob-URL
   worker has to start from about:blank, which WKWebView is the least happy
   with. Nothing is fetched from this address; it only names the page. It is also
   the Referer the tile server sees, which is the polite way to use OpenFreeMap. */
const MAP_BASE_URL = 'https://spot-d7566.web.app/';
const LOCATE_ZOOM = 15;
const FIRST_FIX_ZOOM = 14;
const LOAD_TIMEOUT_MS = 15_000;

/** Theme tokens handed to the page — the page never invents a colour of its own. */
const MAP_PALETTE: SpotMapPalette = {
  ink: palette.ink,
  volt: palette.volt,
  white: palette.white,
  grouped: palette.grouped,
  canvas: palette.canvas,
  textSecondary: palette.textSecondary,
  caption: palette.caption,
  tertiary: palette.tertiary,
  text3: palette.text3,
  text4: palette.text4,
  blue: palette.blue,
};

const toUser = (pos: Location.LocationObject): UserLocation => ({
  lat: pos.coords.latitude,
  lng: pos.coords.longitude,
  accuracy: pos.coords.accuracy ?? null,
});

const userKeyOf = (u: UserLocation | null | undefined) => (u ? `${u.lat},${u.lng},${u.accuracy ?? ''}` : '');

function userFromKey(key: string): UserLocation | null {
  if (!key) return null;
  const [lat, lng, acc] = key.split(',');
  return { lat: Number(lat), lng: Number(lng), accuracy: acc ? Number(acc) : null };
}

/* The two location routines live outside the component on purpose: the React
   Compiler skips a whole component that has a try/finally, or a `??` / `&&` /
   `?.` inside a try — and a skipped SpotMap would re-render its WebView props
   uncached on every parent render. */

/** Watches the position (Balanced, every ~10 m) — but only when permission is
 *  already there; resolves to null instead of ever prompting. */
async function watchIfAllowed(
  checkPermission: boolean,
  onFix: (u: UserLocation) => void
): Promise<Location.LocationSubscription | null> {
  try {
    if (checkPermission) {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') return null;
    }
    return await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 10 }, (pos) =>
      onFix(toUser(pos))
    );
  } catch {
    return null; // no fix is not worth a word: the dot simply does not appear
  }
}

type FindMe = { granted: boolean; here: UserLocation | null; problem: 'denied' | 'off' | 'error' | null };

/** The locate button's errand: permission (asking only if the OS still lets
 *  us), then the freshest position we can get quickly. */
async function findMe(known: UserLocation | null): Promise<FindMe> {
  let granted = false;
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted' && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { granted, here: null, problem: 'denied' };
    granted = true;
    if (known) return { granted, here: known, problem: null };
    if (!(await Location.hasServicesEnabledAsync())) return { granted, here: null, problem: 'off' };
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 200 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { granted, here: toUser(pos), problem: null };
  } catch {
    return { granted, here: null, problem: 'error' };
  }
}

function parseOutbound(raw: string): SpotMapOutbound | null {
  try {
    const d = JSON.parse(raw) as SpotMapOutbound;
    return d && typeof d === 'object' && typeof d.t === 'string' ? d : null;
  } catch {
    return null;
  }
}

export function SpotMap({
  markers = [],
  center,
  zoom = 12,
  pickable = false,
  picked,
  onPick,
  onMarkerPress,
  style,
  onStatus,
  selectedId,
  onMapPress,
  userLocation,
  trackUser = false,
  centerOnFirstFix = false,
  locateButton = false,
  preview = false,
  onLocate,
  bottomInset = 0,
}: Props) {
  const t = useT();
  const lang = useLang();
  const webRef = useRef<WebView>(null);

  /* Position: the screen's (`userLocation`) wins; else our own watch. */
  const external = userLocation !== undefined;
  const [tracked, setTracked] = useState<UserLocation | null>(null);
  const user = external ? userLocation : tracked;
  /* set once the locate button got permission, so the watch below starts now
     instead of on the next focus */
  const [granted, setGranted] = useState(false);

  const buildPage = () => {
    const open = center ?? picked ?? markers[0] ?? BAKU;
    return buildSpotMapHtml({
      palette: MAP_PALETTE,
      lang,
      center: { lat: open.lat, lng: open.lng },
      hasCenter: !!(center ?? picked),
      zoom,
      pickable,
      picked: picked ?? null,
      markers,
      selectedId: selectedId ?? null,
      selectionControlled: selectedId !== undefined,
      userLocation: user ?? null,
      firstFixZoom: centerOnFirstFix === true ? FIRST_FIX_ZOOM : typeof centerOnFirstFix === 'number' ? centerOnFirstFix : 0,
      bottomInset,
      // the canvas is the costliest thing on screen; Android WebViews get 2x
      maxPixelRatio: Platform.OS === 'android' ? 2 : 3,
      // the expanded credit wraps short of the locate button instead of under it
      locateButton,
      preview,
    });
  };

  /* Built once per mount — and again only for a retry or a change of mode.
     Everything else reaches the page as a message. */
  const [page, setPage] = useState(() => ({ attempt: 0, pickable, html: buildPage() }));
  /* Map tiles and the library come over the network. When they don't arrive
     the honest thing is to say so and offer a retry — not to leave a grey box
     that looks like a map with nothing in it. */
  const [status, setStatus] = useState<Status>('loading');
  const [following, setFollowing] = useState(false);
  const [locating, setLocating] = useState(false);

  if (page.pickable !== pickable) {
    setPage({ attempt: page.attempt + 1, pickable, html: buildPage() });
    setStatus('loading');
  }

  const retry = () => {
    setPage((p) => ({ attempt: p.attempt + 1, pickable, html: buildPage() }));
    setStatus('loading');
    setFollowing(false);
  };

  /* The callback lives in a ref so that a parent passing a fresh arrow on every
     render cannot make the announcement below re-fire and report the same status
     twice. The ref is refreshed after the commit rather than during render: a
     render can be started and thrown away, and must leave nothing behind. */
  const report = useRef(onStatus);
  useEffect(() => {
    report.current = onStatus;
  });
  useEffect(() => {
    report.current?.(status);
  }, [status]);

  useEffect(() => {
    if (status !== 'loading') return;
    const id = setTimeout(() => setStatus((s) => (s === 'loading' ? 'failed' : s)), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [status, page.attempt]);

  /* ---- the message channel ------------------------------------------- */

  const readyRef = useRef(false);
  const queue = useRef<SpotMapInbound[]>([]);
  // a new page is not ready until it says so; nothing queued for the old one survives
  useEffect(() => {
    readyRef.current = false;
    queue.current = [];
  }, [page.attempt]);

  const send = useCallback((msg: SpotMapInbound) => {
    const web = webRef.current;
    if (!readyRef.current || !web) {
      queue.current.push(msg);
      return;
    }
    web.injectJavaScript(spotMapInjection(msg));
  }, []);

  const onMessage = (e: WebViewMessageEvent) => {
    const d = parseOutbound(e.nativeEvent.data);
    if (!d) return;
    switch (d.t) {
      case 'ready': {
        readyRef.current = true;
        const pending = queue.current;
        queue.current = [];
        pending.forEach(send);
        setStatus('ready');
        break;
      }
      case 'fail':
        readyRef.current = false;
        setStatus('failed');
        break;
      case 'pick':
        if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) onPick?.({ lat: d.lat, lng: d.lng });
        break;
      case 'marker':
        if (typeof d.id === 'string') onMarkerPress?.(d.id);
        break;
      case 'mapTap':
        onMapPress?.();
        break;
      case 'follow':
        setFollowing(!!d.on);
        break;
      case 'link':
        // the attribution's own links (OpenFreeMap, OpenMapTiles, OSM copyright)
        if (typeof d.url === 'string' && /^https:\/\//.test(d.url)) void Linking.openURL(d.url);
        break;
      case 'log':
        if (__DEV__) console.log('[SpotMap]', d.msg);
        break;
    }
  };

  const died = () => {
    readyRef.current = false;
    setStatus('failed');
  };

  /* The OS killed the page's process: iOS does it to a WebGL page left in the
     background, Android reclaims the renderer. A map that was working simply
     comes back on a fresh WebView («check your internet» would be a lie, and a
     dead Android WebView must not stay mounted). One that dies before it ever
     came up gets the honest failure — no retry loop. */
  const gone = () => {
    if (status === 'ready') retry();
    else died();
  };

  /* Nothing may navigate the map's page away; a link goes to the browser. */
  const shouldStart = (req: WebViewNavigation & { isTopFrame?: boolean }) => {
    // The page's own load: iOS reports loadHTMLString under its base URL.
    if (req.url === MAP_BASE_URL || req.url.startsWith(MAP_BASE_URL + '#') || req.url === 'about:blank') return true;
    if (/^https?:/i.test(req.url) && req.isTopFrame !== false) {
      if (/^https:\/\//i.test(req.url)) void Linking.openURL(req.url);
      return false;
    }
    return true;
  };

  /* ---- state the page mirrors, pushed whenever it changes ------------- */

  const ready = status === 'ready';
  /* Keyed by contents, not array identity: a caller that rebuilds the array on
     every render must not flood the page with identical updates. */
  const markersKey = JSON.stringify(markers);
  useEffect(() => {
    if (ready) send({ t: 'markers', markers: JSON.parse(markersKey) as MapMarker[] });
  }, [ready, markersKey, send]);

  useEffect(() => {
    if (ready && selectedId !== undefined) send({ t: 'select', id: selectedId });
  }, [ready, selectedId, send]);

  useEffect(() => {
    if (ready) send({ t: 'lang', lang });
  }, [ready, lang, send]);

  useEffect(() => {
    if (ready) send({ t: 'inset', bottom: bottomInset });
  }, [ready, bottomInset, send]);

  const userKey = userKeyOf(user);
  useEffect(() => {
    if (ready) send({ t: 'user', loc: userFromKey(userKey) });
  }, [ready, userKey, send]);

  /* A read-only map told to look somewhere else follows (the gym panel's map
     after its point was moved and re-read: the marker moves by message, and
     without this the camera stayed on the old spot with the pin off-screen).
     A picker's `center` is its own pin, so a tap must not drag the camera. */
  const centerKey = !pickable && center ? `${center.lat},${center.lng}` : '';
  const centerShown = useRef(centerKey);
  useEffect(() => {
    if (!ready || centerKey === centerShown.current) return;
    centerShown.current = centerKey;
    if (!centerKey) return;
    const [lat, lng] = centerKey.split(',').map(Number);
    send({ t: 'center', lat, lng });
  }, [ready, centerKey, send]);

  /* ---- our own position watch (pickers) ------------------------------ */

  useFocusEffect(
    useCallback(() => {
      if (!trackUser || external) return undefined;
      let alive = true;
      let sub: Location.LocationSubscription | null = null;
      // only look — a map must never pop a permission prompt on its own
      void watchIfAllowed(!granted, setTracked).then((s) => {
        if (!s) return;
        if (alive) sub = s;
        else s.remove();
      });
      return () => {
        alive = false;
        if (sub) sub.remove();
      };
    }, [trackUser, external, granted])
  );

  /* ---- «where am I» --------------------------------------------------- */

  const locateMe = async () => {
    if (locating) return;
    setLocating(true);
    const known = user ?? null;
    const r = await findMe(known);
    setLocating(false);
    if (r.granted) setGranted(true);
    if (r.problem === 'denied') toast(t('Məkan icazəsi yoxdur — onu telefonun ayarlarında SPOT üçün aç.'), 'error');
    else if (r.problem === 'off') toast(t('Telefonda məkan xidməti söndürülüb — onu ayarlardan yandır.'), 'error');
    else if (r.problem === 'error') toast(t('Yerin alınmadı — bir az sonra yenidən yoxla.'), 'error');
    const here = r.here;
    if (!here) return;
    if (!external && here !== known) setTracked(here);
    send({ t: 'locate', lat: here.lat, lng: here.lng, accuracy: here.accuracy ?? null, zoom: LOCATE_ZOOM });
    onLocate?.(here);
  };

  // the button rides above whatever the screen lays over the map's bottom edge
  const lift = useSharedValue(bottomInset);
  useEffect(() => {
    lift.set(withTiming(bottomInset, { duration: 220 }));
  }, [bottomInset, lift]);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.get() }] }));

  const source = useMemo(() => ({ html: page.html, baseUrl: MAP_BASE_URL }), [page.html]);

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        key={page.attempt}
        ref={webRef}
        originWhitelist={['*']}
        source={source}
        onMessage={onMessage}
        onError={died}
        onHttpError={died}
        onContentProcessDidTerminate={gone}
        onRenderProcessGone={gone}
        onShouldStartLoadWithRequest={shouldStart}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        /* Android: the pickers sit in a form's ScrollView, which otherwise steals
           every vertical drag and pinch — the pin could only be dragged sideways */
        nestedScrollEnabled={pickable}
        bounces={false}
        overScrollMode="never"
        allowsLinkPreview={false}
        textInteractionEnabled={false}
        webviewDebuggingEnabled={__DEV__}
        style={styles.web}
        androidLayerType="hardware"
      />

      {locateButton && ready ? (
        <Animated.View style={[styles.locateSpot, liftStyle]}>
          <PressableScale
            activeScale={0.92}
            onPress={locateMe}
            accessibilityRole="button"
            accessibilityLabel={t('Mənim yerim')}
            accessibilityState={{ busy: locating, selected: following }}
            style={[styles.locate, shadow.card]}>
            {locating ? (
              <ActivityIndicator size="small" color={palette.blue} />
            ) : (
              <Icon name={following ? 'locateOn' : 'locate'} size={20} color={following ? palette.blue : palette.inkText} />
            )}
          </PressableScale>
        </Animated.View>
      ) : null}

      {status !== 'ready' ? (
        <Animated.View
          exiting={FadeOut.duration(220)}
          style={styles.cover}
          pointerEvents={status === 'failed' ? 'auto' : 'none'}>
          {status === 'loading' ? (
            <ActivityIndicator color={palette.tertiary} />
          ) : (
            <>
              <AppText variant="headline" center>
                {t('Xəritə yüklənmədi')}
              </AppText>
              <AppText variant="footnote" color={palette.textSecondary} center style={styles.failBody}>
                {t('İnternet bağlantını yoxla və yenidən cəhd et.')}
              </AppText>
              <PressableScale activeScale={0.95} onPress={retry} accessibilityRole="button" style={styles.retry}>
                <AppText variant="subhead" color={palette.white} style={styles.retryText}>
                  {t('Yenidən cəhd et')}
                </AppText>
              </PressableScale>
            </>
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: palette.grouped },
  web: { flex: 1, backgroundColor: 'transparent' },
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 20,
    backgroundColor: palette.grouped,
  },
  failBody: { maxWidth: 280 },
  // a real 44 pt box, not a hitSlop: the button sits in the map's corner
  retry: {
    marginTop: 10,
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    backgroundColor: palette.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontWeight: '600' },
  locateSpot: { position: 'absolute', right: 12, bottom: 12 },
  locate: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.cardBorder,
  },
});
