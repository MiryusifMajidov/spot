import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OnboardingScaffold } from '@/components/onboarding/OnboardingScaffold';
import { SelectCard } from '@/components/onboarding/SelectCard';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { DAYS, TIME_SLOTS } from '@/data/mock';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

export default function Schedule() {
  const router = useRouter();
  const days = useAppStore((s) => s.profile.days);
  const timeSlot = useAppStore((s) => s.profile.timeSlot);
  const setProfile = useAppStore((s) => s.setProfile);
  const next = () => router.push('/onboarding/gym');

  const toggleDay = (i: number) =>
    setProfile({ days: days.includes(i) ? days.filter((d) => d !== i) : [...days, i] });

  return (
    <OnboardingScaffold step={3} totalSteps={6} title="Nə vaxt məşq edirsən?" onNext={next} onSkip={next} nextDisabled={days.length === 0}>
      <AppText variant="overline" color={palette.caption} style={{ marginBottom: 12 }}>
        Günlər
      </AppText>
      <View style={styles.days}>
        {DAYS.map((d, i) => {
          const on = days.includes(i);
          return (
            <PressableScale key={d} activeScale={0.9} onPress={() => toggleDay(i)} style={[styles.day, { backgroundColor: on ? palette.ink : palette.white, borderColor: on ? palette.ink : palette.separator }]}>
              <AppText style={{ fontSize: 12.5, fontWeight: '600', color: on ? palette.white : palette.text3 }}>{d}</AppText>
            </PressableScale>
          );
        })}
      </View>

      <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 12 }}>
        Vaxt
      </AppText>
      {TIME_SLOTS.map((t) => (
        <SelectCard key={t} label={t} single selected={timeSlot === t} onPress={() => setProfile({ timeSlot: t })} />
      ))}

      {days.length > 0 && timeSlot ? (
        <View style={styles.note}>
          <View style={styles.noteDot} />
          <AppText variant="footnote" color={palette.voltDeep} style={{ fontWeight: '600' }}>
            Bu cədvələ uyğun gələn yoldaşlar sənə əvvəl göstəriləcək.
          </AppText>
        </View>
      ) : null}
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  days: { flexDirection: 'row', gap: 7, justifyContent: 'space-between' },
  day: { flex: 1, aspectRatio: 1, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(198,255,61,0.22)', borderRadius: 12, padding: 12, marginTop: 18 },
  noteDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.voltDeep },
});
