import { Redirect } from 'expo-router';
import { ComponentType } from 'react';

import { useIsGuest } from '@/lib/authGate';

/**
 * A screen that shows REAL PEOPLE — partner cards, a member's profile, the
 * weekly matches — is not a guest's to open.
 *
 * Kəşf never offers these to a guest, but hiding the button is not the same as
 * closing the door: a pasted link, a push payload or a stale back-stack still
 * landed a person who had not registered on another member's name, age, bio and
 * compatibility. Guest mode is the gym list and the trainer list, and that is a
 * promise about what can be REACHED, not only what is drawn.
 *
 * A wrapper rather than an early return inside each screen: those screens are
 * large, hook-heavy components, and a guard placed after their hooks is how an
 * early return quietly changes hook order between renders.
 */
export function memberOnly<P extends object>(Screen: ComponentType<P>) {
  function MemberOnly(props: P) {
    const guest = useIsGuest();
    if (guest) return <Redirect href="/(tabs)/discover" />;
    return <Screen {...props} />;
  }
  MemberOnly.displayName = `memberOnly(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return MemberOnly;
}
