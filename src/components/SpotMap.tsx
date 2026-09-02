/**
 * A real, live map — OpenStreetMap tiles rendered by Leaflet inside a WebView.
 *
 * Why not Google Maps: on Android `react-native-maps` needs a Google Maps API
 * key tied to the owner's Google Cloud account, and without one it renders a
 * blank grey square. OSM needs no key, so the map works for everyone today.
 *
 * Two modes:
 *   markers  — plot gyms; tapping one calls `onMarkerPress`
 *   picker   — `pickable`: tapping the map moves the pin and calls `onPick`
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  active?: boolean;
}

interface Props {
  markers?: MapMarker[];
  /** initial centre; defaults to Baku */
  center?: { lat: number; lng: number };
  zoom?: number;
  /** show a draggable/tappable pin and report where it lands */
  pickable?: boolean;
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
  onMarkerPress?: (id: string) => void;
  style?: object;
  /** Told whether the map actually came up, so a screen can offer a way around it. */
  onStatus?: (s: 'loading' | 'ready' | 'failed') => void;
}

const BAKU = { lat: 40.4093, lng: 49.8671 };

export function SpotMap({ markers = [], center, zoom = 12, pickable = false, picked, onPick, onMarkerPress, style, onStatus }: Props) {
  const ref = useRef<WebView>(null);
  const start = center ?? picked ?? markers[0] ?? BAKU;

  /* Leaflet and the OSM tiles both come over the network. When they don't arrive
     the honest thing is to say so and offer a retry — not to leave a grey box
     that looks like a map with nothing in it. `attempt` remounts the WebView. */
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  const report = useRef(onStatus);
  report.current = onStatus;
  useEffect(() => {
    report.current?.(status);
  }, [status]);

  useEffect(() => {
    if (status !== 'loading') return;
    const t = setTimeout(() => setStatus((s) => (s === 'loading' ? 'failed' : s)), 12_000);
    return () => clearTimeout(t);
  }, [status, attempt]);

  const retry = () => {
    setStatus('loading');
    setAttempt((a) => a + 1);
  };

  // Built once: re-rendering the HTML would reset the user's pan/zoom.
  const html = useMemo(
    () => `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<style>
  html,body,#map{height:100%;margin:0;background:#F4F4F6}
  .leaflet-container{font:500 12px -apple-system,system-ui,sans-serif}
  .pin{width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
       border:2.5px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.35);background:#101014}
  .pin.on{background:#C6FF3D}
  .pin i{display:block;width:9px;height:9px;border-radius:50%;background:#fff;
         transform:rotate(45deg);margin:8px auto}
  .pin.on i{background:#101014}
  .leaflet-popup-content{margin:9px 12px;font:600 13px -apple-system,system-ui,sans-serif;color:#101014}
  .leaflet-popup-content .sub{display:block;font-weight:500;color:#6E6E76;margin-top:3px}
  .leaflet-control-attribution{font-size:9px}
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
</head><body>
<div id="map"></div>
<script>
  var post = function (o) { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(o)); };
  if (typeof L === 'undefined') { post({ t: 'fail' }); throw new Error('leaflet-missing'); }
  var map = L.map('map', { zoomControl: false, attributionControl: true })
    .setView([${start.lat}, ${start.lng}], ${zoom});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  function icon(on) {
    return L.divIcon({ className: '', html: '<div class="pin' + (on ? ' on' : '') + '"><i></i></div>',
      iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30] });
  }

  var pickMarker = null;
  var pickable = ${pickable ? 'true' : 'false'};
  ${picked ? `pickMarker = L.marker([${picked.lat}, ${picked.lng}], { icon: icon(true), draggable: true }).addTo(map);` : ''}

  function placePin(lat, lng) {
    if (pickMarker) { pickMarker.setLatLng([lat, lng]); }
    else {
      pickMarker = L.marker([lat, lng], { icon: icon(true), draggable: true }).addTo(map);
      pickMarker.on('dragend', function (e) { var p = e.target.getLatLng(); post({ t: 'pick', lat: p.lat, lng: p.lng }); });
    }
    post({ t: 'pick', lat: lat, lng: lng });
  }
  if (pickMarker) pickMarker.on('dragend', function (e) { var p = e.target.getLatLng(); post({ t: 'pick', lat: p.lat, lng: p.lng }); });
  if (pickable) map.on('click', function (e) { placePin(e.latlng.lat, e.latlng.lng); });

  var data = ${JSON.stringify(markers)};
  var group = [];
  data.forEach(function (m) {
    var mk = L.marker([m.lat, m.lng], { icon: icon(!!m.active) }).addTo(map);
    mk.bindPopup('<b>' + m.title + '</b>' + (m.subtitle ? '<span class="sub">' + m.subtitle + '</span>' : ''));
    mk.on('click', function () { post({ t: 'marker', id: m.id }); });
    group.push(mk);
  });
  if (group.length > 1) { try { map.fitBounds(L.featureGroup(group).getBounds().pad(0.25)); } catch (e) {} }

  window.addEventListener('message', function (ev) {
    try {
      var d = JSON.parse(ev.data);
      if (d.t === 'center') map.setView([d.lat, d.lng], d.zoom || map.getZoom());
      if (d.t === 'place') placePin(d.lat, d.lng);
    } catch (e) {}
  });
  post({ t: 'ready' });
</script></body></html>`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(markers), pickable]
  );

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const d = JSON.parse(e.nativeEvent.data) as { t: string; id?: string; lat?: number; lng?: number };
      if (d.t === 'ready') setStatus('ready');
      if (d.t === 'fail') setStatus('failed');
      if (d.t === 'pick' && d.lat != null && d.lng != null) onPick?.({ lat: d.lat, lng: d.lng });
      if (d.t === 'marker' && d.id) onMarkerPress?.(d.id);
    } catch {
      /* ignore malformed messages */
    }
  };

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        key={attempt}
        ref={ref}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={onMessage}
        onError={() => setStatus('failed')}
        onHttpError={() => setStatus('failed')}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        style={styles.web}
        androidLayerType="hardware"
      />

      {status !== 'ready' ? (
        <View style={styles.cover} pointerEvents={status === 'failed' ? 'auto' : 'none'}>
          {status === 'loading' ? (
            <ActivityIndicator color="#6E6E76" />
          ) : (
            <>
              <Text style={styles.failTitle}>Xəritə yüklənmədi</Text>
              <Text style={styles.failBody}>İnternet bağlantını yoxla və yenidən cəhd et.</Text>
              <Pressable onPress={retry} style={styles.retry} hitSlop={8}>
                <Text style={styles.retryText}>Yenidən cəhd et</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: '#F4F4F6' },
  web: { flex: 1, backgroundColor: 'transparent' },
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 20, backgroundColor: '#F4F4F6' },
  failTitle: { fontSize: 14, fontWeight: '600', color: '#101014' },
  failBody: { fontSize: 12.5, color: '#6E6E76', textAlign: 'center', lineHeight: 18 },
  retry: { marginTop: 8, backgroundColor: '#101014', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  retryText: { fontSize: 13, fontWeight: '600', color: '#fff' },
});
