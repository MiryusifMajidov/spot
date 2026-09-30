import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { t } from '@/lib/i18n';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';

/**
 * Parametrlər → Aktiv cihazlar.
 *
 * The rows are Supabase's own sessions (auth.sessions) — the thing a sign-out
 * actually ends — read and ended through schema93's SECURITY DEFINER functions,
 * which only ever see the caller's own. auth.sessions knows a user-agent and
 * nothing else, so each phone also reports what it is (`touchDevice`), and the
 * same call tells a phone that was signed out from another one that it has been.
 */
export type DeviceSession = {
  id: string;
  current: boolean;
  platform: 'ios' | 'android' | 'web' | 'other';
  name: string | null;
  os: string | null;
  appVersion: string | null;
  signedInAt: string;
  lastActiveAt: string;
};

type Row = {
  session_id: string;
  is_current: boolean;
  platform: string | null;
  device_name: string | null;
  os_version: string | null;
  app_version: string | null;
  user_agent: string | null;
  signed_in_at: string;
  last_active_at: string;
};

/** A session that never reported itself (an app version from before schema93,
 *  the web admin) still has a user-agent: enough to tell a phone from a browser. */
function platformFromAgent(ua: string | null): DeviceSession['platform'] {
  const s = (ua ?? '').toLowerCase();
  if (s.includes('okhttp') || s.includes('android')) return 'android';
  if (s.includes('cfnetwork') || s.includes('darwin') || s.includes('iphone') || s.includes('ipad')) return 'ios';
  if (s.includes('mozilla')) return 'web';
  return 'other';
}

function mapRow(r: Row): DeviceSession {
  const p = r.platform;
  return {
    id: r.session_id,
    current: !!r.is_current,
    platform: p === 'ios' || p === 'android' || p === 'web' || p === 'other' ? p : platformFromAgent(r.user_agent),
    name: r.device_name,
    os: r.os_version,
    appVersion: r.app_version,
    signedInAt: r.signed_in_at,
    lastActiveAt: r.last_active_at,
  };
}

/** «Samsung SM-A566E», «iPhone 15 Pro». Never `Device.deviceName`: on Android
 *  that is the name the owner gave the phone — often their own name — and it
 *  would sit in a table on a server. */
function modelLabel(): string | null {
  const model = (Device.modelName ?? '').trim();
  const maker = (Device.manufacturer ?? Device.brand ?? '').trim();
  if (!model) return maker || null;
  if (!maker || Platform.OS === 'ios' || model.toLowerCase().startsWith(maker.toLowerCase())) return model;
  return `${maker.charAt(0).toUpperCase()}${maker.slice(1)} ${model}`;
}

function osLabel(): string | null {
  const name = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : (Device.osName ?? '');
  const ver = (Device.osVersion ?? '').trim();
  return [name, ver].filter(Boolean).join(' ') || null;
}

let lastTouch = 0;
let touching: Promise<void> | null = null;

/**
 * Report this phone to its session, and find out whether the session still
 * exists. Called at launch and whenever the app comes to the foreground (at most
 * once a minute). When the session was ended from another phone the answer is
 * `false`, and this phone signs itself out locally — the session guard
 * (src/lib/sessionGuard.ts) then clears the phone and says why. Without this the
 * phone would carry on until its access token expired, up to an hour.
 *
 * Never throws: a failure here must not reach the person.
 */
export function touchDevice(force = false): Promise<void> {
  if (!hasSupabaseConfig) return Promise.resolve();
  if (touching) return touching;
  if (!force && Date.now() - lastTouch < 60_000) return Promise.resolve();
  touching = (async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) return;
      const { data, error } = await supabase.rpc('touch_my_device', {
        p_platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other',
        p_device: modelLabel(),
        p_os: osLabel(),
        p_app: Constants.expoConfig?.version ?? null,
      });
      if (error) return; // offline, or the server does not have schema93 yet
      lastTouch = Date.now();
      // Only a definite «this session is gone», and only for a linked account:
      // an anonymous one cannot be ended from anywhere else.
      if (data === false && !user.is_anonymous) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      }
    } catch {
      /* fire-and-forget */
    } finally {
      touching = null;
    }
  })();
  return touching;
}

/** This account's sessions, this phone first. */
export async function listDevices(): Promise<DeviceSession[]> {
  const { data, error } = await supabase.rpc('my_devices');
  if (error) throw error;
  return ((data ?? []) as Row[]).map(mapRow);
}

/** End one other session. The phone behind it loses its pushes at once and is
 *  signed out the next time it opens SPOT. */
export async function revokeDevice(id: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_my_session', { p_session: id });
  if (error) throw error;
}

/** End every session but this one. Returns how many were ended. */
export async function revokeOtherDevices(): Promise<number> {
  const { data, error } = await supabase.rpc('revoke_my_session', { p_session: null });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** What to call a session in the list. */
export function deviceTitle(d: DeviceSession, tr: typeof t = t): string {
  if (d.name) return d.name;
  if (d.platform === 'ios') return 'iPhone';
  if (d.platform === 'android') return tr('Android telefon');
  if (d.platform === 'web') return tr('Veb brauzer');
  return tr('Naməlum cihaz');
}
