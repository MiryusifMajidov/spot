import { ReactNode, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/**
 * Tab CONTENT you can swipe sideways — for tabs that live inside a longer page
 * (the gym page's Haqqında / Müəllimlər / Üzvlər / Rəylər), where a pager does not
 * fit: its pages would all need one height, and these tabs are a paragraph on one
 * side and a list of reviews on the other.
 *
 * The content follows the finger, rubber-bands at the first and the last tab, and a
 * swipe past a third of the width (or a quick flick) carries it off the side while
 * the next tab slides in from the other — a tap on the segment slides the same way,
 * so the two ways of changing tab feel like one. `progress` (tab position as a
 * float) lets the segment's thumb follow the finger too.
 *
 * Vertical movement is left alone (failOffsetY): the page around it still scrolls.
 */
type Props = {
  index: number;
  count: number;
  onIndexChange: (index: number) => void;
  progress?: SharedValue<number>;
  children: ReactNode;
};

export function SwipeSwitch({ index, count, onIndexChange, progress, children }: Props) {
  const [w, setW] = useState(0);
  const tx = useSharedValue(0);
  const prev = useRef(index);

  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width !== w) setW(width);
  };

  /* The new tab comes in from the side it lies on: from the right when moving
     forward, from the left when going back. After a swipe the old content has just
     left in the opposite direction, so this reads as one continuous slide. */
  useEffect(() => {
    const dir = Math.sign(index - prev.current);
    prev.current = index;
    if (!dir || w <= 0) {
      progress?.set(index);
      return;
    }
    tx.set(dir * w * 0.35);
    tx.set(withTiming(0, { duration: 180 }));
    progress?.set(withTiming(index, { duration: 180 }));
  }, [index, w, tx, progress]);

  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const atEdge = (e.translationX > 0 && index === 0) || (e.translationX < 0 && index === count - 1);
      const x = atEdge ? e.translationX * 0.25 : e.translationX;
      tx.set(x);
      if (progress && w > 0) progress.set(index - x / w);
    })
    .onEnd((e) => {
      const dir = e.translationX < 0 ? 1 : -1;
      const next = index + dir;
      const far = Math.abs(e.translationX) > w / 3 || Math.abs(e.velocityX) > 700;
      if (far && next >= 0 && next < count && w > 0) {
        tx.set(
          withTiming(-dir * w * 0.35, { duration: 120 }, (done) => {
            if (done) runOnJS(onIndexChange)(next);
          })
        );
      } else {
        tx.set(withSpring(0, { damping: 20, stiffness: 240 }));
        if (progress) progress.set(withSpring(index, { damping: 20, stiffness: 240 }));
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
    opacity: w > 0 ? 1 - Math.min(0.35, Math.abs(tx.value) / w) : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View onLayout={onLayout} style={style}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
