/**
 * Real identity: Google, or a phone number with a code.
 *
 * Until now the only way into SPOT was `signInAnonymously()`, and the whole
 * account lived in one AsyncStorage key on one phone. Reinstall the app, change
 * device, or clear storage and the profile, the @username, the streak, the
 * videos and the matches were gone — not «lost», UNREACHABLE: no e-mail, no
 * phone, no password, so nobody, not even support, could ever open that account
 * again. The live database still carries the wreckage of that (files owned by
 * auth users that no longer exist).
 *
 * THE IMPORTANT PART IS THAT NOTHING IS RE-CREATED.
 * Signing in does not make a second account. The anonymous user the person is
 * already using is UPGRADED in place — `updateUser({ phone })` or
 * `linkIdentity({ provider })` — so `auth.users.id` never changes and every row
 * that FKs to their profile stays attached. Making a fresh account and copying
 * the data across would be a second identity and a second set of orphans; this
 * is the same identity, now reachable.
 *
 * NO NATIVE DEPENDENCY. Google goes through the system browser
 * (`expo-web-browser`) and comes back on the app's own `spot://` scheme
 * (`expo-linking`). Both are already installed, so this needs no rebuild.
 * The phone flow is plain supabase-js.
 *
 * WHAT MUST BE CONFIGURED ON THE SERVER (see the note in each function):
 *   · Google  — an OAuth client, and «Manual linking» enabled
 *   · Phone   — an SMS provider (Twilio and the like); every code costs money
 * Neither can be done from here, and each function says so when it is missing
 * rather than failing with a raw provider error.
 */
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

/** Where the browser sends the person back to. `scheme: 'spot'` in app.json. */
export const AUTH_REDIRECT = Linking.createURL('auth-callback');

export class AuthSetupError extends Error {
  constructor(public readonly what: 'google' | 'apple' | 'phone' | 'email') {
    super(`${what}-not-configured`);
    this.name = 'AuthSetupError';
  }
}

/**
 * Which providers the PROJECT has switched on.
 *
 * `/auth/v1/settings` is a public endpoint that answers exactly this, and asking
 * it first is the difference between an honest message and nothing happening at
 * all. Without the check, tapping «Google» built an authorize URL client-side —
 * supabase-js does not verify the provider is enabled — opened a browser that
 * bounced straight back, and the result was indistinguishable from the person
 * cancelling: no browser, no error, no explanation. Verified on the device.
 *
 * Cached for the session: it is a project setting, not per-request state. A
 * failed read returns null and the caller proceeds — a network problem must not
 * masquerade as «not configured».
 */
let providerCache: Record<string, boolean> | null = null;

export async function enabledProviders(): Promise<Record<string, boolean> | null> {
  if (providerCache) return providerCache;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!res.ok) return null;
    const json = (await res.json()) as { external?: Record<string, boolean> };
    providerCache = json.external ?? {};
    return providerCache;
  } catch {
    return null;
  }
}

/** Throws `AuthSetupError` when we KNOW the provider is off. Silent when we
 *  could not ask — an unreachable settings endpoint is not a verdict. */
async function requireProvider(name: 'google' | 'apple' | 'phone' | 'email'): Promise<void> {
  const p = await enabledProviders();
  if (p && p[name] === false) throw new AuthSetupError(name);
}

/** Is the person currently signed in as an anonymous (device-only) user? */
export async function isAnonymous(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  return !!data.user?.is_anonymous;
}

/** The identity behind the current session, for the settings screen. */
export async function currentIdentity(): Promise<{ kind: 'anonymous' | 'google' | 'apple' | 'phone' | 'email' | 'none'; label: string | null }> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return { kind: 'none', label: null };
  if (u.is_anonymous) return { kind: 'anonymous', label: null };
  if (u.phone) return { kind: 'phone', label: u.phone };
  const social = (u.identities ?? []).find((i) => i.provider === 'google' || i.provider === 'apple');
  if (social) return { kind: social.provider as 'google' | 'apple', label: u.email ?? null };
  if (u.email) return { kind: 'email', label: u.email };
  return { kind: 'anonymous', label: null };
}

// --------------------------------------------------------------------- Google
/**
 * Google, through the system browser.
 *
 * An anonymous session is LINKED (same user id, same profile). A guest with no
 * session at all signs in normally. Either way the browser hands back a URL
 * carrying the code, and that code is exchanged for the session here — the
 * client runs with `detectSessionInUrl: false`, which is correct for a native
 * app, so nothing picks it up on its own.
 */
