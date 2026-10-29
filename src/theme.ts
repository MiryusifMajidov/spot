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
 */
import { Platform, TextStyle } from 'react-native';

export const palette = {
  ink: '#1A1A1A', // «black»: emphasis fills, Apple button, ink text
  inkText: '#1A1A1A', // text
  ink17: '#17171C', // dark surface (dark screens until the dark-mode pass)
  volt: '#C5FE01', // the accent — CTA fill, live/success dots, selection borders
  voltText: '#527A01', // green TEXT on light surfaces (accent text)
  voltDeep: '#527A01', // green GLYPHS on light surfaces (active tab, checks, stars)
  voltTint: 'rgba(197,254,1,0.14)', // selected outlined card / success chip background
  white: '#FEFEFE', // surface (cards, sheets, circles) — never pure #FFFFFF
  onDark: '#FAFAFA', // text and glyphs on an ink / dark background
  canvas: '#F7F7F7', // screen background
  grouped: '#F7F7F7', // screen background / field inside a card
  element: '#EDEDED', // secondary button, selected chip, inner fill
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
  streak: '#FF6B35', // seriya + warning — glyphs and fills
  streakText: '#B8441A', // orange TEXT on light surfaces (5.4:1 on white)
  streakTint: 'rgba(255,107,53,0.12)', // warning / seriya chip background
  red: '#FF3B30', // destructive / unread
  inkTint: 'rgba(26,26,26,0.06)', // neutral chip / quote background
  overlay: 'rgba(26,26,26,0.55)',
  // ---- roles the design names ----
  cta: '#C5FE01', // primary action fill
  ctaText: '#1A1A1A', // text/glyph on the CTA
  ctaDisabled: '#FEFEFE', // disabled CTA fill (text: tertiary)
  selected: '#EDEDED', // selected chip / day / filled card
  chevron: '#C0C0C6', // disclosure chevrons in rows
  rowIcon: '#6B6B6B', // outline glyph at the start of a settings row
  toggleOn: '#34C759', // Switch track when on
  tabActive: '#527A01', // active tab glyph
  tabPill: '#F2F2F2', // pill behind the active tab
  verified: '#0A84FF', // the verified badge — one of two places blue is kept
  cancel: '#0A84FF', // «Ləğv et» in sheets and headers — the other
} as const;

/**
 * The caret, selection handles and selection highlight of a text field. Without
 * them iOS drew all three in its system blue — the last blue left in SPOT, on
 * every field. Spread FIRST on a TextInput (`<TextInput {...inputTint} …>`).
 * iOS tints all three from `selectionColor`; Android paints the highlight with it
 * as-is, so there it is a translucent volt (ink text stays readable on it) and the
 * caret comes from `cursorColor`.
 */
export const inputTint = Platform.select({
  ios: { selectionColor: '#527A01' },
  default: { selectionColor: 'rgba(197,254,1,0.55)', cursorColor: '#527A01' },
});
/** The same on a dark surface (the active workout): volt is the caret there. */
export const inputTintDark = Platform.select({
  ios: { selectionColor: '#C5FE01' },
  default: { selectionColor: 'rgba(197,254,1,0.4)', cursorColor: '#C5FE01' },
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
  accentText: palette.white,
  volt: palette.volt,
  link: palette.inkText, // text actions are ink; weight marks them, not colour
  separator: palette.separator,
  fill: palette.fill,
  streak: palette.streak,
  danger: palette.red,
} as const;

/** Tokens for dark screens (welcome, active workout, video feed). */
export const dark = {
  bg: palette.inkText,
  surface: palette.ink17,
  text: palette.white,
  textSecondary: 'rgba(255,255,255,0.60)',
  textTertiary: 'rgba(255,255,255,0.45)',
  hairline: 'rgba(255,255,255,0.12)',
  fill: 'rgba(255,255,255,0.10)',
  volt: palette.volt,
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
