import { StyleSheet, Text, TextProps, TextStyle } from 'react-native';

import { colors, type as typeScale, TypeVariant } from '@/theme';

type Props = TextProps & {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
};

/** Maps a font weight to the matching bundled Inter family (RN needs the exact family per weight). */
const INTER: Record<string, string> = {
  '400': 'Inter_400Regular',
  normal: 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  bold: 'Inter_700Bold',
  '800': 'Inter_800ExtraBold',
};

/**
 * Typed text primitive on the SPOT type scale, rendered with Inter.
 * - Weight is encoded in the Inter family name, so we STRIP fontWeight (a single-weight custom
 *   family + fontWeight fails to resolve on Android and falls back to the system font).
 * - We guarantee lineHeight >= ~1.3x fontSize so Android never clips descenders (q, ş, ç, g, y).
 */
export function AppText({ variant = 'body', color = colors.text, center, style, ...rest }: Props) {
  const merged = (StyleSheet.flatten([typeScale[variant], style]) ?? {}) as TextStyle;
  const weight = String(merged.fontWeight ?? '400');
  const fontFamily = (merged.fontFamily as string | undefined) ?? INTER[weight] ?? INTER['400'];

  const fontSize = (merged.fontSize as number | undefined) ?? 15;
  const lineHeight = Math.max((merged.lineHeight as number | undefined) ?? 0, Math.ceil(fontSize * 1.3));

  const { fontWeight: _omitWeight, ...styleNoWeight } = merged;

  return (
    <Text
      style={[
        { color },
        styleNoWeight,
        { fontFamily, lineHeight, includeFontPadding: true },
        center ? { textAlign: 'center' } : null,
      ]}
      {...rest}
    />
  );
}
