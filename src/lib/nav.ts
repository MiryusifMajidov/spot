import { router, type useNavigationContainerRef } from 'expo-router';

import { useAppStore } from '@/store/appStore';

/**
 * Leaving the sign-in flow — and switching accounts — RESETS the root navigator.
 *
 * Every exit used to be a `router.replace`, which swaps only the screen it is
 * called from. The e-mail path is welcome → push sign-in → replace → Kəşf, so the
 * welcome screen stayed at the bottom of the root stack for the rest of the
 * session. A later `replace` from the account switcher, or Android's back button
 * at the root of a tab, then surfaced it: a signed-in person landed on «Tək məşq
 * etmə» and only got back by pressing back. After a reset the history holds the
 * one screen the person is on, so there is no login screen behind it to reach.
 */
type RootRef = ReturnType<typeof useNavigationContainerRef>;
let root: RootRef | null = null;

/** Called once by the root layout with the navigation container. */
export function bindRootNavigation(ref: RootRef) {
  root = ref;
}

export type Home = 'user' | 'trainer' | 'gym_admin';

/* The first screen of each navigator is named explicitly: `onboarding` declares
   no screen order, so a bare reset could open its first file alphabetically
   (the profile form) instead of the welcome screen. */
const ROUTE: Record<Home, [string, string]> = { user: ['(tabs)', 'discover'], trainer: ['trainer', 'index'], gym_admin: ['gym', 'index'] };
const HREF: Record<Home, string> = { user: '/(tabs)/discover', trainer: '/trainer', gym_admin: '/gym' };

/** Where this person's app starts: a panel only if they still hold that account. */
export function homeFor(): Home {
  const { guest, activeMode, ownsGym, profile } = useAppStore.getState();
  if (guest) return 'user';
  if (activeMode === 'trainer' && profile.role === 'trainer') return 'trainer';
  if (activeMode === 'gym_admin' && ownsGym) return 'gym_admin';
  return 'user';
}

function resetRoot([name, screen]: [string, string], fallbackHref: string) {
  if (root?.isReady()) {
    root.reset({ index: 0, routes: [{ name: name as never, state: { index: 0, routes: [{ name: screen }] } as never }] });
    return;
  }
  // Not mounted yet (a cold start still on the gate): the gate routes from state.
  (router.replace as (h: string) => void)(fallbackHref);
}

/** Into the app, with nothing behind it. `to` defaults to the person's home. */
export function enterApp(to: Home = homeFor()) {
  resetRoot(ROUTE[to], HREF[to]);
}

/** Out to the welcome screen (signed out, wiped, deleted), with nothing behind it. */
export function exitToWelcome() {
  resetRoot(['onboarding', 'welcome'], '/onboarding/welcome');
}
