import { ReactNode } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';

/**
 * How far a bottom-anchored element has to rise so the keyboard is not on top of it.
 *
 * `useKeyboardOverlap()` measures the keyboard against the WINDOW. Almost every surface
 * in this app already stops short of the window bottom — `Screen` with a `bottom` edge
 * pads the navigation-bar inset, and a tab scene stops above the strip the native tab bar
 * reserves — and the keyboard covers that strip first. So only what it takes ON TOP of
 * that clearance has to be given back; lifting by the raw overlap floats the content one
 * navigation bar too high.
 *
 * `reserved` overrides the clearance for the rare container that really does reach the
 * window bottom (pass 0 there). `extra` is pure breathing room above the keyboard and is
 * only applied while the keyboard is actually open.
 */
export function useKeyboardLift(extra = 0, reserved?: number): number {
  const overlap = useKeyboardOverlap();
  const insets = useSafeAreaInsets();
  if (overlap <= 0) return 0;
  return Math.max(0, overlap - (reserved ?? insets.bottom)) + extra;
}

/**
 * Lifts its children clear of the software keyboard.
 *
 * The lift is applied as `marginBottom`, not a transform, for two reasons: it keeps
 * working on an absolutely positioned child (`bottom: 0` + margin still resolves), and —
 * the point of the exercise — it is a LAYOUT change, so a sibling `ScrollView` above it
 * genuinely shrinks and gains the scroll range it needs for the field being typed into.
 * A transform would slide the element over its neighbours and leave the scroller as
 * unreachable as it was.
 *
 * Nothing is animated: the value lands with the keyboard's own `didShow`, and animating
 * a layout margin on top of that reads as lag rather than polish.
 *
 * ```tsx
 * <KeyboardLift extra={8}>
 *   <Button title="Davam et" onPress={next} full />
 * </KeyboardLift>
 * ```
 *
 * `style` is applied first, so put layout (`flex: 1`, padding) there — the lift always
 * wins over any `marginBottom` it may carry. Use `extra` for resting breathing room.
 */
export function KeyboardLift({
  children,
  extra = 0,
  reserved,
  style,
}: {
  children: ReactNode;
  /** Breathing room above the keyboard, added only while it is open. */
  extra?: number;
  /** Clearance that already exists below this element. Defaults to the bottom inset. */
  reserved?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const lift = useKeyboardLift(extra, reserved);
  return <View style={[style, { marginBottom: lift }]}>{children}</View>;
}
