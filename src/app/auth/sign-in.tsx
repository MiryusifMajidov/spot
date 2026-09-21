import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import {
  AuthSetupError,
  confirmEmailCode,
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  SOCIAL_FIRST,
} from '@/lib/auth';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * Sign in — in two moods, because two different people arrive here.
 *
 * `mode=login` (from the opening gate): somebody who HAS an account and wants it
 * back, usually on a new phone. Until now this screen could not serve them at
 * all: it was titled «Hesabını qoru» and its first line told them their account
 * «yalnız bu telefonda yaşayır» — a sentence that is simply false for a person
 * whose account is on the server, and which reads as «you have nothing here».
 *
 * `mode=protect` (from Parametrlər): somebody already using the app anonymously,
 * attaching a way back to the data they already have. For them the old copy was
 * right, so it is kept for that mode and only that mode.
 *
 * Both moods run the same code. `lib/auth` links the identity to the
 * existing anonymous user, so the profile id, the @username, the streak and the
 * videos are untouched.
 *
 * Two ways in, in the order they are meant to be used:
 *   Apple / Google · the primary path, and the only one most people will touch.
 *                    Which one appears is decided by the platform, never offered
 *                    as a choice: an Android phone has no Apple sign-in and an
 *                    iPhone must be offered Apple (App Store rule).
 *   e-poçt         · the fallback. It is what gets somebody back into their
 *                    account when the social provider fails, or when the account
 *                    was opened on a phone of the other kind.
 *
 * Sign-in by phone number is gone. It needed a paid SMS provider, every code
 * cost money, and it was the slowest of the three for the person using it.
 *
 * A provider that is not switched on server-side says exactly that, and says it
 * is the server's setting rather than something the person did wrong.
 */

