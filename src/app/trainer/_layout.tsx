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

export default function TrainerLayout() {
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
        tabBarActiveTintColor: palette.inkText,
        tabBarInactiveTintColor: '#A0A0A8',
        tabBarStyle: { backgroundColor: palette.white, borderTopColor: palette.separator },
        tabBarLabelStyle: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Panel', tabBarIcon: tab('grid') }} />
      <Tabs.Screen name="students" options={{ title: 'Şagirdlər', tabBarIcon: tab('users') }} />
      <Tabs.Screen name="programs" options={{ title: 'Proqramlar', tabBarIcon: tab('dumbbell') }} />
      <Tabs.Screen name="chat" options={{ title: 'Söhbət', tabBarIcon: tab('msg') }} />
      <Tabs.Screen name="verify" options={{ href: null }} />
      <Tabs.Screen name="student/[id]" options={{ href: null }} />
    </Tabs>
  );
}
