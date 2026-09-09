/**
 * SPOT design system — single source of truth for colors, typography, spacing.
 * Derived from the Claude Design handoff (SPOT iOS App). Light mode is primary;
 * a few screens (welcome, active workout, video feed) are dark and use `dark` tokens.
 *
 * Principle: "simplicity in structure, magnificence in motion."
 */
import { Platform, TextStyle } from 'react-native';

export const palette = {
  ink: '#101014', // primary buttons, active states
  inkText: '#0B0B0E', // near-black text
  ink17: '#17171C', // elevated dark surface
  volt: '#C6FF3D', // energy / selection accent
  voltText: '#4C6B00', // readable text on volt tint
  voltDeep: '#5B7F00',
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
  streak: '#FF6B35', // streak / warning accent
  red: '#FF3B30', // destructive / notification
  blue: '#0A84FF', // iOS system blue (links, verified)
  overlay: 'rgba(11,11,14,0.55)',
} as const;

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
  link: palette.blue,
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
