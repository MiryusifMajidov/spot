import { useRouter } from 'expo-router';

import { OnboardingScaffold } from '@/components/onboarding/OnboardingScaffold';
import { SelectCard } from '@/components/onboarding/SelectCard';
import { GOALS } from '@/data/mock';
import { useAppStore } from '@/store/appStore';

export default function Goal() {
  const router = useRouter();
  const goals = useAppStore((s) => s.profile.goals);
  const setProfile = useAppStore((s) => s.setProfile);
  const next = () => router.push('/onboarding/level');

  const toggle = (g: string) =>
    setProfile({ goals: goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g] });

  return (
    <OnboardingScaffold
      step={1}
      totalSteps={6}
      title="Məqsədin nədir?"
      subtitle="Bir və ya bir neçəsini seç — yoldaş uyğunluğu bu parametrlərə görə qurulur."
      onNext={next}
      onSkip={next}
      nextDisabled={goals.length === 0}
      nextLabel={goals.length ? `Davam et · ${goals.length}` : 'Davam et'}>
      {GOALS.map((g) => (
        <SelectCard key={g} label={g} selected={goals.includes(g)} onPress={() => toggle(g)} />
      ))}
    </OnboardingScaffold>
  );
}
