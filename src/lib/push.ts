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
    if (status !== 'granted') return { token: null, reason: 'denied' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    if (!token) return { token: null, reason: 'no-token' };

    const me = await getMyProfile();
    if (!me?.id) return { token: null, reason: 'no-profile' };

    // The token is the primary key: re-registering it under this profile moves it
    // here, so a device handed to somebody else stops delivering to its old owner.
    const { error } = await supabase
      .from('push_tokens')
      .upsert({ token, profile_id: me.id, platform: Platform.OS, updated_at: new Date().toISOString() },
              { onConflict: 'token' });
    if (error) return { token: null, reason: 'not-saved' };

    cachedToken = token;
    return { token };
  } catch {
    // Registration is best-effort by design. The in-app notification centre is
    // the record either way.
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
