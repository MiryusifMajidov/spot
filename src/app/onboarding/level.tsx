import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { OnboardingScaffold } from '@/components/onboarding/OnboardingScaffold';
import { SelectCard } from '@/components/onboarding/SelectCard';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { LEVELS, WORKOUT_TYPES } from '@/data/mock';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

export default function LevelStep() {
  const router = useRouter();
  const level = useAppStore((s) => s.profile.level);
  const types = useAppStore((s) => s.profile.types);
  const setProfile = useAppStore((s) => s.setProfile);
  const next = () => router.push('/onboarding/schedule');

  const toggleType = (t: string) =>
    setProfile({ types: types.includes(t) ? types.filter((x) => x !== t) : [...types, t] });

  return (
    <OnboardingScaffold step={2} totalSteps={6} title="Səviyyən və məşq tipin" onNext={next} onSkip={next}>
      <AppText variant="overline" color={palette.caption} style={{ marginBottom: 12 }}>
        Səviyyə
      </AppText>
      {LEVELS.map((l) => (
        <SelectCard key={l} label={l} single selected={level === l} onPress={() => setProfile({ level: l })} />
      ))}

      <AppText variant="overline" color={palette.caption} style={{ marginTop: 16, marginBottom: 12 }}>
        Məşq tipi
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {WORKOUT_TYPES.map((t) => (
          <Chip key={t} label={t} selected={types.includes(t)} onPress={() => toggleType(t)} />
        ))}
      </View>
    </OnboardingScaffold>
  );
}
