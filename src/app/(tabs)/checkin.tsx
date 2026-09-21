import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAuthGate } from '@/lib/authGate';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useDb } from '@/store/db';
import { palette, spacing } from '@/theme';

/**
 * Check-in — scan the QR at the reception desk.
 *
 * This replaces the distance test. That one asked the phone where it was and
 * believed the answer: the screen admitted as much («bu, zalda olduğunun sübutu
 * deyil»), because a coordinate is a number the phone chooses. It also failed
 * the honest case — GPS is weak inside a concrete building, so the person
 * standing at the desk got «Lokasiya vaxtında gəlmədi» while somebody across
 * the road would have passed.
 *
 * The code on the wall is not something a phone can invent. The server holds it
 * (schema74), the gym can rotate it the moment it leaks, and the whole rule is
 * one thing a person can see and understand: point the camera at the sign.
 *
 * Nothing here decides whether the check-in counts. `check_in_with_code` does:
 * the daily limit, the opening hours and any sanction are all enforced there,
 * and this screen only reports what it answered.
 */

type Phase =
  | { k: 'scanning' }
  | { k: 'sending' }
  | { k: 'done'; gym: string }
  | { k: 'failed'; message: string };

/** The server speaks in codes so the app can say it in Azerbaijani. */
function messageFor(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('checkin_bad_code')) return 'Bu QR SPOT-a aid deyil və ya zal artıq kodu dəyişib. Resepsiyadan soruş.';
  if (m.includes('checkin_already_today')) return 'Bu gün artıq check-in etmisən. Gündə bir dəfə sayılır.';
  if (m.includes('checkin_closed')) return 'Zal indi bağlıdır — check-in yalnız iş saatlarında sayılır.';
  if (m.includes('checkin_sanctioned')) return 'Hesabına məhdudiyyət qoyulub. Dəstəyə yaz.';
  if (m.includes('checkin_not_signed_in')) return 'Check-in üçün hesab lazımdır.';
  return 'Check-in alınmadı — bağlantını yoxla və yenidən cəhd et.';
}

