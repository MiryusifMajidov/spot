/**
 * SPOT design system — single source of truth for colors, typography, spacing.
 * Source: the designer's final handoff (Oct 2026, `SPOT iOS App.dc.html` +
 * README §8.1.1 «Rəng qaydaları», «Tab bar (yekun)», «Kölgə qaydası»).
 *
 * COLOUR RULES (the designer's, mandatory):
 *   · No pure white or black anywhere: «black» is #1A1A1A, white text #FAFAFA, a
 *     white surface #FEFEFE. Screens sit on #F7F7F7, cards on #FEFEFE.
 *   · Every primary action (CTA) is volt #C5FE01 with #1A1A1A text — the one
 *     exception is «Apple ilə davam et», black per Apple's guidelines. A disabled
 *     CTA is #FEFEFE with #888888 text. Secondary buttons: #EDEDED, no border.
 *   · A selected chip / day / filled card is #EDEDED with #1A1A1A text — no black
 *     fills for selection in light mode. A selected outlined card or a check/radio:
 *     volt border on rgba(197,254,1,.14), the check disc volt with an ink glyph.
 *   · Green text and active glyphs are #527A01 (accentText); toggles are #34C759.
 *   · Blue only where the design keeps it: the verified badge and «Ləğv et».
 *   · No ALL-CAPS text: headings and labels are sentence case (QR, SPOT, PR stay).
 *   · No drop shadows on anything — depth is #F7F7F7 screen vs #FEFEFE card.
 *   · Light is the default for every screen; dark only follows the OS setting.
 *
 * DARK MODE. `palette` is picked ONCE, when this module is first imported, from
 * the OS appearance — every `StyleSheet.create` in the app reads it at import
 * time, so the whole app is drawn in one scheme with no per-render cost and no
 * component has to know about themes. When the OS switches while SPOT is open,
 * the root layout reloads the JS bundle (`reloadAppAsync`) and everything is
 * imported again in the new scheme.
 * What that asks of the code: a token names a ROLE, never a colour. `white` is
 * the surface (#252527 in dark), `inkText` the text (#FAFAFA in dark). Anything
 * that must look the same in both schemes has its own token:
 *   · `ctaText` — text and glyphs on volt (ink in both).
 *   · `onDark` — text and glyphs on media or an ink fill (#FAFAFA in both).
 *   · `media` — behind video and the camera (#1A1A1A in both).
 *   · `media` / `paper` — the QR code's modules; a scanner needs dark on light.
 */
import { Appearance, Platform, TextStyle } from 'react-native';

/** The scheme this launch is drawn in (see DARK MODE above). */
export const scheme: 'light' | 'dark' = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
export const isDark = scheme === 'dark';

const light = {
  ink: '#1A1A1A', // «black»: emphasis fills (the toast), map ink
  inkText: '#1A1A1A', // text
  ink17: '#17171C', // dark surface
  volt: '#C5FE01', // the accent — CTA fill, live/success dots, selection borders
  voltText: '#527A01', // green TEXT on light surfaces (accent text)
  voltDeep: '#527A01', // green GLYPHS on light surfaces (active tab, checks, stars)
  voltTint: 'rgba(197,254,1,0.14)', // selected outlined card / success chip background
  white: '#FEFEFE', // surface (cards, sheets, circles) — never pure #FFFFFF
  onDark: '#FAFAFA', // text and glyphs on media or an ink fill
  canvas: '#F7F7F7', // screen background
  grouped: '#F7F7F7', // screen background / field inside a card
  element: '#EDEDED', // secondary button, inner fill
  element2: '#EDEDED',
  fill: 'rgba(118,118,128,0.12)', // search field
  textSecondary: '#6B6B6B',
  caption: '#888888',
  tertiary: '#888888', // muted glyphs and text, disabled CTA text
  text3: '#3A3A42',
  text4: '#4A4A52',
  separator: 'rgba(60,60,67,0.14)',
  hairline: 'rgba(60,60,67,0.12)',
  cardBorder: 'rgba(60,60,67,0.10)',
  outline: 'rgba(26,26,26,0.3)', // an empty check ring
  glass: 'rgba(252,252,252,0.94)', // a translucent surface over video or a list
  stubFrom: '#D6D6DC', // a photo that has not loaded / does not exist: gradient…
  stubTo: '#EDEDF0',
  stubGlyph: 'rgba(11,11,14,0.14)', // …and the faint glyph on it
  streak: '#FF6B35', // seriya + warning — glyphs and fills
  streakText: '#B8441A', // orange TEXT on light surfaces (5.4:1 on white)
  streakTint: 'rgba(255,107,53,0.12)', // warning / seriya chip background
  red: '#FF3B30', // destructive / unread
  inkTint: 'rgba(26,26,26,0.06)', // neutral chip / quote background
  overlay: 'rgba(26,26,26,0.55)',
  // ---- the same in both schemes ----
  media: '#1A1A1A', // behind video and the camera; the QR code's dark modules
  paper: '#FEFEFE', // the QR code's light modules
  // ---- roles the design names ----
  cta: '#C5FE01', // primary action fill
  ctaText: '#1A1A1A', // text/glyph on the CTA — and on anything volt
  ctaDisabled: '#FEFEFE', // disabled CTA fill (text: tertiary)
  selected: '#EDEDED', // selected chip / day / filled card
  chevron: '#C0C0C6', // disclosure chevrons in rows
  rowIcon: '#6B6B6B', // outline glyph at the start of a settings row
  toggleOn: '#34C759', // Switch track when on
  tabActive: '#527A01', // active tab glyph
  tabPill: '#F2F2F2', // pill behind the active tab
  appleBg: '#1A1A1A', // «Apple ilə davam et»: black on light (Apple's rule)…
  appleText: '#FAFAFA',
  verified: '#0A84FF', // the verified badge — one of two places blue is kept
  cancel: '#0A84FF', // «Ləğv et» in sheets and headers — the other
} as const;

