import AsyncStorage from '@react-native-async-storage/async-storage';

import { invalidateFocusCache } from '@/lib/focusFetch';
import { useAppStore } from '@/store/appStore';
import { useDb } from '@/store/db';

/**
 * Actually remove this account's data from this phone.
 *
 * The sign-out dialog has always said «Bu telefonda saxlanan məlumatlar silinir»
 * and nothing did it: `signOut()` ended the Supabase session and returned, while
 * `spot-db` (workouts, check-ins, weigh-ins, matches, chat threads, saved
 * programmes, reviews) and `spot-app` (the profile, the @username, bookmarks,
 * saved videos, follows, the gym-owner flag) stayed in AsyncStorage and in
 * memory. Whoever picked the phone up next — or the same person signing in as
 * somebody else — opened SPOT onto the previous account's training history and
 * private chats. The dialog was describing something the code never did.
 *
 * Clearing storage is not enough on its own: zustand's persist only writes
 * through, so the in-memory state would keep serving the same data until the app
 * was killed. Both stores are reset to the state they had at module load, which
 * is the same state a fresh install starts from.
 */
export async function wipeDeviceData(): Promise<void> {
  useDb.setState(INITIAL_DB, true);
  useAppStore.setState(INITIAL_APP, true);
  invalidateFocusCache();
  try {
    await Promise.all([useDb.persist.clearStorage(), useAppStore.persist.clearStorage()]);
  } catch {
    /* Best effort: the in-memory reset above has already taken the data off
       screen, and a failed clear is repaired by the next write. */
  }
  try {
    // Session drafts live outside the two stores — workout/session.tsx keeps an
    // in-progress set list under `spot-session:<program>:<day>:<title>` — and a
    // half-finished workout is exactly what the next person must not inherit.
    const keys = await AsyncStorage.getAllKeys();
    const drafts = keys.filter((k) => k.startsWith('spot-session:'));
    if (drafts.length) await AsyncStorage.multiRemove(drafts);
  } catch {
    /* nothing more we can do from here */
  }
}

/* Captured at module load, BEFORE zustand rehydrates from storage — so these are
   the values a fresh install has. They include the action functions, which is
   why `setState(..., true)` (replace) is safe. */
const INITIAL_DB = useDb.getState();
const INITIAL_APP = useAppStore.getState();
