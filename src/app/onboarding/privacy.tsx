import { useRouter } from 'expo-router';
import { StyleSheet, Switch, View } from 'react-native';

import { Icon } from '@/components/Icon';
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

/** A rule that is already in force, stated — not offered as a choice. */
function RuleRow({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.ruleIcon}>
        <Icon name="lock" size={18} color={palette.voltDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{title}</AppText>
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
          {sub}
        </AppText>
      </View>
    </View>
  );
}

export default function Privacy() {
  const router = useRouter();
  const showInGymList = useAppStore((s) => s.showInGymList);
  const setPrivacy = useAppStore((s) => s.setPrivacy);

  return (
    <OnboardingScaffold
      step={6}
      totalSteps={6}
      title="Məxfilik və görünürlük"
      subtitle="Aşağıdakı birinci qayda bütün hesablar üçün eynidir. İkincisini istədiyin vaxt dəyişə bilərsən."
      onNext={() => router.push('/onboarding/done')}>
      {/* This was a «Yalnız match olanlar yaza bilər» switch. It wrote
          `profiles.visibility`, which NO policy and NO send path reads — turning it
          off did not open your inbox to anyone, and turning it on protected nothing
          that was not already protected. `open_thread()` (schema42) refuses to create
          a thread without an accepted match or an accepted trainer link, full stop,
          so the rule below is what the database really does. The old sub-text also
          advertised a one-off «sual» channel to a gym member; that channel does not
          exist. The settings screen dropped the same switch for the same reason —
          bring it back only when a send path actually reads `visibility`. */}
      <RuleRow
        title="Yalnız qəbul etdiyin adamlar yaza bilər"
        sub="Söhbət yalnız məşq təklifi və ya məşqçi sorğusu qarşılıqlı qəbul olunanda açılır. Bunu heç kim keçə bilməz."
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
  ruleIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 12,
    backgroundColor: palette.grouped,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
