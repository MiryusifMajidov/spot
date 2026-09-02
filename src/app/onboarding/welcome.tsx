import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { useAppStore } from '@/store/appStore';
import { dark, palette } from '@/theme';

export default function Welcome() {
  const router = useRouter();
  const enterGuest = useAppStore((s) => s.enterGuest);

  const browseAsGuest = () => {
    enterGuest();
    router.replace('/(tabs)/discover');
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
            <AppText style={styles.subtitle}>Zalını seç, məşq yoldaşını tap, hər məşqini qeyd et.</AppText>
          </View>
        </View>

        <View style={styles.actions}>
          {/* No Apple / phone sign-in is wired yet, so the button must not claim one. */}
          <PressableScale onPress={() => router.push('/onboarding/goal')} style={[styles.btn, { backgroundColor: palette.white }]}>
            <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>Başla</AppText>
          </PressableScale>
          <PressableScale haptic={false} onPress={browseAsGuest} style={styles.guestBtn}>
            <AppText style={{ fontSize: 15, fontWeight: '600', color: palette.volt }}>Qonaq kimi bax</AppText>
            <Icon name="chevR" size={16} color={palette.volt} />
          </PressableScale>
          <AppText style={styles.terms}>
            Davam etməklə İstifadə şərtləri və Məxfilik siyasəti ilə razılaşırsan.
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
  subtitle: { fontSize: 16, lineHeight: 24, color: dark.textSecondary, textAlign: 'center', maxWidth: 290, marginTop: 12 },
  actions: { gap: 10, paddingBottom: 8 },
  btn: { height: 52, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 44 },
  terms: { fontSize: 11.5, lineHeight: 17, color: dark.textTertiary, textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
});