export default function SignIn() {
  const t = useT();
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const login = mode === 'login';
  const profileName = useAppStore((s) => s.profile.name);
  const bootstrap = useAppStore((s) => s.bootstrap);

  const [busy, setBusy] = useState<null | 'google' | 'apple' | 'email'>(null);
  const [sent, setSent] = useState<{ to: string; linking: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  /* Both providers, both platforms. `SOCIAL_FIRST` only decides which one is on
     top — Apple first on iOS (App Store rule), Google first elsewhere. */
  const providers: ('google' | 'apple')[] = SOCIAL_FIRST === 'apple' ? ['apple', 'google'] : ['google', 'apple'];

  /* From the gate there is nothing to go «back» to — the gate IS the root of the
     stack — so a signed-in person is sent into the app instead. */
  const done = () => (login ? router.replace('/(tabs)/discover') : router.back());

  const setupMessage = (e: unknown): string | null => {
    if (!(e instanceof AuthSetupError)) return null;
    const what =
      e.what === 'google'
        ? t('Google girişi')
        : e.what === 'apple'
          ? t('Apple girişi')
          : t('E-poçt ilə giriş');
    return t('{what} hələ açılmayıb. Bu, tətbiqin deyil, serverin ayarıdır.', { what });
  };

  const social = async (provider: 'google' | 'apple') => {
    if (!hasSupabaseConfig) return toast(t('Server bağlantısı yoxdur'), 'error');
    const label = provider === 'apple' ? 'Apple' : 'Google';
    setBusy(provider);
    try {
      await (provider === 'apple' ? signInWithApple() : signInWithGoogle());
      /* Re-read the account. Without this the store keeps the name, @ad and
         `profileId` of the session that was just abandoned, while the session
         itself belongs to the account signed into — and every ownership check
         keyed on `profileId` points at the wrong person until the app is killed.
         The e-mail path already does this from the deep-link handler. */
      await bootstrap();
      successFeedback();
      toast(
        login
          ? t('{provider} ilə daxil oldun', { provider: label })
          : t('Hesabın {provider} ilə qorundu', { provider: label })
      );
      done();
    } catch (e) {
      if (String((e as Error)?.message ?? '') === 'cancelled') return; // browser closed
      errorFeedback();
      toast(setupMessage(e) ?? t('{provider} girişi alınmadı — yenidən cəhd et', { provider: label }), 'error');
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!hasSupabaseConfig) return toast(t('Server bağlantısı yoxdur'), 'error');
    setBusy('email');
    try {
      const to = email.trim().toLowerCase();
      const r = await sendEmailCode(to);
      setSent({ to, linking: r.linking });
      setCode('');
      toast(t('{email} ünvanına link göndərildi — poçtunu aç və linkə toxun', { email: to }));
    } catch (e) {
      errorFeedback();
      const m = String((e as Error)?.message ?? '');
      toast(
        setupMessage(e) ??
          (m === 'rate-limited'
            ? t('Çox tez-tez cəhd edildi — bir neçə dəqiqə gözlə')
            : m === 'bad-email'
              ? t('E-poçt ünvanı düzgün deyil')
              : t('Link göndərilmədi — yenidən cəhd et')),
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!sent) return;
    setBusy('email');
    try {
      await confirmEmailCode(sent.to, code, sent.linking);
      successFeedback();
      toast(login ? t('Daxil oldun') : t('Hesabın qorundu'));
      done();
    } catch (e) {
      errorFeedback();
      const m = String((e as Error)?.message ?? '').toLowerCase();
      toast(
        m.includes('expired')
          ? t('Kodun vaxtı bitib — yenisini istə')
          : m.includes('bad-code')
            ? t('Kodu tam yaz')
            : t('Kod düz gəlmədi — yenidən yoxla'),
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={login ? t('Daxil ol') : t('Hesabını qoru')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {/* Two different people, two different true sentences. Telling somebody
            who is signing in on a new phone that «hesabın yalnız bu telefonda
            yaşayır» is false — their account is on the server, which is the only
            reason this screen can work for them at all. */}
        <View style={styles.hero}>
          <Icon name="shield" size={22} color={palette.voltDeep} />
          <AppText variant="body" color={palette.text3} style={{ lineHeight: 22, flex: 1 }}>
            {login
              ? t('Hesabını hansı üsulla açmısansa, onu seç — məşq tarixçən, @adın və videoların geri qayıdacaq.')
              : t(
                  '{who} hazırda yalnız bu telefonda yaşayır. Tətbiqi silsən və ya telefonu dəyişsən, məşq tarixçən, @adın və videoların qayıtmır.',
                  {
                    who: profileName.trim()
                      ? t('{name}, hesabın', { name: profileName.trim() })
                      : t('Hesabın'),
                  }
                )}
          </AppText>
        </View>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
          {login
            ? t('Hesabın yoxdursa, geri qayıt və «Başla» ilə yeni hesab aç.')
            : t('Bu, yeni hesab açmır — indiki hesabına giriş yolu əlavə edir. Heç nə itmir.')}
        </AppText>

        {sent ? (
          <>
            {/* Supabase's hosted mailer sends a LINK, not a code — adding
                `{{ .Token }}` to the template needs a paid SMTP provider. So the
                link is the main path and the code box is the fallback for when
                SMTP is configured later. Saying «kod gözlə» while a link arrives
                would be the app describing something that is not happening. */}
            <View style={styles.hero}>
              <Icon name="msg" size={20} color={palette.voltDeep} />
              <AppText variant="body" color={palette.text3} style={{ lineHeight: 22, flex: 1 }}>
                <AppText style={{ fontWeight: '700' }}>{sent.to}</AppText> ünvanına link göndərdik. Poçtunu aç və
                linkə toxun — tətbiq özü açılacaq və hesabın qorunacaq.
              </AppText>
            </View>
            <AppText variant="overline" color={palette.caption} style={styles.label}>
              {t('VƏ YA MƏKTUBDAKI KODU YAZ')}
            </AppText>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
              placeholder="123456"
              placeholderTextColor={palette.caption}
              keyboardType="number-pad"
              maxLength={8}
              autoFocus
              style={[styles.input, styles.codeInput]}
            />
            <Button
              title={busy ? t('Yoxlanılır…') : t('Təsdiqlə')}
              full
              disabled={code.length < 4 || !!busy}
              onPress={confirm}
              style={{ marginTop: 14 }}
            />
            <AppText variant="caption" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
              {t('Məktubda yalnız link varsa, kod xanasını boş burax — linkə toxunmaq kifayətdir.')}
            </AppText>
            <PressableScale haptic={false} onPress={() => setSent(null)} style={styles.backLink}>
              <AppText variant="subhead" color={palette.blue}>
                {t('Başqa üsulla')}
              </AppText>
            </PressableScale>
          </>
        ) : (
          <>
            {/* Both providers, both platforms. An account opened with Google on
                an Android phone has to be openable from an iPhone, and the old
                one-button-per-platform layout is precisely what made that
                impossible. E-poçt sits under the divider as the third way. */}
            {providers.map((prov) => (
              <PressableScale
                key={prov}
                activeScale={0.98}
                onPress={() => void social(prov)}
                disabled={!!busy}
                style={styles.googleBtn}>
                {busy === prov ? (
                  <ActivityIndicator color={palette.inkText} />
                ) : (
                  <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>
                    {t('{provider} ilə davam et', { provider: prov === 'apple' ? 'Apple' : 'Google' })}
                  </AppText>
                )}
              </PressableScale>
            ))}

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <AppText variant="caption" color={palette.caption}>
                {t('və ya')}
              </AppText>
              <View style={styles.orLine} />
            </View>

            <AppText variant="overline" color={palette.caption} style={styles.label}>
              {t('E-POÇT İLƏ')}
            </AppText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('ad@gmail.com')}
              placeholderTextColor={palette.caption}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Button
              title={busy === 'email' ? t('Göndərilir…') : t('Link göndər')}
              full
              disabled={!emailOk || !!busy}
              onPress={send}
              style={{ marginTop: 12 }}
            />
          </>
        )}

        <AppText variant="caption" color={palette.caption} style={styles.footer}>
          {t('E-poçtun yalnız sənə görünür — başqa istifadəçilər onu heç vaxt görmür.')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  hero: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: palette.white,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.separator,
  },
  label: { marginTop: 24, marginBottom: 10 },
  googleBtn: {
    height: 52,
    borderRadius: radius.field,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: palette.white,
    borderRadius: radius.field,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    color: palette.inkText,
    borderWidth: 1,
    borderColor: palette.separator,
  },
  codeInput: { textAlign: 'center', letterSpacing: 6, fontSize: 22, fontWeight: '700' },
  backLink: { alignSelf: 'center', marginTop: 16 },
  footer: { marginTop: 26, lineHeight: 18 },
});
