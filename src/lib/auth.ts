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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { unregisterPush } from './push';
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

/**
 * Which sign-in providers to DRAW. The server is asked once per session.
 *
 * «Apple ilə davam et» used to be drawn unconditionally. With Apple off on the
 * project, it was one of three advertised ways in and every tap on it ended in
 * «Apple girişi hələ açılmayıb» — the app knew the button was dead before
 * drawing it (this endpoint), and drew it anyway; on an iPhone it was the TOP
 * button. A provider the server says is off is not offered. `null` from the
 * endpoint means «could not ask»; then everything stays, because a bad
 * connection must not quietly remove the only way in.
 */
export function useSocialProviders(order: ('google' | 'apple')[]): ('google' | 'apple')[] {
  const [on, setOn] = useState<Record<string, boolean> | null>(providerCache);
  useEffect(() => {
    if (on) return;
    let alive = true;
    void enabledProviders().then((p) => {
      if (alive && p) setOn(p);
    });
    return () => {
      alive = false;
    };
  }, [on]);
  if (!on) return order;
  return order.filter((name) => on[name] !== false);
}

/** Throws `AuthSetupError` when we KNOW the provider is off. Silent when we
 *  could not ask — an unreachable settings endpoint is not a verdict. */
async function requireProvider(name: 'google' | 'apple' | 'phone' | 'email'): Promise<void> {
  const p = await enabledProviders();
  if (p && p[name] === false) throw new AuthSetupError(name);
}

/**
 * Is the person currently signed in as an anonymous (device-only) user?
 *
 * THROWS when it cannot tell. That matters more than it looks: this answer picks
 * between LINKING an identity to the existing account and CREATING a new one.
 * It used to read `data.user?.is_anonymous` and ignore the error, so a dropped
 * connection or a refused token refresh answered «not anonymous» — and the
 * caller then signed the person into a brand-new account, leaving their profile,
 * @username, streak, workouts and videos behind on the old one. A guess in that
 * direction costs somebody their history.
 */
export async function isAnonymous(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error('session-unknown');
  return !!data.user?.is_anonymous;
}

/**
 * What is behind the current session.
 *
 * `'none'` means «this phone has no account». `'unknown'` means «the question
 * could not be answered» — they are different facts and the screen that shows
 * them says different things.
 */
export type IdentityKind = 'anonymous' | 'google' | 'apple' | 'phone' | 'email' | 'none' | 'unknown';

/**
 * Who is behind the session, and «I could not find out» as its own answer.
 *
 * This read used to drop the error from `getUser()` on the floor and report
 * `kind: 'none'` — the same value it returns for a device that genuinely never
 * had an account. The settings screen renders nothing at all for 'none', so a
 * dropped connection or a refused token refresh took the red «Hesabını qoru»
 * row and the «hesab yalnız bu telefonda» warning away from exactly the person
 * whose account is NOT protected: the group read as «there is nothing to say
 * about your account» while the account was one reinstall from unreachable.
 *
 * `AuthSessionMissingError` is the one error that IS an answer — supabase-js
 * returns it when there is no stored session at all — so it stays 'none'.
 * Anything else (network, a rejected refresh, a 500) is un-answerable, the same
 * judgement `isAnonymous()` above makes when it throws rather than guess.
 */
export async function currentIdentity(): Promise<{ kind: IdentityKind; label: string | null }> {
  const { data, error } = await supabase.auth.getUser();
  if (error && !isAuthSessionMissingError(error)) return { kind: 'unknown', label: null };
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
/**
 * Which social button to put FIRST. Not which one to offer — both are offered on
 * both platforms now.
 *
 * Locking the choice to the platform is what made the sign-in screen unable to
 * satisfy its own promise: an Android phone showed Google and never Apple, an
 * iPhone showed Apple and never Google, so a person who opened their account
 * with Google could not get back into it from an iPhone, and vice versa. That is
 * the «account you cannot reach» problem this module exists to end, reintroduced
 * by the button layout.
 *
 * Apple still goes first on iOS: the App Store requires Sign in with Apple to be
 * offered alongside other social logins, and offering it second reads as
 * reluctance. Google goes first everywhere else because that is the account
 * almost every Android phone already has.
 */
export const SOCIAL_FIRST: 'google' | 'apple' = Platform.OS === 'ios' ? 'apple' : 'google';

/** Kept so existing callers keep working; prefer naming the provider. */
export async function signInWithSocial(): Promise<void> {
  return signInWithProvider(SOCIAL_FIRST);
}

export async function signInWithGoogle(): Promise<void> {
  return signInWithProvider('google');
}

export async function signInWithApple(): Promise<void> {
  return signInWithProvider('apple');
}

async function signInWithProvider(provider: 'google' | 'apple'): Promise<void> {
  await requireProvider(provider);
  const anon = await isAnonymous();

  const oauth = () =>
    supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
    });

  let start = anon
    ? await supabase.auth.linkIdentity({
        provider,
        options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
      })
    : await oauth();

  /* GETTING BACK IN FROM A NEW PHONE.
     On a fresh install the person is anonymous, so the branch above tries to
     LINK their Google/Apple identity to the new device-only account — and
     Supabase refuses, because that identity already belongs to the account they
     are trying to reach. Without this fallback the screen's whole promise
     («indi başqa telefondan da girə bilərsən») was impossible to keep: every
     path linked to the local anonymous user and there was none that signed in
     to an existing account. When the identity is already taken, signing IN is
     exactly the right move — the anonymous user on a fresh install has nothing
     in it to lose. */
  if (anon && start.error) {
    const m = String(start.error.message ?? '').toLowerCase();
    const taken =
      m.includes('already') || m.includes('exists') || m.includes('in use') || m.includes('registered');
    /* «Manual linking is disabled» belongs here too, and used to fall through to
       the branch below instead — which matches on the word «disabled» and told
       the person «Google girişi hələ açılmayıb». It is not a provider problem:
       the provider works, the project simply does not allow LINKING, and a plain
       sign-in was available the whole time. Linking is an optimisation (it keeps
       an anonymous session's local data); signing in is the actual goal. */
    const noLinking = m.includes('manual linking') || m.includes('linking is disabled');
    if (taken || noLinking) start = await oauth();
  }

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
  await beginAuthAttempt();

  const result = await WebBrowser.openAuthSessionAsync(start.data.url, AUTH_REDIRECT);
  if (result.type !== 'success' || !result.url) {
    // Dismissed or cancelled. Not an error — the caller says nothing.
    throw new Error('cancelled');
  }

  await completeFromUrl(result.url);
}

