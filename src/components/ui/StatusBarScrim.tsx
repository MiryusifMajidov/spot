import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/theme';

/**
 * A backing for the status bar on screens that scroll edge to edge.
 *
 * The trainer and gym panels pad their ScrollView by `insets.top`, which only
 * moves the FIRST card down: scrolled, every card slid under the clock and the
 * battery icon, and «ŞAGİRD» was printed straight through them. Render this as
 * the last child of the screen's root view, after the ScrollView.
 */
export function StatusBarScrim({ color = palette.grouped }: { color?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: color }}
    />
  );
}
