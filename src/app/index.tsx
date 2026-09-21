import { Redirect } from 'expo-router';
import { View } from 'react-native';

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

  const splash = <View style={{ flex: 1, backgroundColor: palette.inkText }} />;

  if (!hydrated || !ready) return splash;

  if (!guest && !onboarded) {
    // The ambiguous case, and the only one that waits for the server.
    if (!profileChecked) return splash;
    return <Redirect href="/onboarding/welcome" />;
  }

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
