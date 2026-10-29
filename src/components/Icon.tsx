/**
 * SPOT icon set — Tabler Icons v3 (MIT, https://tabler.io/icons), as the design
 * specifies: outline, stroke-width 1, round caps and joins. Most paths are the ones the
 * designer placed in `SPOT iOS App.dc.html`; the few the design never drew (sound,
 * location, device, filled bookmark) come from @tabler/icons 3.49.0. The `…Fill`
 * variants are Tabler's filled icons — only the active tab-bar item uses them.
 * GENERATED from the design file; to change an icon, change the source and regenerate.
 * Usage: <Icon name="search" size={24} color={palette.inkText} />
 */
import { ReactNode } from 'react';
import Svg, { G, Path } from 'react-native-svg';

export type IconName =
  | 'search'
  | 'sliders'
  | 'pin'
  | 'star'
  | 'chevR'
  | 'chevL'
  | 'chevD'
  | 'x'
  | 'check'
  | 'plus'
  | 'heart'
  | 'msg'
  | 'bell'
  | 'dumbbell'
  | 'play'
  | 'flame'
  | 'users'
  | 'user'
  | 'cal'
  | 'clock'
  | 'cam'
  | 'lock'
  | 'shield'
  | 'share'
  | 'more'
  | 'trophy'
  | 'target'
  | 'bookmark'
  | 'verified'
  | 'apple'
  | 'scale'
  | 'meal'
  | 'timer'
  | 'video'
  | 'grid'
  | 'edit'
  | 'qr'
  | 'arrowU'
  | 'home'
  | 'homeFill'
  | 'dumbbellFill'
  | 'playFill'
  | 'userFill'
  | 'searchFill'
  | 'dm'
  | 'dmFill'
  | 'bookmarkOn'
  | 'sound'
  | 'mute'
  | 'locate'
  | 'locateOn'
  | 'phone'
  | 'browser';

/** Stroke width for outline icons. The design draws every glyph at 1. */
const STROKE = 1;

