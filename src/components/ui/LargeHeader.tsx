import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette, spacing } from '@/theme';
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

/** Round-ish tappable header icon with optional numeric badge. */
export function HeaderIcon({ name, onPress, badge, color = palette.inkText }: { name: IconName; onPress?: () => void; badge?: number; color?: string }) {
  return (
    <PressableScale onPress={onPress} activeScale={0.9} style={styles.iconBtn}>
      <Icon name={name} size={25} color={color} />
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
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 5 },
  iconBtn: { padding: 1 },
  badge: { position: 'absolute', top: -5, right: -6, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: palette.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: palette.white, fontSize: 10.5, fontWeight: '700' },
});