/* ---------------- only finish a sign-in THIS APP started ----------------
 *
 * The PKCE `code` form is safe on its own: `exchangeCodeForSession` checks the
 * verifier this device generated, so a code from anywhere else fails. The older
 * fragment form (`#access_token=…&refresh_token=…`) carries a COMPLETE session
 * and is verified by nothing — any `spot://auth-callback#access_token=…` link,
 * from a web page or a message, would silently replace the session and the app
 * would announce «Hesabın qorundu». The person would then log their workouts,
 * their weight and their chats into somebody else's account.
 *
 * So the fragment form is only accepted while a sign-in this app started is
 * still in flight. */
const ATTEMPT_KEY = 'spot-auth-attempt';
/* An hour. The e-mail path is the reason this is not minutes: the person taps
   the link when they next open their mail, long after SPOT was swiped away, so
   the flag has to survive a cold start — which is also why it lives in storage
   rather than in a module variable. */
const ATTEMPT_TTL_MS = 60 * 60 * 1000;

export async function beginAuthAttempt(): Promise<void> {
  try {
    await AsyncStorage.setItem(ATTEMPT_KEY, String(Date.now()));
  } catch {
    /* Storage refused. The PKCE path still works; only the fragment path,
       which needs this proof, will refuse — and refusing is the safe side. */
  }
}

async function attemptIsLive(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ATTEMPT_KEY);
    const at = raw ? Number(raw) : 0;
    return at > 0 && Date.now() - at < ATTEMPT_TTL_MS;
  } catch {
    return false;
  }
}

async function endAuthAttempt(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ATTEMPT_KEY);
  } catch {
    /* nothing to do */
  }
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
    if (!(await attemptIsLive())) throw new Error('unsolicited-callback');
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    await endAuthAttempt(); // one callback per attempt
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
  const otp = () =>
    supabase.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true, emailRedirectTo: AUTH_REDIRECT },
    });

  let linking = anon;
  let { error } = anon
    ? await supabase.auth.updateUser({ email: clean }, { emailRedirectTo: AUTH_REDIRECT })
    : await otp();

  /* Same fallback as the social path: attaching an address that already belongs
     to an account is refused, and on a new phone that is exactly the address the
     person is trying to come back through. */
  if (anon && error) {
    const m = String(error.message ?? '').toLowerCase();
    if (m.includes('already') || m.includes('exists') || m.includes('registered') || m.includes('in use')) {
      ({ error } = await otp());
      linking = false;
    }
  }

  if (error) {
    const m = String(error.message ?? '').toLowerCase();
    if (m.includes('rate') || m.includes('limit') || m.includes('too many')) throw new Error('rate-limited');
    if (m.includes('not enabled') || m.includes('disabled')) throw new AuthSetupError('email');
    throw error;
  }
  await beginAuthAttempt();
  return { linking };
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

/* Sign-in by phone number used to live here — `normalizePhone`, `sendPhoneCode`,
   `confirmPhoneCode`. It is gone. It was the only channel that cost money per
   attempt (an SMS provider bills every code, including the ones people mistype),
   the only one that needed a provider SPOT does not control, and the slowest to
   get through for the person in front of the screen. Apple on iOS, Google on
   Android, and e-poçt as the way back in cover every case it covered.

   `IdentityKind` still knows about 'phone': an account opened before today may
   already carry a linked number, and the settings screen has to name that
   identity truthfully rather than call it something it is not. */

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
  // Drop this device's push address FIRST, while the session still exists to
  // authorise the delete. Otherwise the phone keeps buzzing for an account
  // nobody on it is signed into any more.
  await unregisterPush();
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
/**
 * What happened to a sign-in link.
 *
 * Three answers, not two. It used to return a boolean, and `false` meant both
 * «this was not a sign-in link» and «the sign-in link failed» — so an expired
 * link, or one Gmail's scanner had already opened, did nothing at all: no
 * toast, no error, the screen still saying «linkə toxun», and the person
 * tapping the same dead link over and over.
 */
export type AuthLinkResult = 'none' | 'ok' | 'failed';

export async function handleAuthDeepLink(url: string): Promise<AuthLinkResult> {
  if (!url || !url.includes('auth-callback')) return 'none';
  // The provider reports its own failures in the link itself (an expired or
  // already-used token comes back as `error=…`), so that is a failure too.
  if (url.includes('error=') || url.includes('error_code=')) return 'failed';
  const hasCode = url.includes('code=');
  const hasToken = url.includes('access_token=');
  if (!hasCode && !hasToken) return 'none';
  try {
    await completeFromUrl(url);
    return 'ok';
  } catch {
    return 'failed';
  }
}