export type Palette = { readonly [K in keyof typeof light]: string };

/** The designer's dark file (`SPOT iOS App Dark.dc.html`, README §8.1.1). */
const night: Palette = {
  ink: '#2C2C2F', // surface-emphasis («ink card»)
  inkText: '#FAFAFA',
  ink17: '#17171C',
  volt: '#C5FE01',
  voltText: '#C5FE01', // accent text is volt itself on a dark surface
  voltDeep: '#C5FE01',
  voltTint: 'rgba(197,254,1,0.14)',
  white: '#252527', // surface
  onDark: '#FAFAFA',
  canvas: '#1A1A1A',
  grouped: '#1A1A1A', // a field inside a card is a darker inset here
  element: '#303033',
  element2: '#303033',
  fill: 'rgba(118,118,128,0.24)',
  textSecondary: '#A3A3AB',
  caption: '#8E8E96',
  tertiary: '#8E8E96',
  text3: '#D4D4DA',
  text4: '#B4B4BA',
  separator: 'rgba(235,235,245,0.14)',
  hairline: 'rgba(235,235,245,0.12)',
  cardBorder: 'rgba(235,235,245,0.10)',
  outline: 'rgba(250,250,250,0.3)',
  glass: 'rgba(30,30,32,0.94)',
  stubFrom: '#3A3A3E',
  stubTo: '#2C2C2F',
  stubGlyph: 'rgba(250,250,250,0.14)',
  streak: '#FF6B35',
  streakText: '#FF8A5C',
  streakTint: 'rgba(255,107,53,0.16)',
  red: '#FF3B30',
  inkTint: 'rgba(250,250,250,0.08)',
  overlay: 'rgba(11,11,14,0.6)',
  media: '#1A1A1A',
  paper: '#FEFEFE',
  cta: '#C5FE01',
  ctaText: '#1A1A1A',
  ctaDisabled: '#303033',
  selected: '#3A3A3E',
  chevron: '#5A5A66',
  rowIcon: '#A3A3AB',
  toggleOn: '#34C759',
  tabActive: '#C5FE01',
  tabPill: 'rgba(250,250,250,0.1)',
  appleBg: '#FAFAFA', // …and white on dark
  appleText: '#1A1A1A',
  verified: '#0A84FF',
  cancel: '#0A84FF',
};

export const palette: Palette = isDark ? night : light;
/** The light set whatever the scheme — for what is drawn light in both (the map). */
export const paletteLight: Palette = light;

/** The status-bar clock over the screen background: dark on light, light on dark. */
export const screenBarStyle = isDark ? 'light-content' : 'dark-content';

/**
 * The caret, selection handles and selection highlight of a text field. Without
 * them iOS drew all three in its system blue — the last blue left in SPOT, on
 * every field. Spread FIRST on a TextInput (`<TextInput {...inputTint} …>`).
 * iOS tints all three from `selectionColor`; Android paints the highlight with it
 * as-is, so there it is a translucent volt (ink text stays readable on it) and the
 * caret comes from `cursorColor`. On a dark surface the caret is volt itself.
 */
