/**
 * SPOT design system — single source of truth for colors, typography, spacing.
 * Derived from the design handoff (SPOT iOS App). Light mode is primary;
 * a few screens (welcome, active workout, video feed) are dark and use `dark` tokens.
 *
 * Principle: "simplicity in structure, magnificence in motion."
 *
 * COLOUR — one primary, one accent, and colour only where it means something.
 *   · Ink is the primary: buttons, active states, EVERY navigation glyph and every
 *     text action («Bağla», «Paylaş», «Hamısı»). A text action is told apart from
 *     text by weight (500/600), not by a link colour.
 *   · Volt is the accent — energy, success, live, verified. It is 1.2:1 on white,
 *     so on light surfaces it is a FILL only (with ink on it); a green glyph on a
 *     light surface is `voltDeep` (4.7:1), green text is `voltText` (8.4:1). On dark
 *     surfaces volt itself is the glyph and the text (16.6:1).
 *   · Streak orange is seriya AND warning — one orange family: `streak` for glyphs
 *     and fills (2.8:1 — never small text), `streakText` for words (5.4:1).
 *   · Red is danger only: delete, errors, unread badges.
 *   · There is no blue. It was iOS's system tint, it came in through links, the
 *     back chevron, the verified seal and the settings tiles, and it made SPOT read
 *     as two apps — «some icons blue, some green». Removed from the palette so it
 *     cannot creep back.
 */
import { Platform, TextStyle } from 'react-native';

export const palette = {
  ink: '#101014', // primary buttons, active states
  inkText: '#0B0B0E', // near-black text
  ink17: '#17171C', // elevated dark surface
  volt: '#C6FF3D', // accent — fills; glyphs/text only on dark surfaces
  voltText: '#3F5500', // green TEXT on light surfaces and volt tints (8.4:1 on white)
  voltDeep: '#5B7F00', // green GLYPHS on light surfaces (4.7:1 on white)
  voltTint: 'rgba(198,255,61,0.24)', // success / verified chip background
  white: '#FFFFFF',
  canvas: '#E9E9EC', // app canvas behind cards
  grouped: '#F4F4F6', // grouped list background / tag fill
  element: '#F0F0F3', // segmented control / chip resting
  element2: '#EFEFF2',
  fill: 'rgba(118,118,128,0.12)', // iOS system fill (search fields)
  textSecondary: '#6E6E76',
  caption: '#8A8A93',
  tertiary: '#A0A0A8', // inactive tab / muted
  text3: '#3A3A42',
  text4: '#4A4A52',
  separator: 'rgba(60,60,67,0.18)',
  hairline: 'rgba(60,60,67,0.12)',
  cardBorder: 'rgba(60,60,67,0.10)',
  streak: '#FF6B35', // seriya + warning — glyphs and fills
  streakText: '#B8441A', // orange TEXT on light surfaces (5.4:1 on white)
  streakTint: 'rgba(255,107,53,0.12)', // warning / seriya chip background
  red: '#FF3B30', // destructive / unread
  inkTint: 'rgba(16,16,20,0.06)', // neutral chip / quote background
  overlay: 'rgba(11,11,14,0.55)',
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
  ios: { selectionColor: '#5B7F00' },
  default: { selectionColor: 'rgba(198,255,61,0.55)', cursorColor: '#5B7F00' },
});
/** The same on a dark surface (the active workout): volt is the caret there. */
export const inputTintDark = Platform.select({
  ios: { selectionColor: '#C6FF3D' },
  default: { selectionColor: 'rgba(198,255,61,0.4)', cursorColor: '#C6FF3D' },
});

/** Semantic tokens for the default (light) surface. */
export const colors = {
  bg: palette.grouped, // light screens sit on #F4F4F6; cards are white
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
  button: 15,
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
  largeTitle: { fontSize: 32, lineHeight: 34, fontWeight: '700', letterSpacing: -1 },
  title: { fontSize: 27, lineHeight: 31, fontWeight: '700', letterSpacing: -0.7 },
  title2: { fontSize: 20, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4 },
  title3: { fontSize: 18, lineHeight: 22, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 15, fontWeight: '500' },
  overline: {
    fontSize: 11,
    lineHeight: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    /* No `textTransform: 'uppercase'`. React Native does that transform in
       native code with no locale, so «i» became «I» instead of «İ» and roughly
       thirty section labels across the app were misspelled in Azerbaijani —
       İSTİFADƏÇİ ADI, CİNS, SƏVİYYƏ, HƏFTƏNİN GÜNLƏRİ, BİO. AppText uppercases
       this variant in JS with `azUpper` instead. */
  },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** iOS-style soft card shadow. */
export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: '#101014',
      shadowOpacity: 0.06,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
    },
    android: { elevation: 2 },
    default: {},
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#101014',
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
    },
    android: { elevation: 8 },
    default: {},
  }),
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

/** The two sizes of an icon-only button, always inside a 44 pt box.
 *
 *  `inCircle` (24): the glyph sits in a filled shape — the gym page's four hero
 *  buttons, which the owner held up as the standard, a volt «+», the send button, the
 *  map's «where am I». The disc carries the button's size, so the glyph can be modest.
 *  `action` (31): a bare glyph on the screen's own background — header icons, back,
 *  ⋯, bookmark, chat, close. With no disc around it the glyph IS the button: at 24 it
 *  read as small next to the gym page's 44 pt discs, 34 read as too big on the phone;
 *  31 is the owner's standard. The paths fill ~70% of their box, so 31 draws a ~22 pt
 *  mark.
 *  Before this one kind of button was drawn at 20, 22, 24, 25, 26 and 27 across
 *  screens. Not for: icons inside a text row or a chip, a field's clear «x», badges
 *  on an avatar, tab bars (`tab`, which has a label under it), or the full-screen
 *  video's action rail, which stays larger on purpose. */
export const iconSize = { action: 31, inCircle: 24, tab: 28 } as const;
