import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toast } from '@/store/ui';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { getGym } from '@/data/mock';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

export default function Done() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const complete = useAppStore((s) => s.completeOnboarding);
  const saveProfile = useAppStore((s) => s.saveProfile);

  const [saving, setSaving] = useState(false);

  const homeGym = profile.homeGymId ? getGym(profile.homeGymId) : null;

  const start = async () => {
    if (saving) return;
    setSaving(true);
    const result = await saveProfile();
    setSaving(false);

    // Tell the truth about where the profile ended up — never claim a save that didn't happen.
    if (result === 'failed') {
      toast('Profil yadda saxlanılmadı. İnternet bağlantını yoxla və yenidən cəhd et.', 'error');
      return; // stay here so the user can retry
    }
    if (result === 'local') {
      toast('Profil hələlik yalnız bu cihazda saxlanıldı.', 'info');
    }
    complete();
    router.replace('/(tabs)/discover');
  };

  return (
    <Screen edges={['top', 'bottom']} padded>
      <View style={styles.center}>
        <Animated.View entering={FadeInDown.duration(300)} style={styles.disc}>
          <Icon name="check" size={40} color={palette.inkText} />
        </Animated.View>
        <AppText variant="title" style={{ marginTop: 24 }} center>
          Hər şey hazırdır
        </AppText>
        <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 300 }}>
          Profilin quruldu. İndi zalını, yoldaşını və proqramlarını kəşf et.
        </AppText>

        <View style={styles.recap}>
          <RecapRow icon="pin" label="Zal" value={homeGym ? homeGym.name : 'Evdə məşq'} />
          <View style={styles.sep} />
          <RecapRow icon="target" label="Məqsəd" value={profile.goals[0] ?? 'Seçilməyib'} />
          <View style={styles.sep} />
          <RecapRow icon="flame" label="Səviyyə" value={profile.level || 'seçilməyib'} />
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          title={saving ? 'Yadda saxlanılır…' : 'SPOT-a başla'}
          onPress={start}
          disabled={saving}
          notify
          full
        />
      </View>
    </Screen>
  );
}

function RecapRow({ icon, label, value }: { icon: 'pin' | 'target' | 'flame'; label: string; value: string }) {
  return (
    <View style={styles.recapRow}>
      <View style={styles.recapIcon}>
        <Icon name={icon} size={17} color={palette.voltDeep} />
      </View>
      <AppText variant="body" color={palette.textSecondary} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="headline">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 96, height: 96, borderRadius: 48, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  recap: { alignSelf: 'stretch', backgroundColor: palette.grouped, borderRadius: 16, paddingHorizontal: 16, marginTop: 32 },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  recapIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  footer: { gap: 10, paddingBottom: 6 },
});
