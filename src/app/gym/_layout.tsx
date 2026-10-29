import { Redirect, Stack } from 'expo-router';

import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

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

  /* No tab bar any more: the phone keeps a mini panel (index) and the three
     things it opens — the day-pass check, the check-in code and the ownership
     claim. Schedule, members, reviews and the gym profile are in the web gym
     panel (web/gym). */
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.grouped } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="pass" />
      <Stack.Screen name="qr" />
      <Stack.Screen name="claim" />
    </Stack>
  );
}
