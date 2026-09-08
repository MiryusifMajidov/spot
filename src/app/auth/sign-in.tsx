import { useRouter } from 'expo-router';
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
  confirmPhoneCode,
  normalizePhone,
  sendEmailCode,
  sendPhoneCode,
  signInWithGoogle,
} from '@/lib/auth';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * «Hesabını qoru» — the screen that makes an account reachable.
 *
 * It is not a login wall. The person is already signed in (anonymously) and
 * already has their data; this attaches a way back to it. The copy promises what
 * actually happens — the SAME account, openable from another phone — instead of
 * implying a new one is being created. `lib/auth` links the identity to the
 * existing anonymous user, so the profile id, the @username, the streak and the
 * videos are untouched.
 *
 * Three channels, in the order they actually work today:
 *   e-poçt  · the `email` provider is enabled on the project — works now
 *   Google  · needs an OAuth client and «Manual linking» switched on
 *   nömrə   · needs an SMS provider, and every code costs money
 * The two that are not configured say exactly that, and say it is the server's
 * setting rather than something the person did wrong.
 */
type Channel = 'email' | 'phone';

export default function SignIn() {
  const router = useRouter();
  const profileName = useAppStore((s) => s.profile.name);

  const [busy, setBusy] = useState<null | 'google' | Channel>(null);
  const [sent, setSent] = useState<{ channel: Channel; to: string; linking: boolean } | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const e164 = normalizePhone(phone);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  const setupMessage = (e: unknown): string | null => {
    if (!(e instanceof AuthSetupError)) return null;
    const what = e.what === 'google' ? 'Google girişi' : e.what === 'phone' ? 'SMS ilə giriş' : 'E-poçt ilə giriş';
    return `${what} hələ açılmayıb. Bu, tətbiqin deyil, serverin ayarıdır.`;
  };

  const google = async () => {
    if (!hasSupabaseConfig) return toast('Server bağlantısı yoxdur', 'error');
    setBusy('google');
    try {
      await signInWithGoogle();
      successFeedback();
      toast('Hesabın Google ilə qorundu');
      router.back();
    } catch (e) {
      if (String((e as Error)?.message ?? '') === 'cancelled') return; // browser closed
      errorFeedback();
      toast(setupMessage(e) ?? 'Google girişi alınmadı — yenidən cəhd et', 'error');
    } finally {
      setBusy(null);
    }
  };

  const send = async (channel: Channel) => {
    if (!hasSupabaseConfig) return toast('Server bağlantısı yoxdur', 'error');
    setBusy(channel);
    try {
      const to = channel === 'email' ? email.trim().toLowerCase() : (e164 ?? '');
      const r = channel === 'email' ? await sendEmailCode(to) : await sendPhoneCode(phone);
      setSent({ channel, to, linking: r.linking });
      setCode('');
      toast(
        channel === 'email'
          ? `${to} ünvanına link göndərildi — poçtunu aç və linkə toxun`
          : `${to} nömrəsinə kod göndərildi`
      );
    } catch (e) {
      errorFeedback();
      const m = String((e as Error)?.message ?? '');
      toast(
        setupMessage(e) ??
          (m === 'rate-limited'
            ? 'Çox tez-tez cəhd edildi — bir neçə dəqiqə gözlə'
            : m === 'bad-email'
              ? 'E-poçt ünvanı düzgün deyil'
              : m === 'bad-phone'
                ? 'Nömrə düzgün deyil'
                : 'Kod göndərilmədi — yenidən cəhd et'),
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!sent) return;
    setBusy(sent.channel);
    try {
      if (sent.channel === 'email') await confirmEmailCode(sent.to, code, sent.linking);
      else await confirmPhoneCode(sent.to, code, sent.linking);
      successFeedback();
      toast('Hesabın qorundu');
      router.back();
    } catch (e) {
      errorFeedback();
      const m = String((e as Error)?.message ?? '').toLowerCase();
      toast(
        m.includes('expired')
          ? 'Kodun vaxtı bitib — yenisini istə'
          : m.includes('bad-code')
            ? 'Kodu tam yaz'
            : 'Kod düz gəlmədi — yenidən yoxla',
        'error'
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Hesabını qoru" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Icon name="shield" size={22} color={palette.voltDeep} />
          <AppText variant="body" color={palette.text3} style={{ lineHeight: 22, flex: 1 }}>
            {profileName.trim() ? `${profileName.trim()}, hesabın` : 'Hesabın'} hazırda yalnız bu telefonda yaşayır.
            Tətbiqi silsən və ya telefonu dəyişsən, məşq tarixçən, @adın və videoların qayıtmır.
          </AppText>
        </View>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
          Bu, yeni hesab açmır — indiki hesabına giriş yolu əlavə edir. Heç nə itmir.
        </AppText>

        {sent ? (
          <>
            {sent.channel === 'email' ? (
              /* Supabase's hosted mailer sends a LINK, not a code — adding
                 `{{ .Token }}` to the template needs a paid SMTP provider. So the
                 link is the main path and the code box is the fallback for when
                 SMTP is configured later. Saying «kod gözlə» while a link arrives
                 would be the app describing something that is not happening. */
              <View style={styles.hero}>
                <Icon name="msg" size={20} color={palette.voltDeep} />
                <AppText variant="body" color={palette.text3} style={{ lineHeight: 22, flex: 1 }}>
                  <AppText style={{ fontWeight: '700' }}>{sent.to}</AppText> ünvanına link göndərdik. Poçtunu aç və
                  linkə toxun — tətbiq özü açılacaq və hesabın qorunacaq.
                </AppText>
              </View>
            ) : null}
            <AppText variant="overline" color={palette.caption} style={styles.label}>
              {sent.channel === 'email' ? 'VƏ YA MƏKTUBDAKI KODU YAZ' : `${sent.to} NÖMRƏSİNƏ GƏLƏN KOD`}
            </AppText>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))}
              placeholder="123456"
              placeholderTextColor={palette.caption}
              keyboardType="number-pad"
              maxLength={8}
              autoFocus
              style={[styles.input, styles.codeInput]}
            />
            <Button
              title={busy ? 'Yoxlanılır…' : 'Təsdiqlə'}
              full
              disabled={code.length < 4 || !!busy}
              onPress={confirm}
              style={{ marginTop: 14 }}
            />
            {sent.channel === 'email' ? (
              <AppText variant="caption" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
                Məktubda yalnız link varsa, kod xanasını boş burax — linkə toxunmaq kifayətdir.
              </AppText>
            ) : null}
            <PressableScale haptic={false} onPress={() => setSent(null)} style={styles.backLink}>
              <AppText variant="subhead" color={palette.blue}>
                Başqa üsulla
              </AppText>
            </PressableScale>
          </>
        ) : (
          <>
            <AppText variant="overline" color={palette.caption} style={styles.label}>
              E-POÇT İLƏ
            </AppText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="ad@gmail.com"
              placeholderTextColor={palette.caption}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Button
              title={busy === 'email' ? 'Göndərilir…' : 'Kod göndər'}
              full
              disabled={!emailOk || !!busy}
              onPress={() => send('email')}
              style={{ marginTop: 12 }}
            />

            <AppText variant="overline" color={palette.caption} style={styles.label}>
              GOOGLE İLƏ
            </AppText>
            <PressableScale activeScale={0.98} onPress={google} disabled={!!busy} style={styles.googleBtn}>
              {busy === 'google' ? (
                <ActivityIndicator color={palette.inkText} />
              ) : (
                <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>
                  Google hesabı ilə davam et
                </AppText>
              )}
            </PressableScale>

            <AppText variant="overline" color={palette.caption} style={styles.label}>
              NÖMRƏ İLƏ
            </AppText>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="055 123 45 67"
              placeholderTextColor={palette.caption}
              keyboardType="phone-pad"
              maxLength={20}
              style={styles.input}
            />
            <AppText variant="caption" color={palette.caption} style={{ marginTop: 6 }}>
              {e164 ? `Kod ${e164} nömrəsinə gedəcək` : 'Nömrəni 055… formasında yaz'}
            </AppText>
            <Button
              title={busy === 'phone' ? 'Göndərilir…' : 'Kod göndər'}
              full
              disabled={!e164 || !!busy}
              onPress={() => send('phone')}
              style={{ marginTop: 12 }}
            />
          </>
        )}

        <AppText variant="caption" color={palette.caption} style={styles.footer}>
          E-poçtun və nömrən yalnız sənə görünür — başqa istifadəçilər onları heç vaxt görmür.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
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
