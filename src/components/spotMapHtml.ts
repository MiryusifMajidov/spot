/**
 * The web page that SpotMap loads into its WebView — as a pure function, with
 * no React Native imports, so a plain node script can build the exact same
 * document and a real browser can show it (scratchpad dump_map_html.mjs).
 *
 * The page is built ONCE per mount. Everything that changes afterwards —
 * markers, the selected gym, the user's position, the label language, how much
 * of the map the screen covers at the bottom — is pushed in as messages
 * (`spotMapInjection`) and applied in place, so the user's pan and zoom survive.
 *
 * Messages, RN → page (`SpotMapInbound`), applied after the map's 'load'
 * (anything that arrives earlier waits in a queue):
 *   markers {markers}           replace the gym markers (diffed by id)
 *   select  {id|null}           highlight one gym in volt, or none
 *   user    {loc|null}          the blue dot + accuracy circle
 *   locate  {lat,lng,accuracy,zoom}  fly to the user and follow until they pan
 *   lang    {lang}              relabel the basemap in az / ru / en
 *   inset   {bottom}            px hidden by the screen's own overlays
 *   center  {lat,lng,zoom?}     move the camera
 *   place   {lat,lng}           drop the picker pin there (and report it)
 *
 * Messages, page → RN (`SpotMapOutbound`):
 *   ready | fail {why} | pick {lat,lng} | marker {id} | mapTap | follow {on} | link {url}
 */

export type SpotMapLang = 'az' | 'ru' | 'en';

export interface SpotMapPoint {
  lat: number;
  lng: number;
}

export interface SpotMapMarkerData extends SpotMapPoint {
  id: string;
  title: string;
  subtitle?: string;
  active?: boolean;
}

export interface SpotMapUserLocation extends SpotMapPoint {
  /** radius of the 68 % confidence circle, in metres */
  accuracy?: number | null;
}

/** The theme tokens the page is painted with — passed in, never re-typed here. */
export interface SpotMapPalette {
  ink: string;
  volt: string;
  white: string;
  grouped: string;
  canvas: string;
  textSecondary: string;
  caption: string;
  tertiary: string;
  text3: string;
  text4: string;
  blue: string;
}

export interface SpotMapHtmlOptions {
  palette: SpotMapPalette;
  lang: SpotMapLang;
  /** where the camera opens when `hasCenter` (otherwise: user / markers / Baku) */
  center: SpotMapPoint;
  /** the caller chose the opening view — markers and the first fix leave it alone */
  hasCenter: boolean;
  zoom: number;
  pickable: boolean;
  picked: SpotMapPoint | null;
  markers: SpotMapMarkerData[];
  selectedId: string | null;
  /** true when RN owns the selection: the page then never changes it by itself */
  selectionControlled: boolean;
  userLocation: SpotMapUserLocation | null;
  /** zoom to fly to on the first position fix; 0 = never move for a fix */
  firstFixZoom: number;
  bottomInset: number;
  /** cap on the canvas resolution (GPU budget in a WebView) */
  maxPixelRatio: number;
  /** RN draws its 44 pt «where am I» button in the bottom-right corner (12 pt
   *  in): the expanded credit must wrap short of it, not run underneath */
  locateButton?: boolean;
  /** a read-only thumbnail whose touches never reach the page (the gym page's
   *  «Yeri» card): the foldable ⓘ credit folds into a button nobody can press
   *  there, so a short static credit is drawn instead and never folds */
  preview?: boolean;
}

export type SpotMapInbound =
  | { t: 'markers'; markers: SpotMapMarkerData[] }
  | { t: 'select'; id: string | null }
  | { t: 'user'; loc: SpotMapUserLocation | null }
  | { t: 'locate'; lat: number; lng: number; accuracy: number | null; zoom: number }
  | { t: 'lang'; lang: SpotMapLang }
  | { t: 'inset'; bottom: number }
  | { t: 'center'; lat: number; lng: number; zoom?: number }
  | { t: 'place'; lat: number; lng: number };

export type SpotMapOutbound =
  | { t: 'ready' }
  | { t: 'fail'; why?: string }
  | { t: 'pick'; lat: number; lng: number }
  | { t: 'marker'; id: string }
  | { t: 'mapTap' }
  | { t: 'follow'; on: boolean }
  | { t: 'link'; url: string }
  | { t: 'log'; msg: string };

