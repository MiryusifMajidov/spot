import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { iconSize, palette, spacing } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { Icon, IconName } from '../Icon';

/** iOS large-title header. `right` holds header action icons. */
export function LargeHeader({ title, right, subtitle }: { title: string; right?: ReactNode; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <AppText variant="largeTitle">{title}</AppText>
        {right ? <View style={styles.actions}>{right}</View> : null}
      </View>
      {subtitle ? (
        <AppText variant="subhead" color={palette.textSecondary} style={{ marginTop: 2 }}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Tappable header icon with an optional numeric badge.
 *
 * The glyph is `iconSize.action` (31): a bare glyph on the page background, the
 * owner's standard for every button that has no disc around it (src/theme.ts). The
 * tap area was the other «too small» part — `padding: 1` made the
 * button 27x27, so the Discover bell, chat and map icons were the «too small» icons
 * owners pointed at. The box is now 44x44 with the glyph centred. The row pulls its
 * last box back by the empty half (see styles.actions) so the glyphs stay on the
 * gutter, and the badge is re-anchored to the GLYPH's corner, not the bigger box's.
 */
export function HeaderIcon({
  name,
  onPress,
  badge,
  color = palette.inkText,
  label,
}: {
  name: IconName;
  onPress?: () => void;
  badge?: number;
  color?: string;
  /** Read by VoiceOver / TalkBack — an icon alone says nothing to a screen reader. */
  label?: string;
}) {
  return (
    <PressableScale onPress={onPress} activeScale={0.9} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={name} size={iconSize.action} color={color} />
      {badge ? (
        <View style={styles.badge}>
          <AppText style={styles.badgeText}>{badge}</AppText>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.screen, paddingTop: 2, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  /* 44 px boxes sit edge to edge: glyph centres end up 44 apart, close to the old
     25 + 14. marginRight -9.5 is the empty half of the last box, so its glyph stays
     on the gutter; marginBottom -3.5 keeps the glyphs on the large title's baseline
     now that the box is taller than the glyph. */
  actions: { flexDirection: 'row', alignItems: 'center', marginRight: -9.5, marginBottom: -3.5 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // On the glyph's top-right shoulder (a 31 glyph's ink starts ~6 pt in from the box corner).
  badge: { position: 'absolute', top: 3, right: 2, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: palette.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: palette.white, fontSize: 10.5, fontWeight: '700' },
});
