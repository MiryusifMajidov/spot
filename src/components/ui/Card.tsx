import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors, radius, shadow } from '@/theme';

type Props = {
  children: ReactNode;
  padded?: boolean;
  elevated?: boolean;
  style?: ViewStyle;
};

/** White rounded surface used across the app. */
export function Card({ children, padded, elevated, style }: Props) {
  return (
    <View style={[styles.card, elevated && (shadow.card as object), padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.cardLg, overflow: 'hidden' },
  padded: { padding: 16 },
});
