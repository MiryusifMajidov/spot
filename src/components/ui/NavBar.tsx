import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/lib/useT';
import { palette, spacing } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { Icon } from '../Icon';

/**
 * Compact top nav bar with a back chevron, optional inline title, and right actions.
 *
 * Owners reported «some icons are too small». The chevron itself was never small
 * (26 px, the platform's own size) — its TAP AREA was: a 32x32 box, so a thumb that
 * landed on the edge of the glyph hit nothing, and the button felt tiny. It is now
 * 44x44, the iOS and Material minimum. The box grows toward the screen edge
 * (negative margin + matching padding) so the chevron stays exactly where it was,
 * and `right` is given the same width in the row so a centred title stays centred.
 *
 * This bar does NOT apply the top safe-area inset. Screens wrap it in
 * <Screen edges={['top']}>, which does; a screen that draws it inside a plain View
 * must add insets.top itself, or on Android (edge-to-edge) the chevron lands on top
 * of the status-bar clock.
 */
export function NavBar({ title, right, onBack }: { title?: string; right?: ReactNode; onBack?: () => void }) {
  const router = useRouter();
  const t = useT();
  return (
    <View style={styles.bar}>
      <PressableScale
        activeScale={0.9}
        onPress={onBack ?? (() => router.back())}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel={t('Geri')}>
        <Icon name="chevL" size={26} color={palette.blue} />
      </PressableScale>
      {title ? (
        <AppText variant="headline" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
      ) : (
        <View style={styles.title} />
      )}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, gap: 8 },
  // 44x44 hit area; -10 / +10 keeps the glyph at the bar's gutter and lets the box
  // reach toward the screen edge, where a thumb coming from the side lands.
  back: { width: 44, height: 44, marginLeft: -10, paddingLeft: 10, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
  // 34 = the room the back box takes in the row (44 - 10), so the title is centred.
  right: { minWidth: 34, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14 },
});