export default function CheckIn() {
  const router = useRouter();
  const gate = useAuthGate();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ k: 'scanning' });
  const [typing, setTyping] = useState(false);
  const [manual, setManual] = useState('');
  const checkInLocal = useDb((s) => s.checkIn);

  /* A QR in front of a camera fires `onBarcodeScanned` many times a second. The
     ref — not state — is what stops the second frame from starting a second
     request, because state has not re-rendered yet when it arrives. */
  const busy = useRef(false);

  const onScan = useCallback(
    (code: string) => {
      if (busy.current) return;
      busy.current = true;
      gate(() => {
        void (async () => {
          if (!hasSupabaseConfig) {
            setPhase({ k: 'failed', message: 'Server bağlantısı yoxdur.' });
            return;
          }
          setPhase({ k: 'sending' });
          const { data, error } = await supabase.rpc('check_in_with_code', { p_code: code });
          if (error) {
            errorFeedback();
            setPhase({ k: 'failed', message: messageFor(String(error.message ?? '')) });
            return;
          }
          const row = (data ?? {}) as { gym_id?: string; gym_name?: string };
          // The device copy is written only after the server accepted it, so the
          // streak can never count a check-in the server refused.
          if (row.gym_id) checkInLocal(row.gym_id);
          successFeedback();
          setPhase({ k: 'done', gym: row.gym_name || 'Zal' });
        })();
      }, 'Check-in etmək üçün');
    },
    [gate, checkInLocal]
  );

  const again = () => {
    busy.current = false;
    setManual('');
    setPhase({ k: 'scanning' });
  };

  // ---- permission not decided yet -------------------------------------------
  if (!permission) {
    return (
      <Screen>
        <View style={styles.center}>
          <AppText variant="body" color={palette.textSecondary}>
            Kamera hazırlanır…
          </AppText>
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <View style={styles.center}>
          <Icon name="qr" size={34} color={palette.tertiary} />
          <AppText variant="title3" center style={{ marginTop: 14 }}>
            Check-in üçün kamera lazımdır
          </AppText>
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 290, lineHeight: 21 }}>
            Zalın resepsiyasındakı QR kodu oxuyuruq. Kamera yalnız bu ekranda işləyir, şəkil saxlanılmır.
          </AppText>
          <Button
            title={permission.canAskAgain ? 'Kameraya icazə ver' : 'Ayarları aç'}
            onPress={() => void requestPermission()}
            style={{ marginTop: 18 }}
          />
        </View>
      </Screen>
    );
  }

  // ---- after a scan ----------------------------------------------------------
  if (phase.k === 'done' || phase.k === 'failed') {
    const ok = phase.k === 'done';
    return (
      <Screen>
        <View style={styles.center}>
          <View style={[styles.badge, { backgroundColor: ok ? palette.volt : 'rgba(255,59,48,0.12)' }]}>
            <Icon name={ok ? 'check' : 'x'} size={30} color={ok ? palette.ink : palette.red} />
          </View>
          <AppText variant="title2" center style={{ marginTop: 16 }}>
            {ok ? 'Check-in edildi' : 'Alınmadı'}
          </AppText>
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 300, lineHeight: 21 }}>
            {ok ? phase.gym : phase.message}
          </AppText>
          <Button title={ok ? 'Bağla' : 'Yenidən oxut'} onPress={ok ? () => router.back() : again} style={{ marginTop: 20 }} />
          {ok ? (
            <PressableScale haptic={false} onPress={again} style={{ marginTop: 12 }}>
              <AppText variant="subhead" color={palette.blue}>
                Başqa kod oxut
              </AppText>
            </PressableScale>
          ) : null}
        </View>
      </Screen>
    );
  }

  // ---- the camera ------------------------------------------------------------
  return (
    <Screen edges={['top']}>
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={phase.k === 'scanning' ? ({ data }) => onScan(String(data ?? '')) : undefined}
        />
        <View style={styles.frame} pointerEvents="none" />
        <View style={styles.hint} pointerEvents="none">
          <AppText variant="body" center style={{ color: palette.white, lineHeight: 21 }}>
            {phase.k === 'sending' ? 'Yoxlanılır…' : 'Resepsiyadakı QR kodu çərçivəyə tut'}
          </AppText>
        </View>
      </View>
      {/* Typing the code. The gym's own QR screen tells the owner «QR oxunmasa,
          üzv bu kodu əl ilə də yaza bilər», and this link used to answer that
          with a toast telling the member to ask reception for the code — which
          they had, and had nowhere to type. A cracked lens, a denied camera,
          bad light at the desk: the code under the QR is the fallback, and now
          it goes somewhere. Same server call as a scan. */}
      {typing ? (
        <View style={styles.manual}>
          <TextInput
            value={manual}
            onChangeText={(v) => setManual(v.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 10))}
            placeholder="A1B2C3D4E5"
            placeholderTextColor={palette.caption}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={10}
            style={styles.manualInput}
          />
          <Button
            title="Göndər"
            disabled={manual.length < 10 || phase.k === 'sending'}
            onPress={() => onScan(manual)}
          />
        </View>
      ) : (
        <PressableScale haptic={false} onPress={() => setTyping(true)} style={styles.noQr}>
          <AppText variant="subhead" color={palette.blue}>
            QR oxunmur? Kodu əl ilə yaz
          </AppText>
        </PressableScale>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  cameraWrap: { flex: 1, margin: spacing.screen, borderRadius: 20, overflow: 'hidden', backgroundColor: palette.ink },
  frame: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    top: '28%',
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: palette.volt,
    borderRadius: 18,
  },
  hint: { position: 'absolute', left: 24, right: 24, bottom: 28 },
  noQr: { alignSelf: 'center', paddingVertical: 14 },
  manual: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: spacing.screen, paddingVertical: 12 },
  manualInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: palette.grouped,
    paddingHorizontal: 14,
    fontSize: 17,
    letterSpacing: 2,
    color: palette.inkText,
  },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
