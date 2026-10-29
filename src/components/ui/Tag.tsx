import { StyleSheet, View, ViewStyle } from 'react-native';

import { palette, radius } from '@/theme';
import { AppText } from './AppText';

/** Small rounded-rect metadata tag, e.g. "Free weights", "Shower".
 *  `tone` works as on Chip: by default the tag sits on the #F7F7F7 screen and is
 *  #FEFEFE; 'card' is a tag inside a #FEFEFE card, which is #F7F7F7. */
export function Tag({ label, tone, style }: { label: string; tone?: 'card'; style?: ViewStyle }) {
  return (
    <View style={[styles.tag, { backgroundColor: tone === 'card' ? palette.grouped : palette.white }, style]}>
      <AppText style={styles.text}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.tag },
  text: { fontSize: 11.5, lineHeight: 13, fontWeight: '600', color: palette.text3 },
});