export const MAPLIBRE_VERSION = '5.24.0';
const JS_URLS = [
  `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
  `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
];
const CSS_URLS = [
  `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
  `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
];
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

/** Same strokes as Icon 'dumbbell', so the pin and the app's icon are one glyph. */
const DUMBBELL_PATH = 'M3 9.5v5M6 7v10M18 7v10M21 9.5v5M6 12h12';

const BS = String.fromCharCode(92); // a backslash, spelled so no editor can unescape it

/** JSON that is also safe inside an inline <script> (no «</script>», no U+2028). */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, BS + 'u003c')
    .split(String.fromCharCode(0x2028)).join(BS + 'u2028')
    .split(String.fromCharCode(0x2029)).join(BS + 'u2029');
}

/** The string to hand WebView.injectJavaScript for one message. */
export function spotMapInjection(msg: SpotMapInbound): string {
  return `window.__spotRecv&&window.__spotRecv(${scriptJson(msg)});true;`;
}

/* ---------------------------------------------------------------- colours */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` blended toward `b` by `t` (0 = a, 1 = b) — every basemap tint is derived from theme tokens. */
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function basemapColors(p: SpotMapPalette) {
  const green = mix(p.volt, p.blue, 0.35); // the volt accent pulled toward a natural green
  const coolGrey = mix(p.blue, p.textSecondary, 0.35); // system blue, desaturated
  return {
    bg: p.grouped,
    residential: mix(p.grouped, p.canvas, 0.45),
    building: p.canvas,
    buildingEdge: mix(p.canvas, p.tertiary, 0.25),
    park: mix(p.grouped, green, 0.2),
    water: mix(p.grouped, coolGrey, 0.28),
    waterText: mix(p.blue, p.text3, 0.55),
    roadCasing: mix(p.canvas, p.tertiary, 0.34),
    minorCasing: mix(p.canvas, p.tertiary, 0.22),
    minorLow: mix(p.canvas, p.tertiary, 0.08),
    path: mix(p.canvas, p.tertiary, 0.25),
    rail: mix(p.canvas, p.tertiary, 0.35),
    boundary: mix(p.grouped, p.tertiary, 0.6),
    white: p.white,
    ink: p.ink,
    volt: p.volt,
    blue: p.blue,
    text3: p.text3,
    text4: p.text4,
    textSecondary: p.textSecondary,
    caption: p.caption,
  };
}

/* ------------------------------------------------------------------- page */

export function buildSpotMapHtml(o: SpotMapHtmlOptions): string {
  const C = basemapColors(o.palette);
  const cfg = {
    js: JS_URLS,
    styleUrl: STYLE_URL,
    lang: o.lang,
    center: o.center,
    hasCenter: o.hasCenter,
    zoom: o.zoom,
    pickable: o.pickable,
    picked: o.picked,
    markers: o.markers,
    selectedId: o.selectedId,
    selectionControlled: o.selectionControlled,
    user: o.userLocation,
    firstFixZoom: o.firstFixZoom,
    inset: o.bottomInset,
    maxPixelRatio: o.maxPixelRatio,
    preview: !!o.preview,
    colors: C,
    dumbbell: DUMBBELL_PATH,
  };

  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
<!-- media=print until loaded: a plain stylesheet holds back the script below (library,
     style fetch, message receiver) until unpkg answers; the inline rules cover what
     markers and the credit need meanwhile -->
<link rel="stylesheet" href="${CSS_URLS[0]}" media="print" onload="this.media='all'" onerror="this.onerror=null;this.href='${CSS_URLS[1]}'"/>
<style>
  :root{--inset:${Math.max(0, Math.round(o.bottomInset))}px}
  html,body{height:100%;margin:0;padding:0;overflow:hidden;background:${C.bg};
    -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;
    font:500 11px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
  #map{position:absolute;top:0;right:0;bottom:0;left:0;background:${C.bg}}
  /* the few rules markers need, in case the stylesheet is still on its way */
  .maplibregl-map{overflow:hidden;position:relative}
  .maplibregl-canvas{position:absolute;left:0;top:0}
  .maplibregl-marker{position:absolute;top:0;left:0;will-change:transform}
  .maplibregl-ctrl-bottom-left{position:absolute;left:0;right:${o.locateButton ? 64 : 0}px;bottom:var(--inset);z-index:2;pointer-events:none;
    transition:bottom .22s ease}
  .maplibregl-ctrl-bottom-left .maplibregl-ctrl{pointer-events:auto;margin:0 0 12px 12px}
  .maplibregl-ctrl-attrib.maplibregl-compact{background:rgba(255,255,255,.88);color:${C.textSecondary};
    box-shadow:0 1px 4px rgba(16,16,20,.12);font-size:10px;line-height:16px}
  .maplibregl-ctrl-attrib a{color:${C.textSecondary};text-decoration:none}
  .maplibregl-ctrl-attrib-button{opacity:.75}
  /* the ⓘ is drawn 24 px but answers a 44 px touch */
  .maplibregl-ctrl-attrib-button:before{content:"";position:absolute;top:-10px;right:-10px;bottom:-10px;left:-10px}
  .spot-credit{position:absolute;left:8px;bottom:calc(var(--inset) + 8px);z-index:2;pointer-events:none;
    font-size:9px;line-height:14px;color:${C.textSecondary};background:rgba(255,255,255,.85);padding:0 5px;border-radius:4px}

  /* gym marker: 34 pt ink disc (30 + a 2 pt white ring) inside a 44 pt tap box */
  .gm{width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer}
  .gm i{box-sizing:content-box;width:30px;height:30px;border-radius:50%;border:2px solid ${C.white};
    background:${C.ink};color:${C.white};display:flex;align-items:center;justify-content:center;
    box-shadow:0 2px 7px rgba(16,16,20,.28),0 0 0 .5px rgba(16,16,20,.10);
    transition:transform .2s cubic-bezier(.3,1.4,.5,1),background-color .16s ease,color .16s ease}
  .gm svg{width:18px;height:18px;display:block}
  .gm.on i{background:${C.volt};color:${C.ink};transform:scale(1.1)}
  .gm.sel i{background:${C.volt};color:${C.ink};transform:scale(1.24);
    box-shadow:0 4px 12px rgba(16,16,20,.32),0 0 0 .5px rgba(16,16,20,.12)}
  .gm:active i{transform:scale(.94)}

  /* No «position» on marker roots: MapLibre makes them absolute, and a
     relative one falls back into the flow and shoves every later marker down. */

  /* picker pin: a volt drop with the dumbbell, tip on the coordinate */
  .pp{width:44px;height:52px;cursor:grab}
  .pp svg{position:absolute;left:4px;bottom:0;width:36px;height:46px;overflow:visible;
    filter:drop-shadow(0 3px 4px rgba(16,16,20,.30));transition:transform .18s ease}
  .pp s{position:absolute;left:50%;bottom:-3px;width:14px;height:6px;margin-left:-7px;border-radius:50%;
    background:rgba(16,16,20,.28);filter:blur(1.5px);transition:transform .18s ease,opacity .18s ease}
  .pp.lift svg{transform:translateY(-10px) scale(1.06)}
  .pp.lift s{transform:scale(.7);opacity:.5}
  .pp.drop svg{animation:drop .32s cubic-bezier(.3,1.5,.6,1)}
  @keyframes drop{0%{transform:translateY(-16px)}100%{transform:translateY(0)}}

  /* you are here: 16 pt blue dot, 3 pt white ring, soft pulse */
  .ud{width:22px;height:22px;pointer-events:none}
  .ud b{position:absolute;top:0;left:0;right:0;bottom:0;box-sizing:border-box;border-radius:50%;
    background:${C.blue};border:3px solid ${C.white};box-shadow:0 1px 5px rgba(16,16,20,.35)}
  .ud:before{content:"";position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;
    background:${C.blue};opacity:0;animation:pulse 2.4s ease-out infinite}
  @keyframes pulse{0%{transform:scale(1);opacity:.32}70%,100%{transform:scale(2.6);opacity:0}}
  @media (prefers-reduced-motion:reduce){.ud:before{animation:none}.gm i,.pp svg{transition:none}}
</style>
</head><body>
<div id="map"></div>
<script>
(function () {
  'use strict';
  var CFG = ${scriptJson(cfg)};
  var C = CFG.colors;

  function post(o) {
    try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) {}
  }
  var failed = false;
  function fail(why) { if (failed) return; failed = true; post({ t: 'fail', why: String(why || '') }); }

  /* Attribution links must open in the system browser, never inside this WebView. */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    post({ t: 'link', url: a.href });
  }, true);

  /* ---------------------------------------------------------------- boot */

  /* The style is requested at once, in parallel with the library. */
  var styleP = (window.fetch ? fetch(CFG.styleUrl, { credentials: 'omit' }) : Promise.reject(new Error('no fetch')))
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  styleP['catch'](function () {});

  function loadScript(i) {
    var s = document.createElement('script');
    s.src = CFG.js[i];
    s.async = true;
    s.onload = function () {
      if (window.maplibregl) boot();
      else if (i + 1 < CFG.js.length) loadScript(i + 1);
      else fail('script');
    };
    s.onerror = function () {
      if (s.parentNode) s.parentNode.removeChild(s);
      if (i + 1 < CFG.js.length) loadScript(i + 1); else fail('script');
    };
    document.head.appendChild(s);
  }

  function boot() {
    styleP.then(function (style) {
      try { create(tune(style)); } catch (e) { fail('map: ' + (e && e.message)); }
    }, function (e) { fail('style: ' + (e && e.message)); });
  }

  /* --------------------------------------------------------------- style */

  var DROP = {
    'highway-shield-non-us': 1, 'highway-shield-us-interstate': 1, 'road_shield_us': 1,
    'boundary_3': 1, 'boundary_disputed': 1
  };
  var LABELS = [];
  var lang = CFG.lang;

  function nameExpr(l) {
    var e = ['coalesce', ['get', 'name:' + l]];
    if (l === 'en') e.push(['get', 'name_en']);
    e.push(['get', 'name:latin'], ['get', 'name']);
    return e;
  }

  function roadPaint(l, p) {
    var id = l.id;
    if (/_casing$/.test(id)) { p['line-color'] = C.roadCasing; return; }
    if (/_inner$/.test(id)) { p['line-color'] = C.white; return; }
    if (/_subtle$/.test(id)) { p['line-color'] = C.roadCasing; return; }
    if (/dashline$/.test(id)) { p['line-color'] = C.bg; return; }
    if (/^railway/.test(id)) { p['line-color'] = C.rail; return; }
    if (/^aeroway-(runway|taxiway)$/.test(id)) { p['line-color'] = C.white; return; }
    if (/^aeroway-runway-casing$/.test(id)) { p['line-color'] = C.minorCasing; return; }
  }

  function labelPaint(l, p, y) {
    var id = l.id;
    var color = C.textSecondary;
    if (id === 'label_city' || id === 'label_city_capital') color = C.text3;
    else if (id === 'label_town' || id === 'label_village') color = C.text4;
    else if (/^label_country/.test(id)) color = C.text4;
    else if (/^water/.test(id)) color = C.waterText;
    else if (id === 'highway-name-minor' || id === 'highway-name-path') color = C.caption;
    p['text-color'] = color;
    p['text-halo-color'] = C.white;
    p['text-halo-width'] = 1.4;
    p['text-halo-blur'] = 0.3;
    if (id === 'label_city_capital') y['text-size'] = ['interpolate', ['linear'], ['zoom'], 4, 12, 7, 14, 11, 17];
    if (id === 'label_city') y['text-size'] = ['interpolate', ['linear'], ['zoom'], 4, 11, 7, 13, 11, 15];
  }

  function tune(style) {
    delete style.sprite;
    if (style.sources) delete style.sources.ne2_shaded;
    var out = [];
    (style.layers || []).forEach(function (l) {
      if (DROP[l.id] || l.source === 'ne2_shaded' || l.type === 'raster') return;
      var p = l.paint || (l.paint = {});
      var y = l.layout || (l.layout = {});
      switch (l.id) {
        case 'background': p['background-color'] = C.bg; break;
        case 'park': p['fill-color'] = C.park; break;
        case 'landcover_wood':
          p['fill-color'] = C.park;
          p['fill-opacity'] = ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 0.8];
          break;
        case 'landcover_ice_shelf': case 'landcover_glacier': p['fill-color'] = C.white; break;
        case 'water': p['fill-color'] = C.water; break;
        case 'waterway': p['line-color'] = C.water; break;
        case 'landuse_residential':
          p['fill-color'] = C.residential;
          p['fill-opacity'] = ['interpolate', ['linear'], ['zoom'], 8, 0.9, 15, 0.6];
          break;
        case 'building':
          p['fill-color'] = C.building;
          p['fill-outline-color'] = C.buildingEdge;
          p['fill-opacity'] = ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 1];
          break;
        case 'road_area_pier': p['fill-color'] = C.bg; break;
        case 'road_pier': p['line-color'] = C.bg; break;
        case 'aeroway-area': p['fill-color'] = C.residential; break;
        case 'highway_path':
          p['line-color'] = C.path;
          p['line-opacity'] = 0.8;
          p['line-dasharray'] = [2, 2];
          p['line-width'] = ['interpolate', ['exponential', 1.2], ['zoom'], 14, 0.8, 20, 5];
          break;
        case 'highway_minor':
          p['line-color'] = ['interpolate', ['linear'], ['zoom'], 12.5, C.minorLow, 14, C.white];
          p['line-opacity'] = 1;
          break;
        case 'boundary_2':
          p['line-color'] = C.boundary;
          break;
        default:
          if (l.type === 'line') roadPaint(l, p);
      }
      if (l.type === 'symbol') {
        /* no sprite: the city dots and shields go, the words stay */
        delete y['icon-image'];
        /* uppercase() has no locale — «İçərişəhər» would come out with a dotless I */
        delete y['text-transform'];
        if (/^label_/.test(l.id)) { y['text-anchor'] = 'center'; delete y['text-offset']; }
        if (y['text-field']) { y['text-field'] = nameExpr(lang); LABELS.push(l.id); }
        labelPaint(l, p, y);
      }
      if (l.id === 'highway_minor') {
        out.push({
          id: 'highway_minor_casing', type: 'line', source: l.source, 'source-layer': l['source-layer'],
          minzoom: 13.5, filter: l.filter, layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': C.minorCasing,
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 1],
            'line-width': ['interpolate', ['exponential', 1.55], ['zoom'], 13, 3, 20, 22.5]
          }
        });
      }
      out.push(l);
    });
    style.layers = out;
    return style;
  }

  /* ----------------------------------------------------------------- map */

  var map = null;
  var loaded = false;
  var inbox = [];
  var inset = CFG.inset || 0;
  var interacted = false;   // any touch on the map, marker or pin
  var hasFit = false;       // the one automatic fit to the markers has happened
  var firstFixDone = false;
  var following = false;
  var flying = false;

  function view() {
    var el = document.getElementById('map');
    return { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
  }
  function padding() {
    var v = view();
    return {
      top: Math.round(Math.min(64, v.h * 0.18)),
      bottom: Math.round(Math.min(56 + inset, v.h * 0.45)),
      left: Math.round(Math.min(44, v.w * 0.14)),
      right: Math.round(Math.min(44, v.w * 0.14))
    };
  }
  /* centre things in the part of the map the screen does not cover */
  function offset() { return [0, -Math.round(inset / 2)]; }

  function boundsOf(list) {
    var b = new maplibregl.LngLatBounds();
    list.forEach(function (m) { b.extend([m.lng, m.lat]); });
    return b;
  }

  function create(style) {
    var opts = {
      container: 'map',
      style: style,
      center: [CFG.center.lng, CFG.center.lat],
      zoom: CFG.zoom,
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      boxZoom: false,
      keyboard: false,
      fadeDuration: 180,
      pixelRatio: Math.min(window.devicePixelRatio || 1, CFG.maxPixelRatio || 2)
    };
    /* The opening view, decided before the first frame so nothing jumps:
       the caller's centre, else the user (if we fly to fixes), else the markers. */
    if (!CFG.hasCenter) {
      if (CFG.user && CFG.firstFixZoom) {
        opts.center = [CFG.user.lng, CFG.user.lat];
        opts.zoom = CFG.firstFixZoom;
        firstFixDone = true;
        hasFit = true;
      } else if (CFG.markers.length > 1) {
        opts.bounds = boundsOf(CFG.markers);
        opts.fitBoundsOptions = { padding: padding(), maxZoom: 15 };
        hasFit = true;
      } else if (CFG.markers.length === 1) {
        opts.center = [CFG.markers[0].lng, CFG.markers[0].lat];
        hasFit = true;
      }
    } else {
      hasFit = true;
      if (CFG.user) firstFixDone = true;
    }

    map = new maplibregl.Map(opts);
    map.touchZoomRotate.disableRotation();
    if (CFG.preview) {
      var credit = document.createElement('div');
      credit.className = 'spot-credit';
      credit.textContent = '© OpenMapTiles © OpenStreetMap';
      document.body.appendChild(credit);
    } else {
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    }

    map.on('load', onLoad);
    map.on('error', function (e) {
      var m = e && e.error && e.error.message;
      if (m) post({ t: 'log', msg: m });
    });
  }

  function onLoad() {
    loaded = true;
    addAccuracyLayers();
    map.on('dragstart', gesture);
    map.on('zoomstart', function (e) { if (e && e.originalEvent) gesture(); });
    map.on('moveend', function () { flying = false; });
    map.on('click', onMapClick);

    setMarkers(CFG.markers);
    select(CFG.selectedId);
    if (CFG.picked) ensurePin(CFG.picked.lat, CFG.picked.lng);
    if (CFG.user) setUser(CFG.user);

    /* MapLibre opens the compact credit expanded and folds it on the first drag;
       a map nobody drags (the small previews) folds it after a few seconds. */
    setTimeout(function () {
      var a = document.querySelector('.maplibregl-ctrl-attrib');
      if (a) a.classList.remove('maplibregl-compact-show');
    }, 5000);

    post({ t: 'ready' });
    var q = inbox; inbox = [];
    q.forEach(handle);
  }

  function gesture() {
    interacted = true;
    if (following) { following = false; post({ t: 'follow', on: false }); }
  }

  function onMapClick(e) {
    var tgt = e && e.originalEvent && e.originalEvent.target;
    if (tgt && tgt.closest && tgt.closest('.maplibregl-marker')) return;
    interacted = true;
    /* placing the pin (like picking a gym) ends «follow me»: the next fix must
       not pan the map away from what the user just chose */
    if (CFG.pickable) { gesture(); placePin(e.lngLat.lat, e.lngLat.lng); return; }
    if (!CFG.selectionControlled) select(null);
    post({ t: 'mapTap' });
  }

  /* ------------------------------------------------------------- markers */

  var gyms = {};
  var gymsKey = '';
  var selected = null;

  function svgGlyph(color) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + CFG.dumbbell +
      '" fill="none" stroke="' + color + '" stroke-width="2.3" stroke-linecap="round"/></svg>';
  }

  function makeGym(d) {
    var el = document.createElement('div');
    el.className = 'gm';
    el.setAttribute('role', 'button');
    var i = document.createElement('i');
    i.innerHTML = svgGlyph('currentColor');
    el.appendChild(i);
    var entry = { el: el, d: d, m: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([d.lng, d.lat]).addTo(map) };
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      gesture();
      /* when RN owns the selection it answers with a 'select'; the page never
         shows a state the screen's card does not */
      if (!CFG.selectionControlled) select(entry.d.id);
      post({ t: 'marker', id: entry.d.id });
    });
    return entry;
  }

  function paintGym(e) {
    var sel = e.d.id === selected;
    e.el.classList.toggle('sel', sel);
    e.el.classList.toggle('on', !sel && !!e.d.active);
    e.el.style.zIndex = sel ? '4' : e.d.active ? '3' : '2';
    e.el.setAttribute('aria-label', e.d.subtitle ? e.d.title + ', ' + e.d.subtitle : e.d.title);
  }

  function setMarkers(list) {
    list = list || [];
    var key = JSON.stringify(list);
    if (key === gymsKey) return;
    gymsKey = key;
    var seen = {};
    list.forEach(function (d) {
      seen[d.id] = 1;
      var e = gyms[d.id];
      if (!e) { e = gyms[d.id] = makeGym(d); }
      else { e.d = d; e.m.setLngLat([d.lng, d.lat]); }
      paintGym(e);
    });
    Object.keys(gyms).forEach(function (id) {
      if (!seen[id]) { gyms[id].m.remove(); delete gyms[id]; }
    });
    selected = gyms[selected] ? selected : null;
    applySelection(false);
    /* one automatic fit, the first time there are markers — never again,
       so a refreshed list cannot yank the map away from where the user put it */
    if (!hasFit && list.length && !interacted) {
      hasFit = true;
      if (list.length > 1) map.fitBounds(boundsOf(list), { padding: padding(), maxZoom: 15, duration: 600, linear: true });
      else map.easeTo({ center: [list[0].lng, list[0].lat], duration: 600, offset: offset() });
    }
  }

  /* «wanted» is what was asked for; it may name a gym whose marker has not
     arrived yet, and is applied the moment it does. */
  var wanted = null;
  function select(id) {
    wanted = id || null;
    applySelection(true);
  }
  function applySelection(scroll) {
    var id = wanted && gyms[wanted] ? wanted : null;
    if (id === selected) return;
    var prev = selected;
    selected = id;
    if (prev && gyms[prev]) paintGym(gyms[prev]);
    if (id) { paintGym(gyms[id]); if (scroll) reveal(gyms[id].d); }
  }

  /* keep the selected gym out from under the screen's card */
  function reveal(d) {
    if (!d) return;
    var v = view();
    var p = map.project([d.lng, d.lat]);
    var hidden = p.y > v.h - inset - 36 || p.y < 48 || p.x < 28 || p.x > v.w - 28;
    if (hidden) map.easeTo({ center: [d.lng, d.lat], offset: offset(), duration: 350 });
  }

  /* ---------------------------------------------------------- picker pin */

  var pin = null;
  var pinEl = null;

  function ensurePin(lat, lng) {
    if (pin) { pin.setLngLat([lng, lat]); return; }
    pinEl = document.createElement('div');
    pinEl.className = 'pp';
    pinEl.innerHTML =
      '<s></s><svg viewBox="0 0 36 46" aria-hidden="true">' +
      '<path d="M18 44.2c-.5 0-1-.3-1.3-.7C11.3 35.4 2.6 28 2.6 18.4 2.6 9.8 9.5 2.8 18 2.8s15.4 7 15.4 15.6c0 9.6-8.7 17-14.1 25.1-.3.4-.8.7-1.3.7z" fill="' + C.volt + '" stroke="' + C.white + '" stroke-width="2.4"/>' +
      '<g transform="translate(8.6 8.9) scale(.78)"><path d="' + CFG.dumbbell + '" fill="none" stroke="' + C.ink + '" stroke-width="2.5" stroke-linecap="round"/></g>' +
      '</svg>';
    pin = new maplibregl.Marker({ element: pinEl, anchor: 'bottom', draggable: true }).setLngLat([lng, lat]).addTo(map);
    pinEl.style.zIndex = '6';
    pin.on('dragstart', function () { gesture(); pinEl.classList.add('lift'); });
    pin.on('dragend', function () {
      pinEl.classList.remove('lift');
      var p = pin.getLngLat();
      post({ t: 'pick', lat: p.lat, lng: p.lng });
    });
  }

  function placePin(lat, lng) {
    ensurePin(lat, lng);
    pinEl.classList.remove('drop');
    void pinEl.offsetWidth;
    pinEl.classList.add('drop');
    post({ t: 'pick', lat: lat, lng: lng });
  }

  /* -------------------------------------------------------- you are here */

  var me = null;
  var meMarker = null;
  var EMPTY = { type: 'FeatureCollection', features: [] };

  function firstSymbolId() {
    var ls = map.getStyle().layers || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].type === 'symbol') return ls[i].id;
    return undefined;
  }

  function addAccuracyLayers() {
    map.addSource('spot-accuracy', { type: 'geojson', data: EMPTY });
    var before = firstSymbolId();
    map.addLayer({ id: 'spot-accuracy-fill', type: 'fill', source: 'spot-accuracy',
      paint: { 'fill-color': C.blue, 'fill-opacity': 0.1 } }, before);
    map.addLayer({ id: 'spot-accuracy-line', type: 'line', source: 'spot-accuracy',
      paint: { 'line-color': C.blue, 'line-opacity': 0.3, 'line-width': 1 } }, before);
  }

  /* a geodesic circle: metres stay metres at every zoom and latitude */
  function circle(lng, lat, r) {
    var R = 6378137, d = r / R, la = lat * Math.PI / 180, lo = lng * Math.PI / 180, pts = [];
    for (var k = 0; k <= 64; k++) {
      var b = 2 * Math.PI * k / 64;
      var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
      var lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      pts.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
  }

  function setUser(loc) {
    var src = map.getSource('spot-accuracy');
    if (!loc) {
      me = null;
      if (meMarker) { meMarker.remove(); meMarker = null; }
      if (src) src.setData(EMPTY);
      if (following) { following = false; post({ t: 'follow', on: false }); }
      return;
    }
    me = loc;
    if (!meMarker) {
      var el = document.createElement('div');
      el.className = 'ud';
      el.innerHTML = '<b></b>';
      el.style.zIndex = '5';
      meMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([loc.lng, loc.lat]).addTo(map);
    } else {
      meMarker.setLngLat([loc.lng, loc.lat]);
    }
    if (src) src.setData(loc.accuracy > 0 ? circle(loc.lng, loc.lat, loc.accuracy) : EMPTY);

    if (following) {
      if (!flying) map.easeTo({ center: [loc.lng, loc.lat], offset: offset(), duration: 600 });
    } else if (!firstFixDone) {
      firstFixDone = true;
      if (CFG.firstFixZoom && !CFG.hasCenter && !interacted) {
        hasFit = true;
        map.flyTo({ center: [loc.lng, loc.lat], zoom: Math.max(map.getZoom(), CFG.firstFixZoom),
          offset: offset(), duration: 900, essential: true });
        /* after the call: flyTo stops a running ease first, and that fires a
           synchronous 'moveend' that would clear the flag at once */
        flying = true;
      }
    }
  }

  function locate(m) {
    firstFixDone = true;
    following = false;
    setUser({ lat: m.lat, lng: m.lng, accuracy: m.accuracy });
    following = true;
    post({ t: 'follow', on: true });
    map.flyTo({ center: [m.lng, m.lat], zoom: Math.max(map.getZoom(), m.zoom || 15),
      offset: offset(), duration: 900, essential: true });
    flying = true; // after the call, see setUser
  }

  /* ----------------------------------------------------------- language */

  function setLang(l) {
    if (!l || l === lang) return;
    lang = l;
    var expr = nameExpr(l);
    LABELS.forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, 'text-field', expr); });
  }

  function setInset(px) {
    inset = Math.max(0, Math.round(px || 0));
    document.documentElement.style.setProperty('--inset', inset + 'px');
    if (selected && gyms[selected]) reveal(gyms[selected].d);
  }

  /* ------------------------------------------------------------- inbox */

  function handle(d) {
    try {
      switch (d.t) {
        case 'markers': setMarkers(d.markers); break;
        case 'select': select(d.id); break;
        case 'user': setUser(d.loc); break;
        case 'locate': locate(d); break;
        case 'lang': setLang(d.lang); break;
        case 'inset': setInset(d.bottom); break;
        case 'center':
          map.easeTo({ center: [d.lng, d.lat], zoom: d.zoom || map.getZoom(), offset: offset(), duration: 500 });
          break;
        case 'place': placePin(d.lat, d.lng); break;
      }
    } catch (e) { post({ t: 'log', msg: String(e && e.message) }); }
  }

  window.__spotRecv = function (d) {
    if (!d || typeof d !== 'object') return;
    if (!loaded) inbox.push(d); else handle(d);
  };
  /* the old postMessage channel still works */
  function onMsg(ev) { try { window.__spotRecv(typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data); } catch (e) {} }
  window.addEventListener('message', onMsg);
  document.addEventListener('message', onMsg);

  loadScript(0);
})();
</script></body></html>`;
}
