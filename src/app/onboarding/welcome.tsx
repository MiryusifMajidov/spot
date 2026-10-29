import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Trans } from '@/components/Trans';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { AuthSetupError, signInWithApple, signInWithGoogle, useSocialProviders } from '@/lib/auth';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, radius } from '@/theme';

/**
 * The first screen, and now the actual gate.
 *
 * It used to offer «Başla» — which led straight to «Məqsədin nədir?» — and
 * «Qonaq kimi bax». Neither asked who the person was. The app's real sign-in,
 * with Google, Apple and e-poçt all working, had exactly ONE link to it in the
 * whole codebase: Profil → Parametrlər → «Hesabını qoru». So a new user was
 * never offered it, and somebody who already HAD an account could not say so —
 * they had to register a second time, were told their own @ad was taken, and
 * left a duplicate profile row behind.
 *
 * Signing in and signing up are the same button here, which is what makes this
 * simple: with Google, Apple or a mail link, Supabase opens the account if it
 * does not exist and returns the existing one if it does. The app finds out
 * which happened by whether `bootstrap()` loads a profile.
 */

export default function Welcome() {
  const t = useT();
  const router = useRouter();
  const enterGuest = useAppStore((s) => s.enterGuest);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const [busy, setBusy] = useState<null | 'google' | 'apple'>(null);

  /* Dark clock over this screen — only while it is the screen in front. It was
     a light clock while this screen was dark; the final design draws every
     onboarding screen light, so the clock follows. A mount-time
     <StatusBar style="light" /> used to sit here, and this screen stays mounted
     under everything it pushes (the e-poçt sign-in and the two legal pages), so
     its entry stayed on top of React Native's status-bar stack and leaked onto
     those screens. The entry is now pushed on every focus and popped on blur.
     On iOS the native style is also set directly, because the stack skips the
     native call whenever it believes the bar already has that style — same
     approach as workout/exercise.tsx. */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios') StatusBar.setBarStyle('dark-content', true);
      const entry = StatusBar.pushStackEntry({ barStyle: 'dark-content', animated: true });
      return () => StatusBar.popStackEntry(entry);
    }, [])
  );

  const browseAsGuest = () => {
    enterGuest();
    router.replace('/(tabs)/discover');
  };

  /* Apple on iOS, Google on Android (SOCIAL_PROVIDERS), minus whatever the
     server says is off — a dead button is worse than one fewer. */
  const providers = useSocialProviders();

  const social = async (provider: 'google' | 'apple') => {
    if (!hasSupabaseConfig) return toast(t('Server bağlantısı yoxdur'), 'error');
    const label = provider === 'apple' ? 'Apple' : 'Google';
    setBusy(provider);
    try {
      await (provider === 'apple' ? signInWithApple() : signInWithGoogle());
      /* Re-read the account before routing. bootstrap() is what discovers a
         profile already on the server and, with it, sets `onboarded` — so a
         returning person goes straight to their own app, and a brand-new one
         falls through to the short profile step below. Without this the screen
         would route on state belonging to the anonymous session it just left. */
      await bootstrap();
      successFeedback();
      const { onboarded, profile } = useAppStore.getState();
      if (onboarded && profile.name.trim()) {
        toast(t('{provider} ilə daxil oldun', { provider: label }));
        router.replace('/(tabs)/discover');
      } else {
        router.replace('/onboarding/profile');
      }
    } catch (e) {
      if (String((e as Error)?.message ?? '') === 'cancelled') return; // browser closed
      errorFeedback();
      toast(
        e instanceof AuthSetupError
          ? t('{provider} girişi hələ açılmayıb. Bu, tətbiqin deyil, serverin ayarıdır.', { provider: label })
          : t('{provider} girişi alınmadı — yenidən cəhd et', { provider: label }),
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      {/* The design's volt glow over the top of the light screen. It fades to
          the same volt at zero alpha, not to 'transparent' — that is transparent
          BLACK, and on a light background the blend turns muddy halfway down. */}
      <LinearGradient
        colors={['rgba(197,254,1,0.18)', 'rgba(197,254,1,0)']}
        style={styles.glow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.6 }}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* The language picker belongs HERE, not only in Settings. Settings sits
            behind an account, and the account is created on a form written in a
            language this person may not read — so putting the only switch there
            locks out exactly the people it exists for. */}
        <View style={styles.langRow}>
          <LanguagePicker compact tone="light" />
        </View>
        <View style={styles.center}>
          <View style={styles.logoBox}>
            <View style={styles.ring}>
              <View style={styles.ringDot} />
            </View>
          </View>
          <View style={{ alignItems: 'center', marginTop: 26 }}>
            <AppText style={styles.title}>{t('Tək məşq etmə')}</AppText>
            {/* No exercise videos exist in the app yet, so the old line
                («hər hərəkəti video ilə öyrən») promised something SPOT cannot
                deliver on the very first screen a new user sees. */}
            <AppText style={styles.subtitle}>{t('Zalını seç, məşq yoldaşını tap, hər məşqini qeyd et. Hesabın varsa, eyni düymə ilə geri qayıdırsan.')}</AppText>
          </View>
        </View>

        <View style={styles.actions}>
          {/* Apple stays black, with its logo — Apple's sign-in rules, and the one
              exception the design makes to the volt CTA. Google is the white
              surface button. */}
          {providers.map((prov) => (
            <PressableScale
              key={prov}
              disabled={!!busy}
              onPress={() => void social(prov)}
              style={[styles.btn, prov === 'apple' ? styles.btnApple : styles.btnGoogle]}>
              {busy === prov ? (
                <ActivityIndicator color={prov === 'apple' ? palette.onDark : palette.inkText} />
              ) : (
                <>
                  {prov === 'apple' ? <Icon name="apple" size={19} color={palette.onDark} /> : null}
                  <AppText style={{ fontSize: 16, fontWeight: '600', color: prov === 'apple' ? palette.onDark : palette.inkText }}>
                    {t('{provider} ilə davam et', { provider: prov === 'apple' ? 'Apple' : 'Google' })}
                  </AppText>
                </>
              )}
            </PressableScale>
          ))}

          {/* E-poçt is the third way in, and the only one that works when neither
              social provider does — an account opened with Google on Android has
              to be reachable from an iPhone. */}
          <PressableScale
            disabled={!!busy}
            onPress={() => router.push({ pathname: '/auth/sign-in', params: { mode: 'login' } })}
            style={[styles.btn, styles.btnSecondary]}>
            <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>{t('E-poçt ilə davam et')}</AppText>
          </PressableScale>

          <PressableScale haptic={false} onPress={browseAsGuest} disabled={!!busy} style={styles.guestBtn}>
            <AppText style={{ fontSize: 15, fontWeight: '600', color: palette.inkText }}>{t('Qonaq kimi bax')}</AppText>
            {/* 18, not 16: the chevron's path fills only 14 of the icon's 24
                units, so at 16 it drew ~9 pt tall with a hairline stroke, shorter
                and lighter than the 15 pt semibold capitals beside it. At 18 it
                matches their cap height and weight, like the app's row chevrons. */}
            <Icon name="chevR" size={18} color={palette.inkText} />
          </PressableScale>
          {/* Both were plain words over documents that did not exist, so the
              consent was consent to nothing — and both app stores require a
              reachable privacy policy. They are links now. */}
          {/* One sentence, translated whole — see components/Trans.tsx. It was
              five fragments around two links, which cannot be translated: the
              order of verb and objects differs in Russian and English. */}
          <Trans
            style={styles.terms}
            text={t('Davam etməklə {terms} və {privacy} ilə razılaşırsan. SPOT 16 yaşdan yuxarı istifadəçilər üçündür.')}
            parts={{
              terms: (
                <AppText
                  style={styles.termsLink}
                  onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}>
                  {t('İstifadə şərtləri')}
                </AppText>
              ),
              privacy: (
                <AppText
                  style={styles.termsLink}
                  onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}>
                  {t('Məxfilik siyasəti')}
                </AppText>
              ),
            }}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.grouped },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  safe: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoBox: { width: 86, height: 86, borderRadius: 24, backgroundColor: palette.element, borderWidth: 1, borderColor: palette.cardBorder, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 38, height: 38, borderRadius: 19, borderWidth: 6, borderColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  ringDot: { position: 'absolute', top: 9, left: 9, right: 9, bottom: 9, borderRadius: 10, backgroundColor: palette.volt },
  // Centred explicitly: short in Azerbaijani, the Russian title wraps to two
  // lines, and a wrapped line fills the width and falls back to left-aligned.
  title: { fontSize: 34, fontWeight: '700', color: palette.inkText, letterSpacing: -1, textAlign: 'center' },
  langRow: { flexDirection: 'row', justifyContent: 'center', paddingTop: 6 },
  subtitle: { fontSize: 16, lineHeight: 24, color: palette.textSecondary, textAlign: 'center', maxWidth: 290, marginTop: 12 },
  actions: { gap: 10, paddingBottom: 8 },
  btn: { height: 52, borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnApple: { backgroundColor: palette.ink },
  btnGoogle: { backgroundColor: palette.white },
  // The design's secondary button: #EDEDED, no border.
  btnSecondary: { backgroundColor: palette.element },
  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 44 },
  termsLink: { textDecorationLine: 'underline' as const, color: palette.textSecondary },
  terms: { fontSize: 11.5, lineHeight: 17, color: palette.caption, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
});
