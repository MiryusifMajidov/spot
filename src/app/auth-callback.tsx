import { useLinkingURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { handleAuthDeepLink } from '@/lib/auth';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette } from '@/theme';

/**
 * Where the sign-in e-mail's link lands — `spot://auth-callback`.
 *
 * THIS ROUTE DID NOT EXIST. The link opened SPOT, expo-router found no screen
 * called auth-callback, and drew +not-found: «Belə səhifə yoxdur — Açmaq
 * istədiyin ünvan SPOT-da tapılmadı». Meanwhile the root layout DID exchange
 * the token and toasted «Hesabın qorundu» over the top of that page. So the
 * person was told on one screen that their link was dead and in the same
 * second that it had worked — and then nothing moved them anywhere.
 *
 * Now this screen owns the whole thing: it exchanges the token, asks the server
 * who this is, and sends them to the one right place — into the app when the
 * account is registered, to «Səni necə çağıraq?» when it is new, back to the
 * e-mail screen with the real reason when the link failed. The root layout no
 * longer touches these links: a code can only be exchanged once, and two
 * listeners racing for it is how the second one fails.
 */
export default function AuthCallback() {
  const t = useT();
  const router = useRouter();
  const url = useLinkingURL();
  const bootstrap = useAppStore((s) => s.bootstrap);
  const [stuck, setStuck] = useState(false);
  /* One exchange per link. `useLinkingURL` re-renders with the same URL, and a
     PKCE code is single-use — a second attempt fails and would overwrite the
     success with an error. */
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!url || handled.current === url) return;
    handled.current = url;
    let alive = true;
    void (async () => {
      const r = await handleAuthDeepLink(url);
      if (!alive) return;
      if (r === 'failed') {
        errorFeedback();
        toast(t('Link işləmədi — köhnəlib və ya artıq istifadə olunub. Yenisini göndər.'), 'error');
        router.replace({ pathname: '/auth/sign-in', params: { mode: 'login' } });
        return;
      }
      if (r === 'none') {
        // Not a sign-in link at all — nothing to do here but go home.
        router.replace('/');
        return;
      }
      // Who is this? bootstrap() reads the profile and decides `onboarded` from
      // the @ad (appStore), so the answer below is the server's, not a guess.
      await bootstrap();
      if (!alive) return;
      successFeedback();
      const { onboarded, profile } = useAppStore.getState();
      if (onboarded && (profile.username ?? '').trim()) {
        toast(t('Daxil oldun'));
        router.replace('/(tabs)/discover');
      } else {
        // A brand-new account: the same one-screen registration Google and
        // Apple lead to. Skipping it is how an e-mail sign-up used to land in
        // the tabs with no name and no @ad.
        router.replace('/onboarding/profile');
      }
    })();
    return () => {
      alive = false;
    };
  }, [url, bootstrap, router, t]);

  /* If nothing has happened after a while — no URL arrived, or the exchange is
     hanging on a dead connection — say so and give a way out, instead of a
     spinner that never ends. */
  useEffect(() => {
    const id = setTimeout(() => setStuck(true), 12000);
    return () => clearTimeout(id);
  }, []);

  return (
    <Screen>
      <View style={styles.center}>
        {stuck ? (
          <>
            <AppText variant="headline" center>
              {t('Giriş uzun çəkir')}
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={styles.body}>
              {t('Bağlantını yoxla. Link işləməyibsə, e-poçt ekranından yenisini göndərə bilərsən.')}
            </AppText>
            <Button
              title={t('E-poçt ekranına qayıt')}
              onPress={() => router.replace({ pathname: '/auth/sign-in', params: { mode: 'login' } })}
              style={{ marginTop: 18 }}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={palette.inkText} />
            <AppText variant="body" color={palette.textSecondary} center style={styles.body}>
              {t('Daxil olunur…')}
            </AppText>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  body: { marginTop: 10, lineHeight: 21, maxWidth: 300 },
});
