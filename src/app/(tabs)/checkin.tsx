import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Linking, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAuthGate } from '@/lib/authGate';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { t } from '@/lib/i18n';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useDb } from '@/store/db';
import { palette, spacing, inputTint } from '@/theme';

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
  if (m.includes('checkin_bad_code')) return t('Bu QR SPOT-a aid deyil və ya zal artıq kodu dəyişib. Resepsiyadan soruş.');
  if (m.includes('checkin_already_today')) return t('Bu gün artıq check-in etmisən. Gündə bir dəfə sayılır.');
  if (m.includes('checkin_closed')) return t('Zal indi bağlıdır — check-in yalnız iş saatlarında sayılır.');
  if (m.includes('checkin_sanctioned')) return t('Hesabına məhdudiyyət qoyulub. Dəstəyə yaz.');
  if (m.includes('checkin_not_signed_in')) return t('Check-in üçün hesab lazımdır.');
  return t('Check-in alınmadı — bağlantını yoxla və yenidən cəhd et.');
}

export default function CheckIn() {
  const router = useRouter();
  const t = useT();
  const gate = useAuthGate();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ k: 'scanning' });
  const [typing, setTyping] = useState(false);
  const [manual, setManual] = useState('');
  const checkInLocal = useDb((s) => s.checkIn);

  /* «Ayarları aç» hands the person to the system settings app, and nothing tells
     this screen when they come back — the permission hook reads the status once,
     on mount. So it is read again on every return to the foreground: switching the
     camera on there opens the camera here, instead of the same dead screen. */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);

  /* The bottom of this screen is the fallback (the link, then the typed-code row),
     and it differs per platform, so it is not a Screen edge. Android's Material tab
     bar reserves its own space — the tab scene already stops above it, and
     `insets.bottom` there is the system navigation bar the tab bar covers. iOS 26's
     Liquid Glass bar FLOATS and reserves nothing: the link sat under the glass and
     the fallback for a broken camera could not be reached. Inside a tab screen
     UIKit's safe area includes that bar, so on iOS the footer pads by exactly
     `insets.bottom`.

     The typed-code row also has to clear the keyboard it opens (autoFocus). iOS is
     left to KeyboardAvoidingView, which animates with the keyboard. It measures
     itself with onLayout — relative to its PARENT, which starts `insets.top` below
     the top of the screen — so the offset adds that back; and it hands back
     `bottomClearance`, because with the keyboard up the glass bar is behind it and
     the row must not still stand one bar-height above the keys. Android
     edge-to-edge never resizes the window, so KeyboardAvoidingView is inert there
     and the measured overlap lifts the footer instead. The row's own vertical
     padding is the air above the keys on both. */
  const insets = useSafeAreaInsets();
  const bottomClearance = Platform.OS === 'ios' ? insets.bottom : 0;
  const keyboardOffset = insets.top - bottomClearance;
  const measuredLift = useKeyboardLift();
  const lift = Platform.OS === 'android' ? measuredLift : 0;

  /* A QR in front of a camera fires `onBarcodeScanned` many times a second. The
     ref — not state — is what stops the second frame from starting a second
     request, because state has not re-rendered yet when it arrives. */
  const busy = useRef(false);

  const onScan = useCallback(
    (code: string) => {
      if (busy.current) return;
      busy.current = true;
      // The answer replaces the typed-code row, and Android can leave the keys up
      // over it — for a typed code AND for a scan that lands while the row is open.
      Keyboard.dismiss();
      gate(() => {
        void (async () => {
          if (!hasSupabaseConfig) {
            setPhase({ k: 'failed', message: t('Server bağlantısı yoxdur.') });
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
          setPhase({ k: 'done', gym: row.gym_name || t('Zal') });
        })();
      }, t('Check-in etmək üçün'));
    },
    [gate, checkInLocal, t]
  );

  const again = () => {
    busy.current = false;
    setManual('');
    setPhase({ k: 'scanning' });
  };

  /* Typing the code. The gym's own QR screen tells the owner «QR oxunmasa,
     üzv bu kodu əl ilə də yaza bilər», and this link used to answer that
     with a toast telling the member to ask reception for the code — which
     they had, and had nowhere to type. A cracked lens, a denied camera,
     bad light at the desk: the code under the QR is the fallback, and now
     it goes somewhere. Same server call as a scan. It sits under the camera
     AND under the «kamera lazımdır» screen — a person who refused the camera
     used to get a dead end there, with the code in front of them. */
  const fallback = (
    <View style={{ paddingBottom: bottomClearance, marginBottom: lift }}>
      {typing ? (
        <View style={styles.manual}>
          <TextInput {...inputTint}
            value={manual}
            onChangeText={(v) => setManual(v.replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 10))}
            placeholder="A1B2C3D4E5"
            placeholderTextColor={palette.caption}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={10}
            accessibilityLabel={t('Zal kodu')}
            style={styles.manualInput}
          />
          <Button
            title={t('Göndər')}
            disabled={manual.length < 10 || phase.k === 'sending'}
            onPress={() => onScan(manual)}
          />
        </View>
      ) : (
        <PressableScale haptic={false} onPress={() => setTyping(true)} accessibilityRole="button" style={styles.noQr}>
          <AppText variant="subhead" color={palette.inkText} style={{ fontWeight: '600' }}>
            {t('QR oxunmur? Kodu əl ilə yaz')}
          </AppText>
        </PressableScale>
      )}
    </View>
  );

  /* 'top' only — the bottom is the fallback's job (see `bottomClearance`). A bottom
     edge here would also move the frame KeyboardAvoidingView measures against and
     break `keyboardOffset`. */
  const withFallback = (body: ReactNode) => (
    <Screen edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}>
        {body}
        {fallback}
      </KeyboardAvoidingView>
    </Screen>
  );

  // ---- permission not decided yet -------------------------------------------
  if (!permission) {
    return (
      <Screen>
        <View style={styles.center}>
          <AppText variant="body" color={palette.textSecondary}>
            {t('Kamera hazırlanır…')}
          </AppText>
        </View>
      </Screen>
    );
  }

  // ---- after a scan ----------------------------------------------------------
  /* Ahead of the permission check: a code typed on the «kamera lazımdır» screen
     lands here too, and behind that check its answer was never shown. */
  if (phase.k === 'done' || phase.k === 'failed') {
    const ok = phase.k === 'done';
    return (
      <Screen>
        <View style={styles.center}>
          <View style={[styles.badge, { backgroundColor: ok ? palette.volt : 'rgba(255,59,48,0.12)' }]}>
            <Icon name={ok ? 'check' : 'x'} size={30} color={ok ? palette.ink : palette.red} />
          </View>
          <AppText variant="title2" center style={{ marginTop: 16 }}>
            {ok ? t('Check-in edildi') : t('Alınmadı')}
          </AppText>
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 300, lineHeight: 21 }}>
            {ok ? phase.gym : phase.message}
          </AppText>
          {/* «Bağla» resets before leaving: this is a tab, it stays mounted, and the
              next visit — tomorrow, say — would otherwise open on this old «Check-in
              edildi» instead of the camera. The typed-code row closes too: its
              autoFocus would otherwise raise the keyboard over the tab being opened. */}
          <Button
            title={ok ? t('Bağla') : t('Yenidən oxut')}
            onPress={
              ok
                ? () => {
                    setTyping(false);
                    again();
                    router.back();
                  }
                : again
            }
            style={{ marginTop: 20 }}
          />
          {ok ? (
            // An 18pt line of text; the slop makes it the 44pt target a thumb needs.
            <PressableScale
              haptic={false}
              onPress={again}
              accessibilityRole="button"
              hitSlop={{ top: 12, bottom: 14, left: 16, right: 16 }}
              style={{ marginTop: 12 }}>
              <AppText variant="subhead" color={palette.inkText} style={{ fontWeight: '600' }}>
                {t('Başqa kod oxut')}
              </AppText>
            </PressableScale>
          ) : null}
        </View>
      </Screen>
    );
  }

  if (!permission.granted) {
    return withFallback(
      <View style={styles.center}>
        <Icon name="qr" size={34} color={palette.tertiary} />
        <AppText variant="title3" center style={{ marginTop: 14 }}>
          {t('Check-in üçün kamera lazımdır')}
        </AppText>
        <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 290, lineHeight: 21 }}>
          {t('Zalın resepsiyasındakı QR kodu oxuyuruq. Kamera yalnız bu ekranda işləyir, şəkil saxlanılmır.')}
        </AppText>
        {/* Once the camera has been refused the system will not ask again (iOS after a
            single «Don't Allow»), and requesting just returns «denied» with no dialog —
            so «Ayarları aç» used to be a button that did nothing. It opens Settings. */}
        <Button
          title={permission.canAskAgain ? t('Kameraya icazə ver') : t('Ayarları aç')}
          onPress={() => {
            if (permission.canAskAgain) void requestPermission();
            else void Linking.openSettings();
          }}
          style={{ marginTop: 18 }}
        />
      </View>
    );
  }

  // ---- the camera ------------------------------------------------------------
  return withFallback(
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
          {phase.k === 'sending' ? t('Yoxlanılır…') : t('Resepsiyadakı QR kodu çərçivəyə tut')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  /* White with a hairline, like every other field in the app: `grouped` is this
     screen's own background (colors.bg), so the field used to be invisible. */
  manualInput: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.separator,
    paddingHorizontal: 14,
    fontSize: 17,
    letterSpacing: 2,
    color: palette.inkText,
  },
  badge: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});
