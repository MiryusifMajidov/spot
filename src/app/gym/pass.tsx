import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { GymGate, useMyGym } from '@/lib/gymOwner';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { t } from '@/lib/i18n';
import { checkDayPass, redeemDayPass, type PassCheck } from '@/lib/roles';
import { useT } from '@/lib/useT';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * «Day-pass yoxla» — the missing half of the day-pass.
 *
 * The visitor's screen has always said «Resepsiyada bu kodu göstər», and until
 * now there was nowhere in SPOT — no screen, no panel, no request — where a gym
 * could look that code up. Six characters rendered by the visitor's own phone
 * were being presented as proof of something. This is where they become one.
 *
 * Two steps on purpose: «Yoxla» reads, «Təsdiqlə» writes. A single
 * verify-and-burn button would mean one mistyped character turns a stranger's
 * valid pass into a used one, with nothing that can undo it from here.
 *
 * It shows the pass and NOTHING about the person holding it — no name, no
 * profile, no history. Reception needs to know the code is good; the visitor is
 * standing right there and does not need to be introduced by a database.
 */
const stateText = (r: PassCheck): { title: string; body: string; tone: 'ok' | 'bad' | 'warn' } => {
  switch (r.state) {
    case 'valid':
      return {
        title: t('Kod keçərlidir'),
        body: r.expires_at
          ? t('Bu gün {h}:{m}-a qədər. Qonağı içəri burax və aşağıdan təsdiqlə.', {
              h: new Date(r.expires_at).getHours(),
              m: String(new Date(r.expires_at).getMinutes()).padStart(2, '0'),
            })
          : t('Qonağı içəri burax və aşağıdan təsdiqlə.'),
        tone: 'ok',
      };
    case 'redeemed':
      return { title: t('Təsdiqləndi'), body: t('Bu day-pass indi istifadə olunmuş kimi qeyd edildi.'), tone: 'ok' };
    case 'used':
      return {
        title: t('Bu kod artıq istifadə olunub'),
        body: r.used_at
          ? t('{date} tarixində təsdiqlənib. Yenidən keçmir.', { date: new Date(r.used_at).toLocaleString('az-AZ') })
          : t('Daha əvvəl təsdiqlənib. Yenidən keçmir.'),
        tone: 'bad',
      };
    case 'expired':
      return { title: t('Kodun vaxtı bitib'), body: t('Day-pass yalnız alındığı gün keçərlidir.'), tone: 'bad' };
    case 'refunded':
      return { title: t('Bu day-pass ləğv edilib'), body: t('Kod artıq keçərli deyil.'), tone: 'bad' };
    default:
      return {
        title: t('Belə kod tapılmadı'),
        body: t('Kodu bir də yoxla. Başqa zalın kodu da burada görünmür — hər zal yalnız öz day-passlarını yoxlaya bilir.'),
        tone: 'bad',
      };
  }
};

export default function GymPass() {
  const t = useT();
  const state = useMyGym();
  const gym = state.gym;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<null | 'check' | 'redeem'>(null);
  const [result, setResult] = useState<PassCheck | null>(null);
  /* A failed request is not «kod tapılmadı» — that would send a paying visitor
     away over a dropped connection. */
  const [failed, setFailed] = useState(false);

  if (!gym) {
    return (
      <Screen edges={['top', 'bottom']}>
        <NavBar title={t('Day-pass yoxla')} />
        <GymGate state={state} />
      </Screen>
    );
  }

  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  const run = async (what: 'check' | 'redeem') => {
    setBusy(what);
    setFailed(false);
    try {
      const r = what === 'check' ? await checkDayPass(clean) : await redeemDayPass(clean);
      setResult(r);
      if (r.state === 'valid' || r.state === 'redeemed') successFeedback();
      else errorFeedback();
      if (what === 'redeem' && r.state === 'redeemed') toast(t('Day-pass təsdiqləndi'));
    } catch {
      setResult(null);
      setFailed(true);
      toast(t('Kod yoxlanılmadı — internet bağlantısını yoxla'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const info = result ? stateText(result) : null;
  const toneColor = info?.tone === 'ok' ? palette.voltDeep : palette.red;

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={t('Day-pass yoxla')} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <AppText variant="body" color={palette.textSecondary} style={{ lineHeight: 22 }}>
          {t(
            'Qonaq telefonundakı 6 simvollu kodu göstərir. Kodu bura yaz və yoxla — {gym} üçün verilmiş day-passları yalnız sən görürsən.',
            { gym: gym.name }
          )}
        </AppText>

        <TextInput
          value={code}
          onChangeText={(t) => {
            setCode(t.toUpperCase().slice(0, 8));
            setResult(null);
            setFailed(false);
          }}
          placeholder="A1B2C3"
          placeholderTextColor={palette.caption}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          style={styles.input}
        />

        <Button
          title={busy === 'check' ? t('Yoxlanılır…') : t('Yoxla')}
          full
          disabled={clean.length < 4 || !!busy}
          onPress={() => run('check')}
          style={{ marginTop: 14 }}
        />

        {failed ? (
          <View style={styles.card}>
            <AppText variant="headline">{t('Yoxlanmadı')}</AppText>
            <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
              {t('Sorğu serverə çatmadı — bu, kodun səhv olduğu demək DEYİL. Bağlantını yoxla və yenidən yoxla.')}
            </AppText>
          </View>
        ) : null}

        {info ? (
          <View style={[styles.card, { borderColor: toneColor }]}>
            <View style={styles.cardHead}>
              <Icon name={info.tone === 'ok' ? 'check' : 'x'} size={18} color={toneColor} />
              <AppText variant="headline">{info.title}</AppText>
            </View>
            <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 4, lineHeight: 19 }}>
              {info.body}
            </AppText>
            {result?.price ? (
              <AppText variant="footnote" color={palette.text3} style={{ marginTop: 8, lineHeight: 19 }}>
                {t(
                  'Zalın day-pass qiyməti: {price} ₼ — ödəniş zalda alınır. SPOT pul qəbul etmir və komissiya tutmur.',
                  { price: result.price }
                )}
              </AppText>
            ) : null}
            {result?.state === 'valid' ? (
              <Button
                title={busy === 'redeem' ? t('Təsdiqlənir…') : t('Təsdiqlə və istifadə olunmuş kimi qeyd et')}
                full
                disabled={!!busy}
                onPress={() => run('redeem')}
                style={{ marginTop: 14 }}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.screen, paddingBottom: 40 },
  input: {
    marginTop: 18,
    backgroundColor: palette.white,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: palette.separator,
    paddingVertical: 16,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 6,
    color: palette.inkText,
  },
  card: {
    marginTop: 18,
    backgroundColor: palette.white,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.separator,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
