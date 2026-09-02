import { useEffect, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';

/**
 * How many pixels of the window the software keyboard currently covers. 0 when closed.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * From Expo SDK 54 Android apps are edge-to-edge by default, and there `adjustResize`
 * does NOT shrink the window when the IME opens — the app is merely told about it. So
 * nothing moves on its own: a `ScrollView` never gains scroll range, a pinned footer
 * stays pinned under the keyboard, and `KeyboardAvoidingView` has no resize to react to
 * (its `behavior` is deliberately left undefined on Android for that reason). Every
 * screen with a text field has to lift itself, and to lift it needs this number.
 *
 * WHY `screenY` AND NEVER `endCoordinates.height`
 * -----------------------------------------------
 * `endCoordinates.height` counts different things on different Android versions once
 * edge-to-edge is on — sometimes the navigation bar, sometimes the IME's suggestion
 * toolbar — so lifting by it leaves the field either clipped or floating over a gap.
 * The OVERLAP is unambiguous: the keyboard's top edge in screen coordinates
 * (`endCoordinates.screenY`) subtracted from the window height is exactly the strip of
 * window the keyboard sits on top of.
 *
 * `keyboardDidShow` / `keyboardDidHide` — Android never fires the `Will` variants.
 *
 * This returns the RAW overlap against the window. A container whose bottom edge already
 * sits above the window bottom (a safe-area `bottom` edge, or a tab scene that stops
 * above the native tab bar) has that much clearance already and should lift by
 * `overlap - reserved` — that subtraction lives in `useKeyboardLift` in
 * `@/components/ui/KeyboardLift`, so nobody has to redo this maths.
 */
export function useKeyboardOverlap(): number {
  const { height } = useWindowDimensions();
  /* The keyboard's top edge as last reported. Kept so a window resize (rotation, split
     screen, the navigation bar changing mode) can recompute the overlap without waiting
     for another keyboard event that is never going to come. */
  const screenY = useRef<number | null>(null);
  const [overlap, setOverlap] = useState(() => {
    const m = Keyboard.metrics?.();
    if (!m) return 0;
    screenY.current = m.screenY;
    return Math.max(0, Math.round(height - m.screenY));
  });

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      screenY.current = e.endCoordinates.screenY;
      setOverlap(Math.max(0, Math.round(height - e.endCoordinates.screenY)));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      screenY.current = null;
      setOverlap(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [height]);

  // Re-measure against the new window height; the keyboard will not re-announce itself.
  useEffect(() => {
    if (screenY.current === null) return;
    setOverlap(Math.max(0, Math.round(height - screenY.current)));
  }, [height]);

  return overlap;
}
