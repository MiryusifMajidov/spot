import { tapFeedback } from '@/lib/feedback';
import { ReactNode } from 'react';
import { Pressable, PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = PressableProps & {
  children: ReactNode;
  /** scale target while pressed */
  activeScale?: number;
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Base pressable with an iOS-grade spring press-scale and optional selection haptic.
 * "Magnificence in motion" — every tappable surface reacts.
 */
export function PressableScale({
  children,
  activeScale = 0.96,
  haptic = true,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPressIn={(e) => {
        scale.value = withTiming(activeScale, { duration: 110 });
        if (haptic) tapFeedback(); // respects the user's haptics/sounds settings
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 20, stiffness: 260 });
        onPressOut?.(e);
      }}
      style={[animatedStyle, style]}
      {...rest}>
      {children}
    </AnimatedPressable>
  );
}