/**
 * The social provider THIS platform offers.
 *
 * Android shows Google, iOS shows Apple — a product decision, and on iOS also
 * the simplest way to satisfy App Store guideline 4.8: an app that offers a
 * third-party login must offer an equivalent alternative, and an app whose only
 * social login IS Sign in with Apple has nothing to pair it with.
 *
 * E-mail stays on both platforms regardless. Without it an account created with
 * Google on an Android phone could never be opened on an iPhone, which is the
 * exact «account you cannot reach» problem this whole module exists to end.
 */
export const SOCIAL_PROVIDER: 'google' | 'apple' = Platform.OS === 'ios' ? 'apple' : 'google';

/** Google on Android, Apple on iOS — same browser flow, same linking rules. */
export async function signInWithSocial(): Promise<void> {
  return signInWithProvider(SOCIAL_PROVIDER);
}

export async function signInWithGoogle(): Promise<void> {
  return signInWithProvider('google');
}

async function signInWithProvider(provider: 'google' | 'apple'): Promise<void> {
  await requireProvider(provider);
  const anon = await isAnonymous();

  const start = anon
    ? await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
      })
    : await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
      });

  if (start.error) {
    const m = String(start.error.message ?? '').toLowerCase();
    // «provider is not enabled» / «manual linking is disabled» — a configuration
    // gap, not something the person did. Say which one.
    if (m.includes('not enabled') || m.includes('disabled') || m.includes('unsupported')) {
      throw new AuthSetupError(provider);
    }
    throw start.error;
  }
  if (!start.data?.url) throw new AuthSetupError(provider);

  const result = await WebBrowser.openAuthSessionAsync(start.data.url, AUTH_REDIRECT);
  if (result.type !== 'success' || !result.url) {
    // Dismissed or cancelled. Not an error — the caller says nothing.
    throw new Error('cancelled');
  }

  await completeFromUrl(result.url);
}

/** Turn the redirect URL into a session. Handles both the PKCE `code` form and
 *  the older fragment form, because which one arrives depends on the project's
 *  flow setting and we do not control it from here. */
export async function completeFromUrl(url: string): Promise<void> {
  const parsed = Linking.parse(url);
  const code = (parsed.queryParams?.code as string | undefined) ?? undefined;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const frag = new URLSearchParams(hash);
  const access_token = frag.get('access_token');
  const refresh_token = frag.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  const err = (parsed.queryParams?.error_description as string | undefined) ?? frag.get('error_description');
  throw new Error(err || 'auth-callback-empty');
}

// ---------------------------------------------------------------------- Email
/**
 * E-poçt + kod. The one path that works with no server configuration.
 *
 * The project already has the `email` provider enabled (checked against
 * /auth/v1/settings), so a code can be sent to a Gmail address today, while
 * Google OAuth and SMS are still switched off. Same shape as the phone flow: an
 * anonymous session gets the address attached to the SAME user, a guest signs
 * in fresh.
 *
 * Supabase's built-in mailer is rate-limited and meant for development. For real
 * traffic an SMTP provider has to be configured — until then this works but will
 * refuse after a handful of sends per hour, and that refusal is reported as what
 * it is rather than as a wrong address.
 */
export async function sendEmailCode(email: string): Promise<{ linking: boolean }> {
  const clean = (email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) throw new Error('bad-email');
  await requireProvider('email');

  const anon = await isAnonymous();
  /* `emailRedirectTo` is what makes the link in the e-mail come BACK into the
     app instead of dead-ending on a web page. It matters more than it looks:
     Supabase now refuses to let you edit the e-mail templates without a paid
     custom SMTP provider, so `{{ .Token }}` cannot be added and the default
     template sends a LINK and no code. The link is therefore the path that
     works with zero configuration — see `handleAuthDeepLink`. */
  const { error } = anon
    ? await supabase.auth.updateUser({ email: clean }, { emailRedirectTo: AUTH_REDIRECT })
    : await supabase.auth.signInWithOtp({
        email: clean,
        options: { shouldCreateUser: true, emailRedirectTo: AUTH_REDIRECT },
      });

  if (error) {
    const m = String(error.message ?? '').toLowerCase();
    if (m.includes('rate') || m.includes('limit') || m.includes('too many')) throw new Error('rate-limited');
    if (m.includes('not enabled') || m.includes('disabled')) throw new AuthSetupError('email');
    throw error;
  }
  return { linking: anon };
}

/** Confirm the emailed code. `email_change` when it was attached to an existing
 *  user, `email` when it is a sign-in — both are tried, for the same reason as
 *  the phone flow. */
