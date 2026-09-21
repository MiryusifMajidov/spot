import { Redirect, Tabs } from 'expo-router';
import { ColorValue } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

function tab(name: IconName) {
  // A named declaration rather than a bare arrow: the tab bar renders this as a
  // component, and an anonymous component has no name anywhere it matters — in
  // React DevTools, in a component stack, in a warning about the icon.
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={24} color={color as string} />;
  }
  return TabIcon;
}

export default function GymLayout() {
  const hydrated = useAppStore((s) => s.hydrated);
  const ownsGym = useAppStore((s) => s.ownsGym);

  /* The same guard the trainer panel has always had. This one had none, so
     `spot://gym` — or a persisted «gym_admin» mode left behind after the gym
     row was gone — drew the owner's four tabs for anybody, each one saying
     «Zal tapılmadı» over a «Zalı qeydiyyata al» button that skipped the
     guest/profile check the real entry point applies. Every legitimate way in
     (create-gym, the account switcher) sets `ownsGym` before navigating here. */
  if (!hydrated) return null;
  if (!ownsGym) return <Redirect href="/(tabs)/discover" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.inkText,
        tabBarInactiveTintColor: '#A0A0A8',
        tabBarStyle: { backgroundColor: palette.white, borderTopColor: palette.separator },
        tabBarLabelStyle: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Panel', tabBarIcon: tab('grid') }} />
      <Tabs.Screen name="members" options={{ title: 'Üzvlər', tabBarIcon: tab('users') }} />
      <Tabs.Screen name="classes" options={{ title: 'Cədvəl', tabBarIcon: tab('cal') }} />
      <Tabs.Screen name="reviews" options={{ title: 'Rəylər', tabBarIcon: tab('star') }} />
      <Tabs.Screen name="edit" options={{ href: null }} />
      <Tabs.Screen name="claim" options={{ href: null }} />
      <Tabs.Screen name="qr" options={{ href: null }} />
      <Tabs.Screen name="pass" options={{ href: null }} />
    </Tabs>
  );
}
