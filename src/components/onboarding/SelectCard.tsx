import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { palette, radius } from '@/theme';

/** Full-width selectable option. The whole card is the touch target (no checkbox). */
export function SelectCard({
  label,
  sublabel,
  selected,
  onPress,
  single,
}: {
  label: string;
  sublabel?: string;
  selected?: boolean;
  onPress?: () => void;
  single?: boolean;
}) {
  return (
    <PressableScale
      activeScale={0.98}
      onPress={onPress}
      style={[styles.card, { backgroundColor: selected ? palette.ink : palette.white, borderColor: selected ? palette.ink : palette.separator }]}>
      <View style={{ flex: 1 }}>
        <AppText variant="headline" color={selected ? palette.white : palette.inkText}>
          {label}
        </AppText>
        {sublabel ? (
          <AppText variant="footnote" color={selected ? 'rgba(255,255,255,0.6)' : palette.caption} style={{ marginTop: 3 }}>
            {sublabel}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.marker, single && { borderRadius: 12 }, selected ? { backgroundColor: palette.volt, borderColor: palette.volt } : { borderColor: palette.separator }]}>
        {selected ? <Icon name="check" size={15} color={palette.inkText} /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.field, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 15, marginBottom: 10 },
  marker: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
