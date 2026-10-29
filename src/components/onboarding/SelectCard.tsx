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
      /* The design's selected option card: a 1.5 pt volt border on the volt tint,
         never an ink fill. Unselected, the border is there but transparent, so
         selecting does not shift the card's content by 1.5 pt. */
      style={[styles.card, { backgroundColor: selected ? palette.voltTint : palette.white, borderColor: selected ? palette.volt : 'transparent' }]}>
      <View style={{ flex: 1 }}>
        <AppText variant="headline" color={palette.inkText}>
          {label}
        </AppText>
        {sublabel ? (
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 3 }}>
            {sublabel}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.marker, single && { borderRadius: 12 }, selected ? { backgroundColor: palette.volt, borderColor: palette.volt } : { borderColor: palette.separator }]}>
        {selected ? <Icon name="check" size={15} color={palette.ctaText} /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.card, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 15, marginBottom: 10 },
  marker: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
