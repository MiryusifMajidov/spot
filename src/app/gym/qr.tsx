import { Modal, Share, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { GymGate, gymShortCode, useMyGym } from '@/lib/gymOwner';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { useState } from 'react';

export default function GymQR() {
  const state = useMyGym();
  const gym = state.gym;
  const [full, setFull] = useState(false);

  if (!gym) {
    return (
      <Screen edges={['top', 'bottom']}>
        <NavBar title="Zal kodu" />
        <GymGate state={state} />
      </Screen>
    );
  }

  const code = gymShortCode(gym.id);

  const share = async () => {
    try {
      await Share.share({ message: `${gym.name} — SPOT zal kodu: ${code}` });
    } catch {
      toast('Paylaşmaq alınmadı', 'error');
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Zal kodu" />
      <View style={styles.body}>
        {/* HONEST SCOPE: this code is a stable identifier for the gym. The member's
            check-in screen has no code field in this version, so we must NOT say the
            member types or scans it — nothing verifies it. */}
        <AppText variant="body" color={palette.textSecondary} center style={{ lineHeight: 21, marginBottom: 22 }}>
          Bu, {gym.name} zalının SPOT-dakı daimi kodudur və dəyişmir. Onunla zalını tanıtdırırsan: dəstəklə
          yazışanda, çap materialında və ya üzvə «SPOT-da bizi bu kodla tap» deyəndə istifadə et.
        </AppText>

        <PressableScale activeScale={0.98} onPress={() => setFull(true)} style={styles.codeBox}>
          <AppText style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: palette.tertiary }}>
            SPOT ZAL KODU
          </AppText>
          <AppText style={styles.code}>{code}</AppText>
          <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.textSecondary, marginTop: 6 }}>
            {gym.name}
          </AppText>
        </PressableScale>

        <View style={styles.honestBox}>
          <AppText style={{ fontSize: 13.5, fontWeight: '600' }}>Check-in bu koddan asılı deyil</AppText>
          <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 6, lineHeight: 18 }}>
            Bu versiyada üzv check-in-i öz telefonundan, SPOT-un «Check-in» ekranından edir — orada kod yazmaq üçün
            sahə yoxdur və tətbiq bu kodu heç yerdə yoxlamır. Yəni kodu asmaq check-in-i işə salmır və onsuz da
            check-in işləyir. Kodla yoxlama sonrakı versiyada gələcək.
          </AppText>
        </View>

        <View style={{ gap: 10, marginTop: 22, alignSelf: 'stretch' }}>
          <Button title="Ekranda böyük göstər" variant="primary" full onPress={() => setFull(true)} />
          <Button title="Kodu paylaş" variant="secondary" full onPress={share} />
        </View>
      </View>

      <Modal visible={full} animationType="fade" onRequestClose={() => setFull(false)}>
        <View style={styles.fullBg}>
          <AppText style={{ fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.6)' }}>SPOT ZAL KODU</AppText>
          <AppText style={styles.fullCode}>{code}</AppText>
          <AppText style={{ fontSize: 20, fontWeight: '600', color: palette.white, marginTop: 10 }}>{gym.name}</AppText>
          <View style={{ position: 'absolute', bottom: 48, left: 24, right: 24 }}>
            <Button title="Bağla" variant="secondary" full onPress={() => setFull(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.screen, paddingTop: 12, alignItems: 'center' },
  codeBox: { alignSelf: 'stretch', borderRadius: 22, backgroundColor: palette.white, paddingVertical: 32, alignItems: 'center' },
  code: { fontSize: 42, fontWeight: '800', letterSpacing: 3, marginTop: 12 },
  honestBox: { alignSelf: 'stretch', backgroundColor: palette.grouped, borderRadius: 16, padding: 14, marginTop: 16 },
  fullBg: { flex: 1, backgroundColor: palette.inkText, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  fullCode: { fontSize: 64, fontWeight: '800', letterSpacing: 4, color: palette.volt, marginTop: 18, textAlign: 'center' },
});
