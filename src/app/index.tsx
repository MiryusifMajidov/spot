import { Redirect } from 'expo-router';
import { View } from 'react-native';

import { palette } from '@/theme';
import { useAppStore } from '@/store/appStore';

/** Entry gate: wait for persisted state, then route to onboarding or the app. */
export default function Index() {
  const hydrated = useAppStore((s) => s.hydrated);
  const ready = useAppStore((s) => s.ready);
  const onboarded = useAppStore((s) => s.onboarded);
  const guest = useAppStore((s) => s.guest);
  const activeMode = useAppStore((s) => s.activeMode);

  if (!hydrated || !ready) return <View style={{ flex: 1, backgroundColor: palette.inkText }} />;
  if (!onboarded && !guest) return <Redirect href="/onboarding/welcome" />;
  if (activeMode === 'trainer') return <Redirect href="/trainer" />;
  if (activeMode === 'gym_admin') return <Redirect href="/gym" />;
  return <Redirect href="/(tabs)/discover" />;
}