export async function confirmEmailCode(email: string, code: string, linking: boolean): Promise<void> {
  const clean = (email ?? '').trim().toLowerCase();
  const token = (code ?? '').replace(/\D/g, '');
  if (token.length < 4) throw new Error('bad-code');

  const order: ('email_change' | 'email')[] = linking ? ['email_change', 'email'] : ['email', 'email_change'];
  let last: unknown = null;
  for (const type of order) {
    const { error } = await supabase.auth.verifyOtp({ email: clean, token, type });
    if (!error) return;
    last = error;
    const m = String((error as { message?: string }).message ?? '').toLowerCase();
    if (m.includes('expired')) break;
  }
  throw last ?? new Error('verify-failed');
}

// ---------------------------------------------------------------------- Phone
/** Digits only, with the leading +. «055 123 45 67» → «+994551234567». */
export function normalizePhone(raw: string): string | null {
  const digits = (raw ?? '').replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits.length >= 8 ? digits : null;
  // A local Azerbaijani number: 055…, 070…, 0512… → +994…
  const local = digits.replace(/^0+/, '');
  if (local.length < 9) return null;
  return `+994${local}`;
}

/**
 * Send the code.
 *
 * An anonymous session gets the number attached to the SAME user
 * (`updateUser`), which is what keeps their history. A guest signs in with
 * `signInWithOtp`, which creates the account on first verification.
 */
export async function sendPhoneCode(phone: string): Promise<{ linking: boolean }> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('bad-phone');
  await requireProvider('phone');

  const anon = await isAnonymous();
  const { error } = anon
    ? await supabase.auth.updateUser({ phone: e164 })
    : await supabase.auth.signInWithOtp({ phone: e164 });

  if (error) {
    const m = String(error.message ?? '').toLowerCase();
    // No SMS provider configured on the project — the person cannot fix that.
    if (m.includes('not enabled') || m.includes('disabled') || m.includes('provider')) {
      throw new AuthSetupError('phone');
    }
    throw error;
  }
  return { linking: anon };
}

/**
 * Verify it.
 *
 * The `type` differs between the two paths — `phone_change` when the number was
 * added to an existing user, `sms` when it is a sign-in — and the reference docs
 * are not explicit about it, so both are tried rather than guessed at. A wrong
 * type returns a token error, not a partial state, so this is safe.
 */
export async function confirmPhoneCode(phone: string, code: string, linking: boolean): Promise<void> {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error('bad-phone');
  const token = (code ?? '').replace(/\D/g, '');
  if (token.length < 4) throw new Error('bad-code');

  const order: ('phone_change' | 'sms')[] = linking ? ['phone_change', 'sms'] : ['sms', 'phone_change'];
  let last: unknown = null;
  for (const type of order) {
    const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type });
    if (!error) return;
    last = error;
    const m = String((error as { message?: string }).message ?? '').toLowerCase();
    // A genuinely wrong or expired code — trying the other type will not help.
    if (m.includes('expired') || m.includes('invalid') || m.includes('token')) break;
  }
  throw last ?? new Error('verify-failed');
}

// -------------------------------------------------------------------- sign out
/**
 * Sign out.
 *
 * Only offered once the account is reachable again: signing out of an anonymous
 * session is the same as deleting it, which is the trap the «Datanı bu cihazdan
 * sil» button used to be.
 */
export async function signOut(): Promise<void> {
  if (await isAnonymous()) throw new Error('anonymous-signout-blocked');
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ----------------------------------------------------------------- deep links
/**
 * The app was opened by a `spot://auth-callback…` URL.
 *
 * This is how e-mail sign-in finishes. Supabase's hosted mailer sends a link,
 * not a code — editing the template to add `{{ .Token }}` requires a paid custom
 * SMTP provider, which is not a reasonable thing to demand before the first
 * login works. Tapping the link opens the browser for an instant, Supabase
 * verifies the token and redirects to `spot://auth-callback`, and this turns
 * that URL into a session.
 *
 * Returns true when a session really came out of it, so the caller can say
 * «hesabın qorundu» only when it happened.
 */
export async function handleAuthDeepLink(url: string): Promise<boolean> {
  if (!url || !url.includes('auth-callback')) return false;
  // Nothing to exchange: not every deep link on this path carries credentials.
  const hasCode = url.includes('code=');
  const hasToken = url.includes('access_token=');
  if (!hasCode && !hasToken) return false;
  try {
    await completeFromUrl(url);
    return true;
  } catch {
    return false;
  }
}
