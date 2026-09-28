import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Platform, StatusBar, View } from 'react-native';

import { palette } from '@/theme';
import { useAppStore } from '@/store/appStore';

/**
 * The gate.
 *
 * It used to be `!onboarded && !guest → onboarding`, where `onboarded` is a flag
 * in AsyncStorage. Nothing anywhere asked who the person was — `ensureSession()`
 * mints an anonymous Supabase user before the first screen paints (api.ts:119),
 * so every install walked straight past identity and into a questionnaire.
 *
 * Three states now, and the order matters:
 *   · `guest` — they chose to look around. Straight in; the tab bar is cut down
 *     to Kəşf for them.
 *   · `onboarded` — this device knows they have an account. Straight in, with no
 *     waiting: making a returning user stare at a splash while the server is
 *     asked something this device already knows is the slow start we keep paying
 *     for on a 500 ms connection.
 *   · neither — the only case that waits. `bootstrap()` may still be finding out
 *     that this person DOES have an account (a fresh install signed in through a
 *     magic link, say), and showing them a login screen while that answer is in
 *     flight is how they end up registering a second time.
 */
export default function Index() {
  const hydrated = useAppStore((s) => s.hydrated);
  const ready = useAppStore((s) => s.ready);
  const profileChecked = useAppStore((s) => s.profileChecked);
  const onboarded = useAppStore((s) => s.onboarded);
  const guest = useAppStore((s) => s.guest);
  const activeMode = useAppStore((s) => s.activeMode);

  // The ambiguous case (neither guest nor onboarded) is the only one that waits
  // for the server; everything else waits only for the store to load.
  const waiting = !hydrated || !ready || (!guest && !onboarded && !profileChecked);

  /* The splash is black, and the root layout's <StatusBar style="dark" /> drew a
     black clock on it for as long as the server took to answer. A light entry is
     pushed only while the splash is actually on screen and popped the moment it
     turns into a redirect (or the gate loses focus), so it never outlives the
     splash and never sits over the white screen that follows. On iOS the native
     style is also set directly — same approach and reason as
     onboarding/welcome.tsx and workout/exercise.tsx. */
  useFocusEffect(
    useCallback(() => {
      if (!waiting) return;
      if (Platform.OS === 'ios') StatusBar.setBarStyle('light-content', true);
      const entry = StatusBar.pushStackEntry({ barStyle: 'light-content', animated: true });
      return () => StatusBar.popStackEntry(entry);
    }, [waiting])
  );

  if (waiting) return <View style={{ flex: 1, backgroundColor: palette.inkText }} />;

  if (!guest && !onboarded) return <Redirect href="/onboarding/welcome" />;

  /* A guest goes to the catalogue, whatever mode the device last remembered.
     «Qeydiyyatı yenidən keç» does not sign out, so a gym owner who then chose
     «Qonaq kimi bax» kept `activeMode: 'gym_admin'` and cold-started into the
     owner panel with its member list — while every other screen treated them
     as a guest. Guest mode is one tab; the panels are for accounts. */
  if (guest) return <Redirect href="/(tabs)/discover" />;
  if (activeMode === 'trainer') return <Redirect href="/trainer" />;
  if (activeMode === 'gym_admin') return <Redirect href="/gym" />;
  return <Redirect href="/(tabs)/discover" />;
}
