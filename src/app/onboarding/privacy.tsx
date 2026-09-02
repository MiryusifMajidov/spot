import { useRouter } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { OnboardingScaffold } from '@/components/onboarding/OnboardingScaffold';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

function ToggleRow({ title, sub, value, onValueChange }: { title: string; sub: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
          {sub}
        </AppText>
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: palette.voltDeep, false: palette.separator }} />
    </View>
  );
}

export default function Privacy() {
  const router = useRouter();
  const visibility = useAppStore((s) => s.visibility);
  const showInGymList = useAppStore((s) => s.showInGymList);
  const setPrivacy = useAppStore((s) => s.setPrivacy);

  return (
    <OnboardingScaffold
      step={6}
      totalSteps={6}
      title="Məxfilik və görünürlük"
      subtitle="Standart olaraq ən qorunan seçim aktivdir. İstədiyin vaxt dəyişə bilərsən."
      onNext={() => router.push('/onboarding/done')}>
      <ToggleRow
        title="Yalnız match olanlar yaza bilər"
        sub="Sən qəbul etməyincə heç kim birbaşa mesaj yaza bilməz. Zal üzvünə isə bir dəfə 'sual' formatı ilə yazmaq olar."
        value={visibility === 'match-only'}
        onValueChange={(v) => setPrivacy({ visibility: v ? 'match-only' : 'everyone' })}
      />
      <ToggleRow
        title="Zalda göründüyümü göstər"
        sub="Yalnız check-in etdiyin müddətdə 'indi zalda' siyahısında görünürsən — daimi lokasiya izləmə yoxdur."
        value={showInGymList}
        onValueChange={(v) => setPrivacy({ showInGymList: v })}
      />
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.white, borderRadius: 14, padding: 16, marginBottom: 12 },
});
