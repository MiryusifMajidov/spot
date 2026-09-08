import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/ui/AppErrorBoundary';
import { UiHost } from '@/components/ui/UiHost';
import { handleAuthDeepLink } from '@/lib/auth';
import { successFeedback } from '@/lib/feedback';
import { openPush, registerPush } from '@/lib/push';
import { toast } from '@/store/ui';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

export default function RootLayout() {
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

  /* E-poçt girişi burada bitir.
     Supabase's hosted mailer sends a LINK (a code needs a paid SMTP provider to
     edit the template), so the person taps it, the browser verifies and bounces
     to `spot://auth-callback`, and the app is opened with the credentials on the
     URL. This turns that into a session — for both a cold start and an app that
     was already running.
     A URL that carries nothing to exchange is ignored silently: not every
     deep link into this app is a login. */
  useEffect(() => {
    let alive = true;
    const finish = (url: string | null) => {
      if (!alive || !url) return;
      handleAuthDeepLink(url).then((ok) => {
        if (ok && alive) {
          successFeedback();
          toast('Hesabın qorundu — indi başqa telefondan da girə bilərsən');
          void bootstrap();
        }
      });
    };
    void Linking.getInitialURL().then(finish);
    const sub = Linking.addEventListener('url', (e) => finish(e.url));
    return () => {
      alive = false;
      sub.remove();
    };
  }, [bootstrap]);

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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Render once font loading has SETTLED either way — a font failure must
            never leave the user staring at a permanently blank screen; the system
            face is a fine fallback. */}
        {fontsLoaded || fontError ? (
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
              <Stack.Screen name="chat" />
              <Stack.Screen name="challenge" />
            </Stack>
          </AppErrorBoundary>
        ) : (
          <View style={{ flex: 1, backgroundColor: palette.inkText }} />
        )}
        <UiHost />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
