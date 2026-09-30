import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

/**
 * «Your account was signed out on this phone from another one.»
 *
 * Parametrlər → Aktiv cihazlar can end this phone's session from a different
 * phone (schema93 revoke_my_session). Nothing here noticed: supabase-js drops
 * the session once its refresh is refused, emits SIGNED_OUT, and the app went on
 * showing the previous account's workouts and chats from the local stores. On
 * the next launch it was worse — no stored session, so `ensureSession()` minted a
 * brand-new anonymous user and the old account's local data carried on under it.
 *
 * So the guard remembers, in its own key, that this phone holds a LINKED
 * account. A session that disappears without the app having asked for it (the
 * sign-out and delete flows call `expectSignOut()` first) is then an ending, and
 * `onEnded` clears the phone and returns to the welcome screen. Only for linked
 * accounts: an anonymous one cannot be listed or revoked from elsewhere, and its
 * data exists nowhere but here — wiping it would lose it for good.
 */
const KEY = 'spot-linked-session';

let expected = false;
let handling = false;
let installed = false;

/** The next sign-out is the app's own (Hesabdan çıx, Hesabı sil) — not an ending. */
export function expectSignOut() {
  expected = true;
  void AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Did this phone hold a linked account whose session is now gone?
 *  `ensureSession()` asks before it mints an anonymous user.
 *
 *  «Gone» is read from storage, not from getSession(). auth-js reports a
 *  session-less INITIAL_SESSION — and getSession() answers null — for a refresh
 *  that failed only because the phone is offline, while it keeps the token
 *  stored. It deletes the stored token (`sb-<ref>-auth-token`) only when the
 *  session is really dead (`_removeSession`), so that key is the one answer that
 *  cannot turn a tunnel or a flight into a wiped phone. */
export async function linkedSessionEnded(): Promise<boolean> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    if (!keys.includes(KEY)) return false;
    return !keys.some((k) => /^sb-.+-auth-token$/.test(k));
  } catch {
    return false; // cannot tell — never wipe on a guess
  }
}

export function installSessionGuard(onEnded: () => void | Promise<void>): () => void {
  if (installed) return () => {};
  installed = true;

  const check = async () => {
    if (handling) return;
    if (!(await linkedSessionEnded())) return;
    handling = true;
    try {
      await AsyncStorage.removeItem(KEY);
      await onEnded();
    } finally {
      handling = false;
    }
  };

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user;
    if (user) {
      expected = false;
      if (user.is_anonymous) void AsyncStorage.removeItem(KEY).catch(() => {});
      else void AsyncStorage.setItem(KEY, '1').catch(() => {});
      return;
    }
    if (event !== 'SIGNED_OUT' && event !== 'INITIAL_SESSION') return;
    if (expected) {
      expected = false;
      return;
    }
    // Outside the callback: supabase-js holds its auth lock while it runs, and
    // getSession() inside it would wait on that same lock.
    setTimeout(() => void check(), 0);
  });

  return () => {
    installed = false;
    data.subscription.unsubscribe();
  };
}
