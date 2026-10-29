import { Redirect, Tabs } from 'expo-router';
import { ColorValue } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { iconSize, palette } from '@/theme';

function tab(name: IconName) {
  // A named declaration rather than a bare arrow: the tab bar renders this as a
  // component, and an anonymous component has no name anywhere it matters — in
  // React DevTools, in a component stack, in a warning about the icon.
  function TabIcon({ color }: { color: ColorValue }) {
    return <Icon name={name} size={iconSize.tab} color={color as string} />;
  }
  return TabIcon;
}

export default function TrainerLayout() {
  const t = useT();
  const hydrated = useAppStore((s) => s.hydrated);
  const role = useAppStore((s) => s.profile.role);

  // Wait for the persisted profile before deciding — otherwise a cold start
  // would bounce a real trainer out of their own panel.
  if (!hydrated) return null;
  // Role guard: the trainer panel belongs to trainers only. A deep link or a
  // stale navigation state must not open it for a regular user.
  if (role !== 'trainer') return <Redirect href="/(tabs)/discover" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        /* The app's tab bar colours (README «Tab bar (yekun)»): the active tab is
           accent green, the others #888888 — still well clear of the old #A0A0A8,
           which was ~2.6:1 on white and could hardly be read. 11 pt labels, not 10. */
        tabBarActiveTintColor: palette.tabActive,
        tabBarInactiveTintColor: palette.tertiary,
        /* A plain #FEFEFE bar: no hairline on top and no shadow («Kölgə qaydası») —
           the bar sits apart from the #F7F7F7 screen by colour alone. The JS tab
           bar draws a top hairline and an Android elevation of 8 by default. */
        tabBarStyle: { backgroundColor: palette.white, borderTopWidth: 0, elevation: 0, shadowOpacity: 0 },
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
      }}>
      <Tabs.Screen name="index" options={{ title: t('Panel'), tabBarIcon: tab('grid') }} />
      <Tabs.Screen name="students" options={{ title: t('Şagirdlər'), tabBarIcon: tab('users') }} />
      <Tabs.Screen name="programs" options={{ title: t('Proqramlar'), tabBarIcon: tab('dumbbell') }} />
      <Tabs.Screen name="chat" options={{ title: t('Söhbət'), tabBarIcon: tab('msg') }} />
      <Tabs.Screen name="verify" options={{ href: null }} />
      <Tabs.Screen name="student/[id]" options={{ href: null }} />
    </Tabs>
  );
}
