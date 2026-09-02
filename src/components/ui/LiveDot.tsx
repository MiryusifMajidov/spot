import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { palette } from '@/theme';

/** Pulsing volt dot used for live check-in signals ("12 people at the gym now"). */
export function LiveDot({ size = 7, color = palette.volt }: { size?: number; color?: string }) {
  const pulse = useSharedValue(0.3);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse]);

  const glow = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          { position: 'absolute', width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, backgroundColor: color },
          glow,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
