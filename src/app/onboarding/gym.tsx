import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { OnboardingScaffold } from '@/components/onboarding/OnboardingScaffold';
import { SelectCard } from '@/components/onboarding/SelectCard';
import { AppText } from '@/components/ui/AppText';
import { useGyms } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';
import { searchKey } from '@/lib/az';

export default function GymStep() {
  const router = useRouter();
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const setProfile = useAppStore((s) => s.setProfile);
  // `homeGymId === null` means BOTH "not chosen yet" and "trains at home", so the
  // explicit choice is tracked here — nothing is pre-selected on a fresh profile.
  const [chose, setChose] = useState(homeGymId !== null);
  const [query, setQuery] = useState('');
  /* The REAL catalogue, not the four seed rows this step used to hard-code. A user
     whose gym is any other one — including every gym an owner created in-app — was
     told «zal tapılmadı» and had to answer "I train at home", which leaves
     homeGymId null and silently locks them out of Kartlar, Yoldaşlar and Həftəlik
     təkliflər, because partners are found strictly by home_gym_id. */
  const gyms = useGyms();

  const next = () => router.push('/onboarding/profile');

  const list = useMemo(() => {
    const q = searchKey(query.trim());
    // `gyms` arrives in the server's arbitrary row order; a picker has to be
    // scannable, so it is sorted by name before anything is filtered out.
    const sorted = [...gyms].sort((a, b) => a.name.localeCompare(b.name, 'az'));
    if (!q) return sorted;
    return sorted.filter((g) => searchKey(g.name).includes(q) || searchKey(g.district).includes(q));
  }, [gyms, query]);

  const pickGym = (id: string) => {
    setProfile({ homeGymId: id });
    setChose(true);
  };

  const pickHome = () => {
    setProfile({ homeGymId: null });
    setChose(true);
  };

  return (
    <OnboardingScaffold
      step={4}
      totalSteps={6}
      title="Zalını seç"
      subtitle="Zalın yoldaş uyğunluğunun mərkəzindədir. Sonra dəyişə bilərsən."
      onNext={next}
      nextDisabled={!chose}>
      <View style={styles.search}>
        <Icon name="search" size={17} color={palette.caption} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Zal axtar"
          placeholderTextColor={palette.caption}
          autoCorrect={false}
          style={styles.searchInput}
        />
      </View>
      {list.map((g) => (
        <SelectCard
          key={g.id}
          label={g.name}
          sublabel={g.distanceKm > 0 ? `${g.district} · ${g.distanceKm} km` : g.district}
          single
          selected={chose && homeGymId === g.id}
          onPress={() => pickGym(g.id)}
        />
      ))}
      {list.length === 0 ? (
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginBottom: 12 }}>
          "{query.trim()}" üzrə zal tapılmadı. Adın yazılışını yoxla. Zalın hələ SPOT-da deyilsə, aşağıdakı
          seçimi işarələ — sonra Profil → Redaktə bölməsindən dəyişə bilərsən.
        </AppText>
      ) : null}
      <SelectCard
        label="Zalım yoxdur — evdə məşq edirəm"
        sublabel="Birbaşa evdə proqramlarına düşürsən"
        single
        selected={chose && homeGymId === null}
        onPress={pickHome}
      />
    </OnboardingScaffold>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: palette.fill, borderRadius: 11, height: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 16, color: palette.inkText, padding: 0 },
});
