import { useState } from 'react';
import { tapFeedback } from '@/lib/feedback';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { palette, shadow, type } from '@/theme';
import { AppText } from './AppText';

type Props = {
  options: string[];
  value: number;
  onChange: (index: number) => void;
};

/** iOS segmented control with a spring-sliding white thumb. */
export function Segmented({ options, value, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const seg = width / options.length;

  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(seg * value, { duration: 190, easing: Easing.out(Easing.cubic) }) }],
    width: seg > 0 ? seg - 4 : 0,
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width - 4);

  return (
    <View style={styles.track} onLayout={onLayout}>
      {seg > 0 && <Animated.View style={[styles.thumb, thumb]} />}
      {options.map((opt, i) => (
        <Pressable
          key={opt}
          style={styles.item}
          onPress={() => {
            tapFeedback();
            onChange(i);
          }}>
          <AppText
            style={[type.subhead, { fontSize: 13.5, color: i === value ? palette.inkText : palette.textSecondary, fontWeight: i === value ? '600' : '500' }]}>
            {opt}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: palette.element2, borderRadius: 11, padding: 2, height: 36 },
  thumb: { position: 'absolute', top: 2, bottom: 2, left: 2, backgroundColor: palette.white, borderRadius: 9, ...(shadow.card as object) },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
