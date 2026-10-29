import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { tapFeedback } from '@/lib/feedback';
import { useT } from '@/lib/useT';
import { iconSize, palette } from '@/theme';

/**
 * The tab bar — the design's «Tab bar (yekun)».
 *
 * An icon-only capsule: #FEFEFE, radius 31, padding 6, 14 pt in from the screen
 * edges, no shadow. Each tab is a 50 pt cell; the active one sits on a #F2F2F2 pill
 * with Tabler's FILLED glyph in #527A01, the rest are outline glyphs in #888888. No
 * text labels — each cell carries its tab's name for screen readers.
 *
 * It sits IN the layout, not floating over it. A floating pill was tried before
 * (git history: `SpotTabBar`) and dropped because every screen then had to subtract
 * its footprint by hand — the video, its scrubber and the comments composer ended up
 * under it. Here the bar takes its own row under the scene, the way the design draws
 * it (`flex: none` under the content), so a screen simply ends above it. The band
 * around the capsule is painted in the screen's own background colour, so the
 * capsule still reads as floating.
 *
 * The owner kept five tabs (the design has four): Check-in stays, between Məşq and
 * Feed. Tabler has no filled «scan», so the active Check-in glyph is the outline one
 * in the active colour, on the same pill.
 */
const TABS: Record<string, { icon: IconName; active: IconName; label: string }> = {
  discover: { icon: 'home', active: 'homeFill', label: 'Kəşf' },
  workout: { icon: 'dumbbell', active: 'dumbbellFill', label: 'Məşq' },
  checkin: { icon: 'qr', active: 'qr', label: 'Check-in' },
  feed: { icon: 'play', active: 'playFill', label: 'Feed' },
  profile: { icon: 'user', active: 'userFill', label: 'Profil' },
};

/* The band around the capsule takes the background of the screen in front. That is
   #F7F7F7 everywhere except the video feed, which is ink — and only its video page:
   the Zalım page beside it in the same tab, and the creator page pushed over it, are
   light. So the screen says it, not the tab: VideoFeed calls `setTabBand('feed', ink)`
   while it is the page in front and clears it when it is not. The colour is kept per
   tab, so switching away from Feed paints the next tab's band in the same frame,
   before the feed's blur effect has run. */
const bands: Record<string, string | null> = {};
const listeners = new Set<() => void>();
export function setTabBand(tab: string, color: string | null) {
  if ((bands[tab] ?? null) === color) return;
  bands[tab] = color;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
function useBand(tab: string) {
  return useSyncExternalStore(subscribe, () => bands[tab] ?? null) ?? palette.grouped;
}

export function SpotTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const t = useT();
  const focused = state.routes[state.index]?.name ?? '';
  const band = useBand(focused);
  return (
    <View style={[styles.band, { backgroundColor: band, paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.capsule} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const spec = TABS[route.name];
          const { options } = descriptors[route.key];
          // Hidden tabs (a guest sees only Kəşf) are declared with `href: null`.
          if (!spec || (options as { href?: unknown }).href === null) return null;
          const isFocused = state.index === index;
          const onPress = () => {
            tapFeedback();
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={t(spec.label)}
              style={[styles.cell, isFocused && styles.cellActive]}>
              <Icon
                name={isFocused ? spec.active : spec.icon}
                size={iconSize.tab}
                color={isFocused ? palette.tabActive : palette.tertiary}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { paddingHorizontal: 14, paddingTop: 6 },
  capsule: { flexDirection: 'row', alignItems: 'center', padding: 6, gap: 4, backgroundColor: palette.white, borderRadius: 31 },
  cell: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  cellActive: { backgroundColor: palette.tabPill },
});