const paths: Record<IconName, (c: string, w: number) => ReactNode> = {
  search: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><Path d="M21 21l-6 -6" /></G>,
  sliders: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><Path d="M4 6l8 0" /><Path d="M16 6l4 0" /><Path d="M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><Path d="M4 12l2 0" /><Path d="M10 12l10 0" /><Path d="M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><Path d="M4 18l11 0" /><Path d="M19 18l1 0" /></G>,
  pin: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /><Path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" /></G>,
  star: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" /></G>,
  chevR: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M9 6l6 6l-6 6" /></G>,
  chevL: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 6l-6 6l6 6" /></G>,
  chevD: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M6 9l6 6l6 -6" /></G>,
  x: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M18 6l-12 12" /><Path d="M6 6l12 12" /></G>,
  check: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12l5 5l10 -10" /></G>,
  plus: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 5l0 14" /><Path d="M5 12l14 0" /></G>,
  heart: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" /></G>,
  msg: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1" /></G>,
  bell: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" /><Path d="M9 17v1a3 3 0 0 0 6 0v-1" /></G>,
  dumbbell: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M2 12h1" /><Path d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2" /><Path d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z" /><Path d="M9 12h6" /><Path d="M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1z" /><Path d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2" /><Path d="M22 12h-1" /></G>,
  play: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M7 4v16l13 -8z" /></G>,
  flame: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235" /></G>,
  users: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" /><Path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /><Path d="M16 3.13a4 4 0 0 1 0 7.75" /><Path d="M21 21v-2a4 4 0 0 0 -3 -3.85" /></G>,
  user: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /><Path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /></G>,
  cal: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z" /><Path d="M16 3v4" /><Path d="M8 3v4" /><Path d="M4 11h16" /><Path d="M11 15h1" /><Path d="M12 15v3" /></G>,
  clock: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><Path d="M12 7v5l3 3" /></G>,
  cam: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" /><Path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /></G>,
  lock: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" /><Path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><Path d="M8 11v-4a4 4 0 1 1 8 0v4" /></G>,
  shield: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /><Path d="M15 19l2 2l4 -4" /></G>,
  share: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><Path d="M7 9l5 -5l5 5" /><Path d="M12 4l0 12" /></G>,
  more: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><Path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><Path d="M19 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /></G>,
  trophy: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M8 21l8 0" /><Path d="M12 17l0 4" /><Path d="M7 4l10 0" /><Path d="M17 4v8a5 5 0 0 1 -10 0v-8" /><Path d="M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><Path d="M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /></G>,
  target: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><Path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0" /><Path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /></G>,
  bookmark: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z" /></G>,
  verified: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 7.2a2.2 2.2 0 0 1 2.2 -2.2h1a2.2 2.2 0 0 0 1.55 -.64l.7 -.7a2.2 2.2 0 0 1 3.12 0l.7 .7c.412 .41 .97 .64 1.55 .64h1a2.2 2.2 0 0 1 2.2 2.2v1c0 .58 .23 1.138 .64 1.55l.7 .7a2.2 2.2 0 0 1 0 3.12l-.7 .7a2.2 2.2 0 0 0 -.64 1.55v1a2.2 2.2 0 0 1 -2.2 2.2h-1a2.2 2.2 0 0 0 -1.55 .64l-.7 .7a2.2 2.2 0 0 1 -3.12 0l-.7 -.7a2.2 2.2 0 0 0 -1.55 -.64h-1a2.2 2.2 0 0 1 -2.2 -2.2v-1a2.2 2.2 0 0 0 -.64 -1.55l-.7 -.7a2.2 2.2 0 0 1 0 -3.12l.7 -.7a2.2 2.2 0 0 0 .64 -1.55v-1" /><Path d="M9 12l2 2l4 -4" /></G>,
  apple: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M8.286 7.008c-3.216 0 -4.286 3.23 -4.286 5.92c0 3.229 2.143 8.072 4.286 8.072c1.165 -.05 1.799 -.538 3.214 -.538c1.406 0 1.607 .538 3.214 .538s4.286 -3.229 4.286 -5.381c-.03 -.011 -2.649 -.434 -2.679 -3.23c-.02 -2.335 2.589 -3.179 2.679 -3.228c-1.096 -1.606 -3.162 -2.113 -3.75 -2.153c-1.535 -.12 -3.032 1.077 -3.75 1.077c-.729 0 -2.036 -1.077 -3.214 -1.077z" /><Path d="M12 4a2 2 0 0 0 2 -2a2 2 0 0 0 -2 2" /></G>,
  scale: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><Path d="M6.835 9h10.33a1 1 0 0 1 .984 .821l1.637 9a1 1 0 0 1 -.984 1.179h-13.604a1 1 0 0 1 -.984 -1.179l1.637 -9a1 1 0 0 1 .984 -.821z" /></G>,
  meal: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M19 3v12h-5c-.023 -3.681 .184 -7.406 5 -12zm0 12v6h-1v-3m-10 -14v17m-3 -17v3a3 3 0 1 0 6 0v-3" /></G>,
  timer: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0z" /><Path d="M14.5 10.5l-2.5 2.5" /><Path d="M17 8l1 -1" /><Path d="M14 3h-4" /></G>,
  video: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4z" /><Path d="M3 6m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" /></G>,
  grid: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" /><Path d="M14 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" /><Path d="M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" /><Path d="M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" /></G>,
  edit: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><Path d="M13.5 6.5l4 4" /></G>,
  qr: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 7v-1a2 2 0 0 1 2 -2h2" /><Path d="M4 17v1a2 2 0 0 0 2 2h2" /><Path d="M16 4h2a2 2 0 0 1 2 2v1" /><Path d="M16 20h2a2 2 0 0 0 2 -2v-1" /><Path d="M5 12l14 0" /></G>,
  arrowU: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 5l0 14" /><Path d="M18 11l-6 -6" /><Path d="M6 11l6 -6" /></G>,
  home: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M5 12l-2 0l9 -9l9 9l-2 0" /><Path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" /><Path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" /></G>,
  homeFill: (c, w) => <Path d="M12.707 2.293l9 9c.63 .63 .184 1.707 -.707 1.707h-1v6a3 3 0 0 1 -3 3h-1v-7a3 3 0 0 0 -2.824 -2.995l-.176 -.005h-2a3 3 0 0 0 -3 3v7h-1a3 3 0 0 1 -3 -3v-6h-1c-.89 0 -1.337 -1.077 -.707 -1.707l9 -9a1 1 0 0 1 1.414 0m.293 11.707a1 1 0 0 1 1 1v7h-4v-7a1 1 0 0 1 .883 -.993l.117 -.007z" fill={c} />,
  dumbbellFill: (c, w) => <G><Path d="M4 7a1 1 0 0 1 1 1v8a1 1 0 0 1 -2 0v-3h-1a1 1 0 0 1 0 -2h1v-3a1 1 0 0 1 1 -1" fill={c} /><Path d="M20 7a1 1 0 0 1 1 1v3h1a1 1 0 0 1 0 2h-1v3a1 1 0 0 1 -2 0v-8a1 1 0 0 1 1 -1" fill={c} /><Path d="M16 5a2 2 0 0 1 2 2v10a2 2 0 1 1 -4 0v-4h-4v4a2 2 0 1 1 -4 0v-10a2 2 0 1 1 4 0v4h4v-4a2 2 0 0 1 2 -2" fill={c} /></G>,
  playFill: (c, w) => <Path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" fill={c} />,
  userFill: (c, w) => <G><Path d="M12 2a5 5 0 1 1 -5 5l.005 -.217a5 5 0 0 1 4.995 -4.783z" fill={c} /><Path d="M14 14a5 5 0 0 1 5 5v1a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-1a5 5 0 0 1 5 -5h4z" fill={c} /></G>,
  searchFill: (c, w) => <Path d="M14 3.072a8 8 0 0 1 2.617 11.424l4.944 4.943a1.5 1.5 0 0 1 -2.008 2.225l-.114 -.103l-4.943 -4.944a8 8 0 0 1 -12.49 -6.332l-.006 -.285l.005 -.285a8 8 0 0 1 11.995 -6.643z" fill={c} />,
  dm: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 18.5l7.265 2.463c.196 .077 .42 .032 .57 -.116a.548 .548 0 0 0 .134 -.572l-7.969 -17.275l-7.97 17.275c-.07 .2 -.017 .424 .135 .572c.15 .148 .374 .193 .57 .116l7.265 -2.463" /></G>,
  dmFill: (c, w) => <Path d="M11.092 2.581a1 1 0 0 1 1.754 -.116l.062 .116l8.005 17.365c.198 .566 .05 1.196 -.378 1.615a1.53 1.53 0 0 1 -1.459 .393l-7.077 -2.398l-6.899 2.338a1.535 1.535 0 0 1 -1.52 -.231l-.112 -.1c-.398 -.386 -.556 -.954 -.393 -1.556l.047 -.15l7.97 -17.276z" fill={c} />,
  bookmarkOn: (c, w) => <Path d="M14 2a5 5 0 0 1 5 5v14a1 1 0 0 1 -1.555 .832l-5.445 -3.63l-5.444 3.63a1 1 0 0 1 -1.55 -.72l-.006 -.112v-14a5 5 0 0 1 5 -5h4z" fill={c} />,
  sound: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 8a5 5 0 0 1 0 8" /><Path d="M17.7 5a9 9 0 0 1 0 14" /><Path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" /></G>,
  mute: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 8a5 5 0 0 1 1.912 4.934m-1.377 2.602a5 5 0 0 1 -.535 .464" /><Path d="M17.7 5a9 9 0 0 1 2.362 11.086m-1.676 2.299a9 9 0 0 1 -.686 .615" /><Path d="M9.069 5.054l.431 -.554a.8 .8 0 0 1 1.5 .5v2m0 4v8a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l1.294 -1.664" /><Path d="M3 3l18 18" /></G>,
  locate: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><Path d="M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0" /><Path d="M12 2l0 2" /><Path d="M12 20l0 2" /><Path d="M20 12l2 0" /><Path d="M2 12l2 0" /></G>,
  locateOn: (c, w) => <Path d="M12 1a1 1 0 0 1 1 1v1.055a9.004 9.004 0 0 1 7.946 7.945h1.054a1 1 0 0 1 0 2h-1.055a9.004 9.004 0 0 1 -7.944 7.945l-.001 1.055a1 1 0 0 1 -2 0v-1.055a9.004 9.004 0 0 1 -7.945 -7.944l-1.055 -.001a1 1 0 0 1 0 -2h1.055a9.004 9.004 0 0 1 7.945 -7.945v-1.055a1 1 0 0 1 1 -1m0 4a7 7 0 1 0 0 14a7 7 0 0 0 0 -14m0 3a4 4 0 1 1 -4 4l.005 -.2a4 4 0 0 1 3.995 -3.8" fill={c} />,
  phone: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14" /><Path d="M11 4h2" /><Path d="M12 17v.01" /></G>,
  browser: (c, w) => <G fill="none" stroke={c} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><Path d="M4 8h16" /><Path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" /><Path d="M8 4v4" /></G>,
};

export function Icon({
  name,
  size = 24,
  color = '#1A1A1A',
  strokeWidth = STROKE,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name](color, strokeWidth)}
    </Svg>
  );
}
