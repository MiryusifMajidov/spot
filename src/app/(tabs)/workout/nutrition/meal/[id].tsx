import { useLocalSearchParams, useRouter } from 'expo-router';
import { successFeedback } from '@/lib/feedback';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PlaceholderImage } from '@/components/PlaceholderImage';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAuthGate } from '@/lib/authGate';
import { useMeals } from '@/lib/hooks';
import { useDb, useNutritionToday } from '@/store/db';
import { palette, spacing } from '@/theme';

export default function MealDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gate = useAuthGate();
  const meals = useMeals();
  const meal = meals.find((m) => m.id === id);
  const eatenIds = useNutritionToday().eaten;
  const eaten = eatenIds.includes(id);
  const toggleMeal = useDb((s) => s.toggleMeal);

  // Real alternatives: the closest meals by macros, ranked — with the honest
  // difference shown, not a "təklif olundu" toast.
  const alternatives = useMemo(() => {
    if (!meal) return [];
    return meals
      .filter((m) => m.id !== meal.id)
      .map((m) => ({
        meal: m,
        dist: Math.abs(m.kcal - meal.kcal) / Math.max(1, meal.kcal) + Math.abs(m.protein - meal.protein) / Math.max(1, meal.protein),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3)
      .map((x) => x.meal);
  }, [meals, meal]);

  if (!meal) return null;

  const swap = (toId: string) =>
    gate(() => {
      successFeedback();
      if (eaten) toggleMeal(meal.id); // the planned meal is no longer what I ate
      if (!eatenIds.includes(toId)) toggleMeal(toId);
      router.replace({ pathname: '/(tabs)/workout/nutrition/meal/[id]', params: { id: toId } });
    }, 'Yeməyi dəyişmək üçün');

  const diff = (a: number, b: number, unit: string) => {
    const d = Math.round(a - b);
    return `${d > 0 ? '+' : ''}${d} ${unit}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <Screen edges={['top']} style={{ backgroundColor: 'transparent' }}>
        <NavBar />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <PlaceholderImage height={160} icon="meal" colors={['#D6D6DC', '#EFEFF2']} style={styles.hero} />
          <AppText variant="title" style={{ marginTop: 16 }}>
            {meal.name}
          </AppText>
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 4 }}>
            {meal.time} · {meal.kcal} kkal
          </AppText>

          <View style={styles.macros}>
            <Macro label="Protein" value={`${meal.protein} q`} />
            <Macro label="Karb" value={`${meal.carb} q`} />
            <Macro label="Yağ" value={`${meal.fat} q`} />
          </View>

          <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 10 }}>
            Tərkib
          </AppText>
          <View style={styles.card}>
            {meal.ingredients.map((ing, i) => (
              <View key={ing}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <View style={styles.ingRow}>
                  <View style={styles.dot} />
                  <AppText variant="body">{ing}</AppText>
                </View>
              </View>
            ))}
          </View>

          {/* Alternatives — real meals from the plan, with the real difference */}
          <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 10 }}>
            Bəyənmirsən? Bunlarla əvəz et
          </AppText>
          {alternatives.length ? (
            alternatives.map((alt) => (
              <PressableScale key={alt.id} activeScale={0.98} onPress={() => swap(alt.id)} style={styles.altRow}>
                <View style={styles.altIcon}>
                  <Icon name="meal" size={17} color={palette.voltDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="callout">{alt.name}</AppText>
                  <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
                    {alt.kcal} kkal ({diff(alt.kcal, meal.kcal, 'kkal')}) · protein {diff(alt.protein, meal.protein, 'q')}
                  </AppText>
                </View>
                <Icon name="chevR" size={18} color={palette.tertiary} />
              </PressableScale>
            ))
          ) : (
            <View style={styles.altEmpty}>
              <AppText variant="footnote" color={palette.caption} style={{ lineHeight: 18 }}>
                Planda başqa yemək yoxdur. Öz yeməyini "Qida" səhifəsindən əlavə edə bilərsən.
              </AppText>
            </View>
          )}

          <Button
            title={eaten ? 'Yeyildi ✓' : 'Yedim'}
            variant={eaten ? 'secondary' : 'primary'}
            full
            onPress={() =>
              gate(() => {
                successFeedback();
                toggleMeal(id);
              }, 'Qidanı qeyd etmək üçün')
            }
            style={{ marginTop: 16 }}
          />
        </ScrollView>
      </Screen>
    </View>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macro}>
      <AppText variant="title3">{value}</AppText>
      <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  hero: { borderRadius: 18, overflow: 'hidden', marginTop: 8 },
  macros: { flexDirection: 'row', gap: 10, marginTop: 16 },
  macro: { flex: 1, backgroundColor: palette.white, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  card: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.voltDeep },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  altRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14, marginBottom: 10 },
  altIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  altEmpty: { backgroundColor: palette.white, borderRadius: 14, padding: 14 },
});
