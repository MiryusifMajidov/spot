import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/ui/AppErrorBoundary';
import { UiHost } from '@/components/ui/UiHost';
import { loadDictionaries } from '@/i18n';
import { touchDevice } from '@/lib/devices';
import { openPush, registerPush } from '@/lib/push';
import { applyWorkoutReminder } from '@/lib/reminders';
import { installSessionGuard } from '@/lib/sessionGuard';
import { configureVideoCache } from '@/lib/videoCache';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { wipeDeviceData } from '@/lib/wipe';
import { palette } from '@/theme';

/* At module scope, not in an effect: the dictionaries must be in place before
   the first render, or a Russian speaker sees a frame of Azerbaijani on every
   cold start. It is a plain object merge — nothing async, nothing to await. */
loadDictionaries();

export default function RootLayout() {
  const t = useT();
  const bootstrap = useAppStore((s) => s.bootstrap);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  useEffect(() => {
    console.log('[fonts]', 'loaded=', fontsLoaded, 'error=', fontError ? String(fontError) : 'none');
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Before the first player exists (the feed builds its players after the tab
  // transition) — see src/lib/videoCache.ts.
  useEffect(() => {
    configureVideoCache();
  }, []);

  /* Signed out of this phone from another one (Parametrlər → Aktiv cihazlar).
     The same thing «Hesabdan çıx» does here — the phone is cleared, the welcome
     screen comes back — plus the reason, so it does not look like a crash or a
     lost account. `touchDevice` on every return to the foreground is what makes
     it prompt: the access token alone would keep working for up to an hour. */
  useEffect(() => {
    const stop = installSessionGuard(async () => {
      await wipeDeviceData();
      try {
        router.replace('/onboarding/welcome');
      } catch {
        /* Not mounted yet (cold start): the index gate sends a wiped phone there. */
      }
      toast(t('Bu telefonda hesabından çıxarıldın. Yenidən daxil ola bilərsən.'), 'info');
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void touchDevice();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [t]);

  /* E-poçt girişi src/app/auth-callback.tsx-də bitir.
     The link lands on that route now. This effect used to exchange the token
     here as well, and it could not route anywhere (it runs before the
     navigator is guaranteed to be mounted) — so the person saw +not-found under
     a success toast. A PKCE code is single-use, so exactly one place may spend
     it; that place is the screen the link actually opens. */


  /* Push notifications.
     `notify()` has written notification rows since schema35 and none of them
     ever reached a phone that was not already open on the right screen — a match
     request expired unseen, a trainer's answer waited days. schema61 sends the
     push; this registers the address it goes to.

     It runs only once the person is through onboarding: a permission dialog on
     the very first screen, before they know what SPOT is, is the one moment they
     are most likely to refuse — and on iOS a refusal cannot be asked about again.
     The result is deliberately ignored: an emulator has no push service and a
     refusal is a choice, neither being something to interrupt anyone with. */
  const onboarded = useAppStore((s) => s.onboarded);
  useEffect(() => {
    if (onboarded) void registerPush();
  }, [onboarded]);

  /* The weekly workout reminder (Parametrlər → Məşq xatırlatması). Its text is
     fixed when it is scheduled, so it is scheduled again when the language
     changes — and on every launch, which also restores it after the OS dropped
     the schedule (a reinstall, a restored backup). Only once the store has
     loaded: before that `reminder` is the default, and applying it would cancel
     the real one. */
  const hydrated = useAppStore((s) => s.hydrated);
  const reminder = useAppStore((s) => s.reminder);
  const lang = useAppStore((s) => s.lang);
  useEffect(() => {
    if (hydrated && reminder.on) void applyWorkoutReminder(reminder);
  }, [hydrated, reminder, lang]);

  /* Tapping a notification — from the lock screen, the tray, or while the app is
     open — opens the same screen the notification centre opens for that row. */
  useEffect(() => {
    let alive = true;
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      // The app was launched BY the notification: the tap that started this
      // process is not delivered to the listener below.
      if (alive && r) openPush(r.notification.request.content.data as Record<string, unknown>);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      openPush(r.notification.request.content.data as Record<string, unknown>)
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Font loading has SETTLED either way — see the render below.
  const fontsSettled = Boolean(fontsLoaded || fontError);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Render once font loading has SETTLED either way — a font failure must
            never leave the user staring at a permanently blank screen; the system
            face is a fine fallback. */}
        {fontsSettled ? (
          /* Nothing caught a render error before this. React unmounts the whole
             tree when one escapes, so a single bad row anywhere turned the app
             into a white screen with no tab bar and no way back — force-quit was
             the only exit. `UiHost` stays OUTSIDE the boundary so a toast or a
             dialog can still be shown while the boundary is what is on screen. */
          <AppErrorBoundary>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="trainer" />
              <Stack.Screen name="gym" />
              <Stack.Screen name="onboarding" />
              {/* The sign-in screen. Undeclared until now — it worked only
                  because expo-router falls back to defaults for a route nothing
                  configures, which is also why nothing ever noticed it had a
                  single entry point in the whole app. */}
              <Stack.Screen name="auth" />
              <Stack.Screen name="chat" />
            </Stack>
          </AppErrorBoundary>
        ) : (
          <View style={{ flex: 1, backgroundColor: palette.inkText }} />
        )}
        {/* Its own boundary. `UiHost` is a SIBLING of the Stack, not a
            descendant, so the boundary around the Stack cannot catch anything it
            throws — and `UiHost` mounts `CommentsSheet`, the largest subtree in
            the app and the one rendering the most untrusted server data. A throw
            in there unwound to the React root and took the whole app with it:
            white screen, no tab bar, no «Yenidən cəhd et», force-quit the only
            way out — exactly what AppErrorBoundary exists to prevent. Keeping it
            OUTSIDE the Stack's boundary is still right (a toast must be drawable
            over a failed screen); it just needs one of its own. */}
        <AppErrorBoundary label={t('Bu pəncərə açılmadı')}>
          <UiHost />
        </AppErrorBoundary>
        {/* The app's base clock colour: dark, for the light screens. While the
            fonts load, though, what is on screen is the near-black placeholder
            above (it carries on the dark splash), and a dark clock on it was
            black on black. This entry is the first one on React Native's status
            bar stack and a prop change replaces it IN PLACE, so flipping it here
            never overrides the light entries a dark screen pushes on focus. */}
        <StatusBar style={fontsSettled ? 'dark' : 'light'} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
