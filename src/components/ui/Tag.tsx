import { StyleSheet, View, ViewStyle } from 'react-native';

import { palette, radius } from '@/theme';
import { AppText } from './AppText';

/** Small rounded-rect metadata tag, e.g. "Free weights", "Shower". */
export function Tag({ label, style }: { label: string; style?: ViewStyle }) {
  return (
    <View style={[styles.tag, style]}>
      <AppText style={styles.text}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.tag, backgroundColor: palette.grouped },
  text: { fontSize: 11.5, lineHeight: 13, fontWeight: '600', color: palette.text3 },
});
