import { StyleSheet, View, ViewStyle } from 'react-native';

import { palette, radius, type } from '@/theme';
import { AppText } from './AppText';
import { Icon, IconName } from '../Icon';
import { PressableScale } from './PressableScale';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** resting background: 'element' (grey) or 'card' (white) */
  tone?: 'element' | 'card';
  style?: ViewStyle;
};

export function Chip({ label, selected, onPress, icon, tone = 'element', style }: Props) {
  const bg = selected ? palette.ink : tone === 'card' ? palette.white : palette.element;
  const fg = selected ? palette.white : palette.text3;
  return (
    /* The pill is ~32 pt tall, as filter chips are on both platforms; the 6 pt
       vertical slop makes the target 44. Where the parent is a real native view as
       tall as the chip (a horizontal ScrollView row), Android clips the slop — the
       chips are wide, so that is the axis that matters least. */
    <PressableScale
      onPress={onPress}
      activeScale={0.94}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, { backgroundColor: bg }, style]}>
      <View style={styles.row}>
        {icon ? <Icon name={icon} size={13} color={fg} /> : null}
        <AppText style={[type.caption, { color: fg, fontSize: 12.5, fontWeight: '600' }]}>{label}</AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: radius.pill, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
