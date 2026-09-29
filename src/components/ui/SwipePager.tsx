import { Children, createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, View } from 'react-native';
import Animated, { SharedValue, useAnimatedRef, useAnimatedScrollHandler } from 'react-native-reanimated';

/**
 * Side-by-side pages you move between with a finger — Kəşf's Zallar / Müəllimlər /
 * Yoldaşlar, the feed's Zalım / Videolar.
 *
 * Those used to be one screen whose CONTENT was swapped by a tap on a segment (and,
 * in the feed, by a fling that swapped it just as abruptly), so a sideways swipe
 * either did nothing or jumped. Here every page really sits next to the other: the
 * page follows the finger, snaps like a native pager, and the segment's thumb moves
 * WITH the finger (`progress`, a page position 0 … n-1 updated on the UI thread).
 *
 * A native paging ScrollView, not a JS gesture: vertical lists inside the pages keep
 * their own native scrolling and the axis lock is the platform's.
 *
 * A control inside a page that drags sideways itself (the video scrubber) holds the
 * pager still through `usePagerLock()` while the finger is on it.
 */

const PagerLock = createContext<((locked: boolean) => void) | null>(null);

/** For a sideways-dragging control inside a page: call with true on touch start and
 *  false on release, so the drag moves the control and not the page. No-op outside
 *  a pager. */
export function usePagerLock(): (locked: boolean) => void {
  return useContext(PagerLock) ?? noop;
}
const noop = () => {};

type Props = {
  /** The page to show. Changing it scrolls there (a tap on the segment). */
  index: number;
  /** A swipe landed on another page. */
  onIndexChange: (index: number) => void;
  /** Written on every scroll frame: the page position as a float. */
  progress?: SharedValue<number>;
  /** The finger started moving the pager — a chance to mount a lazy neighbour. */
  onDragStart?: () => void;
  children: ReactNode;
};

export function SwipePager({ index, onIndexChange, progress, onDragStart, children }: Props) {
  const pages = Children.toArray(children);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [locked, setLocked] = useState(false);
  const ref = useAnimatedRef<Animated.ScrollView>();
  const w = size?.w ?? 0;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
  };

  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        if (progress && w > 0) progress.set(e.contentOffset.x / w);
      },
    },
    [w, progress]
  );

  /* A tap on the segment moves the pages; a swipe that already put them there is a
     no-op because the offset is already right. */
  useEffect(() => {
    if (w > 0) ref.current?.scrollTo({ x: index * w, animated: true });
  }, [index, w, ref]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (w <= 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / w);
    if (i !== index && i >= 0 && i < pages.length) onIndexChange(i);
  };

  const lock = useMemo(() => (on: boolean) => setLocked(on), []);

  return (
    <PagerLock.Provider value={lock}>
      <View style={{ flex: 1 }} onLayout={onLayout}>
        {size ? (
          <Animated.ScrollView
            ref={ref}
            horizontal
            pagingEnabled
            scrollEnabled={!locked}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            directionalLockEnabled
            keyboardShouldPersistTaps="handled"
            contentOffset={{ x: index * size.w, y: 0 }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onScrollBeginDrag={onDragStart}
            onMomentumScrollEnd={settle}>
            {pages.map((page, i) => (
              <View key={i} style={{ width: size.w, height: size.h }}>
                {page}
              </View>
            ))}
          </Animated.ScrollView>
        ) : null}
      </View>
    </PagerLock.Provider>
  );
}
