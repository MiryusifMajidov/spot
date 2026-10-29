import { Tabs } from 'expo-router';

import { SpotTabBar } from '@/components/SpotTabBar';
import { useIsGuest } from '@/lib/authGate';

/**
 * The app's tabs, drawn by `SpotTabBar` — the design's icon-only capsule.
 *
 * This replaced NativeTabs (the platform's own bar) for the October 2026 design:
 * the capsule, the filled active glyph on its #F2F2F2 pill and Tabler's outline icons
 * are not things the native bars can draw — iOS 26 paints its own Liquid Glass and
 * Android a Material bar with labels.
 *
 * The bar takes a row of its own under the scene (see SpotTabBar), so screens end
 * above it on BOTH platforms. The `Platform.OS === 'ios' ? insets.bottom : 0`
 * clearance that iOS 26's floating glass bar used to need is gone from the tab
 * screens — adding it now would leave an empty band above the capsule.
 *
 * A guest sees ONE tab. Browsing without an account is a catalogue: which gyms are
 * in the city and which coaches work in them. Məşq, Check-in, Feed and Profil all
 * need an identity to mean anything — a workout history belongs to somebody, a video
 * is posted by somebody. `href: null` hides a tab from the bar without removing the
 * route, so signing in simply brings the other four in.
 *
 * Five tabs, not the design's four: the owner kept Check-in, the one action a person
 * performs standing in the doorway of a gym, one tap from anywhere.
 */
export default function TabsLayout() {
  const guest = useIsGuest();
  const hidden = guest ? { href: null } : {};
  return (
    <Tabs
      tabBar={(props) => <SpotTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        // Android: with the keyboard up the bar would ride on top of it.
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen name="discover" />
      <Tabs.Screen name="workout" options={hidden} />
      <Tabs.Screen name="checkin" options={hidden} />
      <Tabs.Screen name="feed" options={hidden} />
      <Tabs.Screen name="profile" options={hidden} />
    </Tabs>
  );
}
