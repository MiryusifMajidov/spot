import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getMyProfile } from '@/lib/api';
import { notifTarget, openNotifTarget, type NotifType } from '@/lib/notifications';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

/**
 * Push notifications — the half of the notification system that was missing.
 *
 * SPOT has had `notifications`, `notify()`, per-type preferences and a
 * notification centre since schema35, and none of it ever reached a phone. Every
 * notification was a row somebody had to come back and look for: a match request
 * expired unseen, a trainer's answer sat unread for days, an approved gym claim
 * told nobody. schema61 sends the push from the database at the moment the row is
 * written; this file is what tells the database where to send it.
 *
 * Three rules it keeps:
 *   · Permission is asked ONCE, and a refusal is final until the person changes
 *     it in the OS. We never re-prompt on every launch.
 *   · The token belongs to the profile that is signed in right now. Signing out
 *     deletes it, so a borrowed phone does not keep buzzing for its last user.
 *   · Nothing here throws into a screen. Push is an enhancement; a phone that
 *     cannot register still shows every notification inside the app.
 */

/** Show a banner even while the app is open — otherwise a notification that
 *  arrives during use is silently swallowed and only appears in the centre. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** The project the token is minted for. Without it Expo cannot issue one. */
function projectId(): string | null {
  const c = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return c?.eas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId ?? null;
}

let cachedToken: string | null = null;
/* Why the last registration did not produce a token. Every caller used to throw
   the reason away (`void registerPush()`), so a device that could not be
   registered looked exactly like one that was — a settings screen full of
   switches for notifications that could never arrive. */
let lastReason: string | null = null;

/** `null` when this device is registered (or has not tried yet). */
export function pushRegistrationProblem(): string | null {
  return lastReason;
}

/**
 * Ask for permission (once), get the Expo push token, and store it against the
 * signed-in profile.
 *
 * Returns the token, or null with a reason. A null is never an error the user
 * needs to see — an emulator has no push service, and a refusal is a choice.
 */
export async function registerPush(): Promise<{ token: string | null; reason?: string }> {
  try {
    // Push is delivered by the OS to a real device; a simulator has no address.
    if (!Device.isDevice) return { token: null, reason: 'simulator' };
    if (!hasSupabaseConfig) return { token: null, reason: 'no-server' };
    lastReason = null;

    const pid = projectId();
    if (!pid) return { token: null, reason: 'no-project-id' };

    if (Platform.OS === 'android') {
      // Android 8+ refuses to show anything that is not on a channel. The name is
      // what the person sees in the system settings, so it is in Azerbaijani.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'SPOT bildirişləri',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#C6FF3D',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    // Only ask when the system says asking is still possible. Re-prompting after
    // a refusal does nothing on iOS and nags on Android.
    if (status !== 'granted' && existing.canAskAgain) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') {
      // Not a problem to report as a failure — the OS permission screen already
      // covers this, and it is a choice rather than a fault.
      return { token: null, reason: 'denied' };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    if (!token) return { token: null, reason: 'no-token' };

    const me = await getMyProfile();
    if (!me?.id) return { token: null, reason: 'no-profile' };

    /* Through the RPC, not an upsert. `push_tokens.token` is the primary key and
       `push_tokens_own` is `using (profile_id = my_profile_id())`, so ON CONFLICT
       is evaluated against the OLD row — whose owner is the phone's previous
       user — and the write was refused. schema61 documents the opposite as a
       requirement, and the failure was discarded here: somebody who took over a
       phone saw twelve notification switches, all on, and never received a
       single push, while the previous owner's messages kept arriving on it.
       `register_push_token` (schema67) moves the row. */
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
    if (error) {
      lastReason = 'not-saved';
      return { token: null, reason: 'not-saved' };
    }

    cachedToken = token;
    lastReason = null;
    return { token };
  } catch (e) {
    lastReason = 'failed';
    // Registration is best-effort by design. The in-app notification centre is
    // the record either way — but swallowing the cause entirely made a device
    // that could not register look exactly like one that did, so in development
    // the reason is at least printed.
    if (__DEV__) console.warn('[push] registration failed:', String((e as Error)?.message ?? e));
    return { token: null, reason: 'failed' };
  }
}

/** Stop delivering to this device — on sign-out, and before deleting an account. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = cachedToken ?? (await currentToken());
    if (!token || !hasSupabaseConfig) return;
    await supabase.from('push_tokens').delete().eq('token', token);
    cachedToken = null;
  } catch {
    /* If it cannot be removed now the row still dies with the account (cascade). */
  }
}

/** What the OS says about this app's permission to show notifications.
 *
 *  The settings screen needs this: a row of switches that promise «sənə bildiriş
 *  gələcək» while Android is dropping every one of them is the app claiming
 *  something it cannot do. `unavailable` covers a simulator, which has no push
 *  service at all. */
export async function pushPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  try {
    if (!Device.isDevice) return 'unavailable';
    const r = await Notifications.getPermissionsAsync();
    if (r.status === 'granted') return 'granted';
    return r.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unavailable';
  }
}

async function currentToken(): Promise<string | null> {
  try {
    const pid = projectId();
    if (!pid || !Device.isDevice) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    return data ?? null;
  } catch {
    return null;
  }
}

/** Open what a tapped push points at.
 *
 *  The payload carries the same four fields the notification row has, so this
 *  reuses `notifTarget` instead of writing a second routing table that could
 *  disagree with the first — a push and its row in the centre must open the same
 *  screen. */
export function openPush(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const type = typeof data.type === 'string' ? data.type : '';
  if (!type) return;
  openNotifTarget(
    notifTarget({
      id: typeof data.id === 'string' ? data.id : '',
      type: type as NotifType,
      actorName: null,
      actorId: typeof data.actor === 'string' ? data.actor : null,
      targetKey: typeof data.target === 'string' ? data.target : null,
      entityId: typeof data.entity === 'string' ? data.entity : null,
      read: true,
      createdAt: new Date().toISOString(),
    })
  );
}