export const inputTintDark = Platform.select({
  ios: { selectionColor: '#C5FE01' },
  default: { selectionColor: 'rgba(197,254,1,0.4)', cursorColor: '#C5FE01' },
});
export const inputTint = isDark
  ? inputTintDark
  : Platform.select({
      ios: { selectionColor: '#527A01' },
      default: { selectionColor: 'rgba(197,254,1,0.55)', cursorColor: '#527A01' },
    });

/** Semantic tokens for the default (light) surface. */
export const colors = {
  bg: palette.grouped, // screens sit on #F7F7F7; cards are #FEFEFE
  bgGrouped: palette.grouped,
  card: palette.white,
  cardBorder: palette.cardBorder,
  text: palette.inkText,
  textSecondary: palette.textSecondary,
  textTertiary: palette.caption,
  accent: palette.ink,
  accentText: palette.onDark,
  volt: palette.volt,
  link: palette.inkText, // text actions are ink; weight marks them, not colour
  separator: palette.separator,
  fill: palette.fill,
  streak: palette.streak,
  danger: palette.red,
} as const;

/** Tokens for an immersive dark screen — the same in both schemes. */
export const dark = {
  bg: '#1A1A1A',
  surface: '#17171C',
  text: '#FAFAFA',
  textSecondary: 'rgba(250,250,250,0.60)',
  textTertiary: 'rgba(250,250,250,0.45)',
  hairline: 'rgba(250,250,250,0.12)',
  fill: 'rgba(250,250,250,0.10)',
  volt: '#C5FE01',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  screen: 20, // standard screen horizontal padding
  lg: 24,
  xl: 32,
  xxl: 44,
} as const;

export const radius = {
  tag: 8,
  input: 11,
  field: 14,
  button: 16, // the design's CTA radius
  card: 16,
  cardLg: 18,
  sheet: 20,
  pill: 999,
} as const;

/**
 * Type scale (SF Pro on iOS via system font). No fontFamily set so iOS renders
 * San Francisco and Android its system face. Weights map to SF Pro weights.
 */
export const type = {
  largeTitle: { fontSize: 30, lineHeight: 34, fontWeight: '700', letterSpacing: -0.9 }, // design: 30/700, -0.9
  title: { fontSize: 27, lineHeight: 31, fontWeight: '700', letterSpacing: -0.7 },
  title2: { fontSize: 20, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4 },
  title3: { fontSize: 18, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 15, fontWeight: '500' },
  /* The section label. It used to be 11 pt CAPS with tracking; the design bans
     all-caps text, and its section labels are 13 pt / 600, sentence case, grey
     (#888888) — or accent green where the label belongs to a highlighted card. */
  overline: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0,
    /* Shown exactly as written. Never add `textTransform: 'uppercase'` back:
       React Native does that transform in native code with no locale, so «i»
       came out as «I» instead of «İ» (İSTİFADƏÇİ ADI, CİNS, BİO were misspelled). */
  },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** No shadows. The design's rule («Kölgə qaydası»): no card, button, sheet or bar
 *  casts a drop shadow — depth is the #F7F7F7 screen against the #FEFEFE card.
 *  Kept as empty styles so existing spreads (`shadow.card`) compile and draw nothing. */
export const shadow = {
  card: {},
  floating: {},
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

/** Icon-only button sizes, always inside a 44 pt box — the design's numbers
 *  (Oct 2026 handoff), drawn with Tabler's 1-unit stroke.
 *
 *  `inCircle` (20): the glyph in a 40 pt #FEFEFE disc — the back button, the gym
 *  page's hero buttons, a «+», send, «where am I».
 *  `action` (25): a bare glyph on the screen's background — header icons (chat,
 *  bell, map), ⋯, bookmark, close.
 *  `tab` (26): the tab bar, icon only.
 *  The owner had settled on 31 for bare glyphs with the old, heavier icon set; the
 *  designer's thin Tabler set is drawn at 25 and the owner asked for the design's
 *  look — if they read small on the phone, this is the one number to change.
 *  Not for: icons inside a text row (20) or a chip, a field's clear «x», badges on
 *  an avatar, or the full-screen video's action rail, which stays larger. */
export const iconSize = { action: 25, inCircle: 20, tab: 26 } as const;
