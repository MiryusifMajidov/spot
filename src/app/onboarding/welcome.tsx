import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { LanguagePicker } from '@/components/LanguagePicker';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { AuthSetupError, signInWithApple, signInWithGoogle, SOCIAL_FIRST } from '@/lib/auth';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { dark, palette } from '@/theme';

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
  const router = useRouter();
  const enterGuest = useAppStore((s) => s.enterGuest);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const [busy, setBusy] = useState<null | 'google' | 'apple'>(null);

  const browseAsGuest = () => {
    enterGuest();
    router.replace('/(tabs)/discover');
  };

  /* Both providers on both platforms. `SOCIAL_FIRST` only decides the order —
     Apple on top on iOS because the App Store requires it to be offered. */
  const providers: ('google' | 'apple')[] = SOCIAL_FIRST === 'apple' ? ['apple', 'google'] : ['google', 'apple'];

  const social = async (provider: 'google' | 'apple') => {
    if (!hasSupabaseConfig) return toast('Server bağlantısı yoxdur', 'error');
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
        toast(`${label} ilə daxil oldun`);
        router.replace('/(tabs)/discover');
      } else {
        router.replace('/onboarding/profile');
      }
    } catch (e) {
      if (String((e as Error)?.message ?? '') === 'cancelled') return; // browser closed
      errorFeedback();
      toast(
        e instanceof AuthSetupError
          ? `${label} girişi hələ açılmayıb. Bu, tətbiqin deyil, serverin ayarıdır.`
          : `${label} girişi alınmadı — yenidən cəhd et`,
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LinearGradient
        colors={['rgba(198,255,61,0.18)', 'transparent']}
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
          <LanguagePicker compact tone="dark" />
        </View>
        <View style={styles.center}>
          <View style={styles.logoBox}>
            <View style={styles.ring}>
              <View style={styles.ringDot} />
            </View>
          </View>
          <View style={{ alignItems: 'center', marginTop: 26 }}>
            <AppText style={styles.title}>Tək məşq etmə</AppText>
            {/* No exercise videos exist in the app yet, so the old line
                («hər hərəkəti video ilə öyrən») promised something SPOT cannot
                deliver on the very first screen a new user sees. */}
            <AppText style={styles.subtitle}>Zalını seç, məşq yoldaşını tap, hər məşqini qeyd et. Hesabın varsa, eyni düymə ilə geri qayıdırsan.</AppText>
          </View>
        </View>

        <View style={styles.actions}>
          {providers.map((prov) => (
            <PressableScale
              key={prov}
              disabled={!!busy}
              onPress={() => void social(prov)}
              style={[styles.btn, { backgroundColor: palette.white }]}>
              {busy === prov ? (
                <ActivityIndicator color={palette.inkText} />
              ) : (
                <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>
                  {prov === 'apple' ? 'Apple' : 'Google'} ilə davam et
                </AppText>
              )}
            </PressableScale>
          ))}

          {/* E-poçt is the third way in, and the only one that works when neither
              social provider does — an account opened with Google on Android has
              to be reachable from an iPhone. */}
          <PressableScale
            disabled={!!busy}
            onPress={() => router.push({ pathname: '/auth/sign-in', params: { mode: 'login' } })}
            style={[styles.btn, styles.btnGhost]}>
            <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.white }}>E-poçt ilə davam et</AppText>
          </PressableScale>

          <PressableScale haptic={false} onPress={browseAsGuest} disabled={!!busy} style={styles.guestBtn}>
            <AppText style={{ fontSize: 15, fontWeight: '600', color: palette.volt }}>Qonaq kimi bax</AppText>
            <Icon name="chevR" size={16} color={palette.volt} />
          </PressableScale>
          {/* Both were plain words over documents that did not exist, so the
              consent was consent to nothing — and both app stores require a
              reachable privacy policy. They are links now. */}
          <AppText style={styles.terms}>
            Davam etməklə{' '}
            <AppText
              style={styles.termsLink}
              onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}>
              İstifadə şərtləri
            </AppText>{' '}
            və{' '}
            <AppText
              style={styles.termsLink}
              onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}>
              Məxfilik siyasəti
            </AppText>{' '}
            ilə razılaşırsan. SPOT 16 yaşdan yuxarı istifadəçilər üçündür.
          </AppText>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.inkText },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 400 },
  safe: { flex: 1, paddingHorizontal: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoBox: { width: 86, height: 86, borderRadius: 24, backgroundColor: dark.surface, borderWidth: 1, borderColor: dark.hairline, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 38, height: 38, borderRadius: 19, borderWidth: 6, borderColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  ringDot: { position: 'absolute', top: 9, left: 9, right: 9, bottom: 9, borderRadius: 10, backgroundColor: palette.volt },
  title: { fontSize: 34, fontWeight: '700', color: palette.white, letterSpacing: -1 },
  langRow: { flexDirection: 'row', justifyContent: 'center', paddingTop: 6 },
  subtitle: { fontSize: 16, lineHeight: 24, color: dark.textSecondary, textAlign: 'center', maxWidth: 290, marginTop: 12 },
  actions: { gap: 10, paddingBottom: 8 },
  btn: { height: 52, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: dark.hairline },
  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 44 },
  termsLink: { textDecorationLine: 'underline' as const, color: palette.volt },
  terms: { fontSize: 11.5, lineHeight: 17, color: dark.textTertiary, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
});
