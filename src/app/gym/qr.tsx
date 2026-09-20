import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { GymGate, useMyGym } from '@/lib/gymOwner';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/**
 * The gym's check-in QR.
 *
 * Members check in by scanning this, and nothing else — the distance rule is
 * gone (schema74). So this code is the gym's door: print it, put it where people
 * walk past the desk, and every scan is somebody who was actually standing there.
 *
 * The code is readable by the owner and nobody else. It is not a column on
 * `gyms` for exactly that reason: that table has a table-level SELECT grant, and
 * a table grant defeats any column-level revoke, so a code stored there would be
 * readable by every signed-in person in the country — who could then check in
 * from home forever. It lives in `gym_checkin_codes`, behind an owner-only
 * policy, and the scan is resolved by a SECURITY DEFINER function.
 *
 * Rotating is the answer to a leak: a photo of the old sign stops working the
 * moment a new code is generated.
 */

type State =
  | { k: 'loading' }
  | { k: 'none' }
  | { k: 'ready'; code: string }
  | { k: 'failed' };

export default function GymQr() {
  const state = useMyGym();
  const gym = state.gym;
  /* Hoisted so the memo's written dependency and the one the compiler infers are
     the same expression — `gym?.id` inside the body with `[gym?.id]` in the list
     reads as two different things to it, and the whole memo is then dropped. */
  const gymId = gym?.id;
  const [code, setCode] = useState<State>({ k: 'loading' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!hasSupabaseConfig || !gymId) {
      setCode({ k: 'failed' });
      return;
    }
    let alive = true;
    void (async () => {
      const { data, error } = await supabase
        .from('gym_checkin_codes')
        .select('code')
        .eq('gym_id', gymId)
        .maybeSingle();
      if (!alive) return;
      // A read that failed is not «this gym has no code» — saying the second
      // would push the owner into generating a new one and invalidating the
      // sign already on their wall.
      if (error) setCode({ k: 'failed' });
      else if (data?.code) setCode({ k: 'ready', code: String(data.code) });
      else setCode({ k: 'none' });
    })();
    return () => {
      alive = false;
    };
  }, [gymId]);

  useFocusEffect(load);

  const rotate = async () => {
    if (!gym?.id || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('gym_rotate_checkin_code', { p_gym_id: gym.id });
    setBusy(false);
    if (error || !data) {
      errorFeedback();
      toast('Kod yaradılmadı — bağlantını yoxla və yenidən cəhd et', 'error');
      return;
    }
    successFeedback();
    setCode({ k: 'ready', code: String(data) });
    toast('Yeni kod hazırdır — köhnə çap artıq işləmir');
  };

  const askRotate = () =>
    confirm(
      'Yeni kod yaradılsın?',
      'Divardakı köhnə QR həmin an işləməyi dayandırır. Yenisini çap edib asmalısan.',
      [
        { label: 'Ləğv et', style: 'cancel' },
        { label: 'Yenilə', style: 'destructive', onPress: () => void rotate() },
      ]
    );

  if (!gym) return <GymGate state={state} />;

  return (
    <Screen edges={['top']}>
      <NavBar title="Zal kodu" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {code.k === 'ready' ? (
            <>
              <View style={styles.qrBox}>
                <QRCode value={code.code} size={210} backgroundColor="#FFFFFF" color={palette.ink} />
              </View>
              <AppText variant="title3" style={{ marginTop: 18, letterSpacing: 2 }}>
                {code.code}
              </AppText>
              <AppText variant="caption" color={palette.caption} center style={{ marginTop: 6, lineHeight: 17 }}>
                QR oxunmasa, üzv bu kodu əl ilə də yaza bilər.
              </AppText>
            </>
          ) : code.k === 'loading' ? (
            <AppText variant="body" color={palette.textSecondary}>
              Yüklənir…
            </AppText>
          ) : code.k === 'failed' ? (
            <>
              <Icon name="x" size={28} color={palette.red} />
              <AppText variant="headline" center style={{ marginTop: 12 }}>
                Kod yüklənmədi
              </AppText>
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 21 }}>
                Bu, kodun olmadığı demək deyil. Bağlantını yoxla və səhifəni yenidən aç — indi yeni kod yaratsan, divardakı köhnəsi işləməyi dayandırar.
              </AppText>
            </>
          ) : (
            <>
              <Icon name="qr" size={30} color={palette.tertiary} />
              <AppText variant="headline" center style={{ marginTop: 12 }}>
                Hələ kod yoxdur
              </AppText>
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 21 }}>
                Kod yarat, çap et və resepsiyaya as. Üzvlər onu oxuyub check-in edəcək.
              </AppText>
            </>
          )}
        </View>

        {code.k === 'none' ? (
          <Button title={busy ? 'Yaradılır…' : 'Kod yarat'} full disabled={busy} onPress={() => void rotate()} style={{ marginTop: 18 }} />
        ) : code.k === 'ready' ? (
          <>
            <Button
              title="Kodu paylaş"
              variant="secondary"
              full
              onPress={() =>
                Share.share({
                  message: `${gym.name} — SPOT check-in kodu: ${code.code}`,
                }).catch(() => {})
              }
              style={{ marginTop: 18 }}
            />
            <PressableScale haptic={false} onPress={askRotate} disabled={busy} style={styles.rotate}>
              <AppText variant="subhead" color={palette.red}>
                {busy ? 'Yenilənir…' : 'Yeni kod yarat'}
              </AppText>
            </PressableScale>
          </>
        ) : null}

        <View style={styles.note}>
          <Icon name="shield" size={17} color={palette.voltDeep} />
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 19 }}>
            Bu kodu yalnız sən görürsən. Onu kim oxuyursa, zalda olduğunu sübut edir — ona görə şəkildə paylaşma, divara as.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  card: {
    backgroundColor: palette.white,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 260,
    justifyContent: 'center',
  },
  qrBox: { padding: 14, backgroundColor: '#FFFFFF', borderRadius: 14 },
  rotate: { alignSelf: 'center', paddingVertical: 16 },
  note: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: palette.grouped,
    borderRadius: 14,
    padding: 14,
    marginTop: 22,
  },
});
