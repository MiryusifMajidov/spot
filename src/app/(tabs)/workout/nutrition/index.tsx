import AsyncStorage from '@react-native-async-storage/async-storage';
import { successFeedback, tapFeedback } from '@/lib/feedback';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Meal } from '@/data/nutrition';
import { useAuthGate } from '@/lib/authGate';
import { useMeals } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { dayKey, useDb, useLatestWeight, useNutritionToday } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * Water, in 250 ml glasses.
 *
 * This was a flat `8` shown to everyone as «sənin hədəfin» — a number nobody
 * measured and nobody set, identical for a 52 kg and a 105 kg person. The usual
 * clinical rule of thumb is ~35 ml per kg of body weight, and the app already
 * knows the user's real logged weight (it is what the calorie target is built
 * from), so the target is derived from the same evidence.
 *
 * With no logged weight there is nothing to derive it from, so the generic
 * figure is used AND labelled as generic, rather than presented as personal.
 */
const GLASS_ML = 250;
const ML_PER_KG = 35;
const GENERIC_WATER_GLASSES = 8;

function waterTargetFor(weightKg: number | null): { glasses: number; basis: string } {
  if (!weightKg) {
    return { glasses: GENERIC_WATER_GLASSES, basis: 'ümumi tövsiyə — çəkini qeyd et, hədəf sənə görə hesablansın' };
  }
  const glasses = Math.max(4, Math.min(16, Math.round((weightKg * ML_PER_KG) / GLASS_ML)));
  return { glasses, basis: `${weightKg} kq × ${ML_PER_KG} ml` };
}

/* ------------------------------------------------------------------ *
 * Personal calorie target — derived from the user's OWN weight + goal.
 * No global 2400 kkal literal: with no logged weight there is no target.
 * ------------------------------------------------------------------ */
export interface DailyTarget {
  kcal: number | null;
  basis: string;
}
export function useDailyTarget(): DailyTarget {
  const goals = useAppStore((s) => s.profile.goals);
  const weight = useLatestWeight();
  return useMemo(() => {
    if (!weight) return { kcal: null, basis: 'Çəkini qeyd et — kalori hədəfin ona görə hesablanacaq' };
    const cut = goals.includes('Arıqlamaq');
    const bulk = goals.includes('Kütlə yığmaq');
    const perKg = cut ? 29 : bulk ? 37 : 33;
    const label = cut ? 'arıqlamaq' : bulk ? 'kütlə yığmaq' : 'forma saxlamaq';
    return { kcal: Math.round((weight * perKg) / 10) * 10, basis: `${weight} kq × ${perKg} kkal · ${label}` };
  }, [goals, weight]);
}

/* ------------------------------------------------------------------ *
 * Foods the user adds themselves (persisted per gym-day on the device).
 * ------------------------------------------------------------------ */
export interface CustomFood {
  id: string;
  name: string;
  kcal: number;
  protein: number;
  carb: number;
  fat: number;
}
const CUSTOM_KEY = 'spot-nutrition-custom';

/* The gym day comes from `dayKey` (src/store/db.ts) — the one function the
   engine, the streak and schema19's `gym_day` column all agree on.
   This file used to carry its own copy that subtracted 4 local hours and then
   read the UTC date, which puts the boundary at 08:00 Baku instead of 04:00. So
   between 04:00 and 08:00 the plan had already rolled over (`useNutritionToday`
   clears the ticked meals and the water on `db.dayKey`) while the custom list
   had not: opening Qida at 06:00 restored yesterday's «Şam — 700 kkal» and the
   ring read «700 / 2100 kkal» before anything had been eaten. */

// One tiny module-level store so every screen that reads today's food sees the
// same list the moment it changes (the engine has no custom-food slot yet).
let customItems: CustomFood[] = [];
/** The gym day `customItems` belongs to. '' until the first read. */
let customDay = '';
let customLoaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Yesterday's entries are not today's. Checked on every read, because
 *  `ensureCustomLoaded` runs ONCE per process: an app left open overnight kept
 *  serving the previous day's food into today's total for as long as it lived. */
function dropStaleDay(): boolean {
  const today = dayKey(new Date());
  if (customDay === today) return false;
  customDay = today;
  if (!customItems.length) return false;
  customItems = [];
  AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify({ day: today, items: [] })).catch(() => {});
  return true;
}

function ensureCustomLoaded() {
  if (customLoaded) return;
  customLoaded = true;
  AsyncStorage.getItem(CUSTOM_KEY)
    .then((raw) => {
      const today = dayKey(new Date());
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        customItems = parsed && parsed.day === today ? (parsed.items as CustomFood[]) : [];
      } catch {
        customItems = [];
      }
      customDay = today;
      emit();
    })
    .catch(() => {});
}

function writeCustom(next: CustomFood[]) {
  customDay = dayKey(new Date());
  customItems = next;
  emit();
  AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify({ day: customDay, items: next })).catch(() => {});
}

export function useCustomFoods() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => customItems,
    () => customItems
  );
  // No dependency array on purpose: this is the day check, and it has to happen
  // on every read rather than once when the screen first mounted.
  useEffect(() => {
    ensureCustomLoaded();
    if (dropStaleDay()) emit();
  });

  const add = useCallback((f: Omit<CustomFood, 'id'>) => writeCustom([...customItems, { ...f, id: `f-${Date.now()}` }]), []);
  const remove = useCallback((id: string) => writeCustom(customItems.filter((i) => i.id !== id)), []);

  return { items, add, remove };
}

/** Everything eaten today: plan meals ticked + the user's own entries. */
export function useNutritionSummary() {
  const today = useNutritionToday();
  const { items } = useCustomFoods();
  const target = useDailyTarget();
  return useMemo(() => {
    const extra = items.reduce(
      (a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carb: a.carb + i.carb, fat: a.fat + i.fat }),
      { kcal: 0, protein: 0, carb: 0, fat: 0 }
    );
    return {
      consumed: today.consumed + extra.kcal,
      protein: today.protein + extra.protein,
      carb: today.carb + extra.carb,
      fat: today.fat + extra.fat,
      water: today.water,
      eaten: today.eaten,
      target: target.kcal,
      basis: target.basis,
    };
  }, [today, items, target]);
}

export default function Nutrition() {
  const router = useRouter();
  const gate = useAuthGate();
  const meals = useMeals();
  // The same logged weight the calorie target is built from — no second source.
  const myWeight = useLatestWeight();
  const mealsTotal = useMemo(() => meals.reduce((n, m) => n + (m.kcal ?? 0), 0), [meals]);
  const today = useNutritionToday();
  const custom = useCustomFoods();
  const summary = useNutritionSummary();
  const toggleMeal = useDb((s) => s.toggleMeal);
  const addWater = useDb((s) => s.addWater);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', kcal: '', protein: '', carb: '', fat: '' });

  /* The add-your-own-food form is the very last thing in a long scroller, and Android
     edge-to-edge does not resize the window when the keyboard opens: at full scroll the
     kkal/protein/karb/yağ row and both buttons still sat underneath it, with no scroll
     left to reach them. Shrink the scroller by the overlap, then push the content up by
     the same amount so the field just tapped stays exactly where it was. */
  const lift = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lifted = useRef(0);
  useEffect(() => {
    const delta = lift - lifted.current;
    lifted.current = lift;
    if (delta > 0) scroller.current?.scrollTo({ y: scrollY.current + delta, animated: true });
  }, [lift]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };
  // Bring the freshly opened form on screen before the first tap lands in it.
  useEffect(() => {
    if (adding) scroller.current?.scrollToEnd({ animated: true });
  }, [adding]);

  const pct = summary.target ? Math.min(1, summary.consumed / summary.target) : 0;
  const waterGoal = waterTargetFor(myWeight);
  const waterDots = Math.max(waterGoal.glasses, summary.water);

  const eat = (id: string) =>
    gate(() => {
      successFeedback();
      toggleMeal(id);
    }, 'Qidanı qeyd etmək üçün');

  const water = (d: number) =>
    gate(() => {
      tapFeedback();
      addWater(d);
    }, 'Su qeyd etmək üçün');

  const submit = () =>
    gate(() => {
      const kcal = Number(form.kcal);
      if (!form.name.trim() || !kcal) {
        toast('Ad və kalori lazımdır', 'error');
        return;
      }
      custom.add({
        name: form.name.trim(),
        kcal,
        protein: Number(form.protein) || 0,
        carb: Number(form.carb) || 0,
        fat: Number(form.fat) || 0,
      });
      setForm({ name: '', kcal: '', protein: '', carb: '', fat: '' });
      setAdding(false);
      successFeedback();
    }, 'Yemək əlavə etmək üçün');

  return (
    <Screen>
      <NavBar title="Qida" />
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        style={{ marginBottom: lift }}
        onScroll={onScroll}
        scrollEventThrottle={16}>
        {/* Calorie summary */}
        <View style={styles.summary}>
          <View style={styles.calRow}>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 30, fontWeight: '700', letterSpacing: -0.8 }}>
                {summary.consumed}
                <AppText style={{ fontSize: 16, fontWeight: '500', color: palette.caption }}>
                  {summary.target ? ` / ${summary.target} kkal` : ' kkal'}
                </AppText>
              </AppText>
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
                {summary.target ? `${Math.max(0, summary.target - summary.consumed)} kkal qalıb · ${summary.basis}` : summary.basis}
              </AppText>
            </View>
          </View>
          {summary.target ? (
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
            </View>
          ) : (
            <PressableScale activeScale={0.97} onPress={() => router.push('/(tabs)/workout/weight')} style={styles.targetCta}>
              <Icon name="scale" size={16} color={palette.inkText} />
              <AppText variant="subhead" style={{ fontWeight: '600' }}>Çəkini qeyd et</AppText>
            </PressableScale>
          )}
          <View style={styles.macros}>
            <Macro label="Protein" value={`${summary.protein}q`} />
            <Macro label="Karb" value={`${summary.carb}q`} />
            <Macro label="Yağ" value={`${summary.fat}q`} />
          </View>
        </View>

        {/* Water tracker */}
        <View style={styles.water}>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">
              Su · {summary.water} / {waterGoal.glasses} stəkan{summary.water >= waterGoal.glasses ? ' ✓' : ''}
            </AppText>
            <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
              {waterGoal.basis}
            </AppText>
            <View style={styles.waterDots}>
              {Array.from({ length: waterDots }).map((_, i) => (
                <View key={i} style={[styles.waterDot, i < summary.water && styles.waterDotOn]} />
              ))}
            </View>
          </View>
          <PressableScale activeScale={0.9} haptic={false} onPress={() => water(-1)} style={styles.waterBtn}>
            <Icon name="x" size={16} color={palette.textSecondary} />
          </PressableScale>
          <PressableScale activeScale={0.9} haptic={false} onPress={() => water(1)} style={[styles.waterBtn, { backgroundColor: palette.ink }]}>
            <Icon name="plus" size={18} color={palette.white} />
          </PressableScale>
        </View>

        {/* These four meals are the SAME for everybody — one seeded example day.
            They were headed «Bugünkü yeməklər», which reads as a plan built for
            this person: it is not. It knows nothing about their weight, goal,
            calorie target, allergies or whether they train today. So it is
            labelled as what it is, and its total is put next to the person's own
            target so the gap is visible instead of implied away. */}
        <AppText variant="overline" color={palette.caption} style={{ marginTop: 20 }}>
          Nümunə yeməklər
        </AppText>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 4, marginBottom: 12, lineHeight: 17 }}>
          {mealsTotal > 0
            ? summary.target
              ? `Hamı üçün eyni nümunə gün · cəmi ${mealsTotal} kkal, sənin hədəfin ${summary.target} kkal. Yediyini işarələ və ya aşağıda öz yeməyini əlavə et.`
              : `Hamı üçün eyni nümunə gün · cəmi ${mealsTotal} kkal. Yediyini işarələ və ya aşağıda öz yeməyini əlavə et.`
            : 'Yediyini aşağıda əlavə edə bilərsən.'}
        </AppText>
        {meals.map((m) => (
          <MealRow
            key={m.id}
            meal={m}
            eaten={today.eaten.includes(m.id)}
            onEat={() => eat(m.id)}
            onPress={() => router.push({ pathname: '/(tabs)/workout/nutrition/meal/[id]', params: { id: m.id } })}
          />
        ))}

        {/* The user's own entries */}
        {custom.items.length ? (
          <>
            <AppText variant="overline" color={palette.caption} style={{ marginTop: 12, marginBottom: 12 }}>
              Özün əlavə etdin
            </AppText>
            {custom.items.map((f) => (
              <PressableScale
                key={f.id}
                activeScale={0.99}
                haptic={false}
                onPress={() =>
                  confirm('Silinsin?', f.name, [
                    { label: 'Ləğv et', style: 'cancel' },
                    { label: 'Sil', style: 'destructive', onPress: () => custom.remove(f.id) },
                  ])
                }
                style={styles.customRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{f.name}</AppText>
                  <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
                    {f.kcal} kkal · {f.protein}p / {f.carb}k / {f.fat}y
                  </AppText>
                </View>
                <Icon name="x" size={16} color={palette.tertiary} />
              </PressableScale>
            ))}
          </>
        ) : null}

        {/* Add your own food */}
        {adding ? (
          <View style={styles.addCard}>
            <TextInput
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="Nə yedin? (məs: 2 yumurta)"
              placeholderTextColor={palette.caption}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TextInput value={form.kcal} onChangeText={(v) => setForm((f) => ({ ...f, kcal: v }))} placeholder="kkal" placeholderTextColor={palette.caption} keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
              <TextInput value={form.protein} onChangeText={(v) => setForm((f) => ({ ...f, protein: v }))} placeholder="protein" placeholderTextColor={palette.caption} keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
              <TextInput value={form.carb} onChangeText={(v) => setForm((f) => ({ ...f, carb: v }))} placeholder="karb" placeholderTextColor={palette.caption} keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
              <TextInput value={form.fat} onChangeText={(v) => setForm((f) => ({ ...f, fat: v }))} placeholder="yağ" placeholderTextColor={palette.caption} keyboardType="numeric" style={[styles.input, { flex: 1 }]} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <PressableScale activeScale={0.97} onPress={() => setAdding(false)} style={[styles.formBtn, { backgroundColor: palette.grouped }]}>
                <AppText variant="subhead" style={{ fontWeight: '600' }}>Ləğv et</AppText>
              </PressableScale>
              <PressableScale activeScale={0.97} onPress={submit} style={[styles.formBtn, { backgroundColor: palette.ink }]}>
                <AppText variant="subhead" color={palette.white} style={{ fontWeight: '600' }}>Əlavə et</AppText>
              </PressableScale>
            </View>
          </View>
        ) : (
          <PressableScale activeScale={0.98} onPress={() => setAdding(true)} style={styles.shopBtn}>
            <Icon name="plus" size={19} color={palette.inkText} />
            <AppText variant="headline" style={{ flex: 1 }}>
              Öz yeməyini əlavə et
            </AppText>
          </PressableScale>
        )}

        <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/workout/nutrition/shopping')} style={styles.shopBtn}>
          <Icon name="meal" size={19} color={palette.inkText} />
          <AppText variant="headline" style={{ flex: 1 }}>
            Alış-veriş siyahısı
          </AppText>
          <Icon name="chevR" size={18} color={palette.tertiary} />
        </PressableScale>
      </ScrollView>
    </Screen>
  );
}

function Macro({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macro}>
      <AppText style={{ fontSize: 15, fontWeight: '700' }}>{value}</AppText>
      <AppText style={{ fontSize: 11, color: palette.caption, marginTop: 3 }}>{label}</AppText>
    </View>
  );
}

function MealRow({ meal, eaten, onEat, onPress }: { meal: Meal; eaten: boolean; onEat: () => void; onPress: () => void }) {
  return (
    <PressableScale activeScale={0.98} onPress={onPress} style={[styles.mealRow, meal.postWorkout && styles.mealPost]}>
      {meal.postWorkout ? <View style={styles.postAccent} /> : null}
      <View style={{ flex: 1 }}>
        <View style={styles.mealTop}>
          <AppText variant="caption" color={meal.postWorkout ? palette.voltDeep : palette.caption}>
            {meal.time}
          </AppText>
          {meal.postWorkout ? (
            <View style={styles.postTag}>
              <AppText style={{ fontSize: 9.5, fontWeight: '700', color: palette.voltText }}>MƏŞQDƏN SONRA</AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="headline" style={{ marginTop: 3 }}>
          {meal.name}
        </AppText>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
          {meal.kcal} kkal · {meal.protein}p / {meal.carb}k / {meal.fat}y
        </AppText>
      </View>
      <PressableScale activeScale={0.9} haptic={false} onPress={onEat} style={[styles.eatBtn, eaten && styles.eatBtnOn]}>
        {eaten ? (
          <Icon name="check" size={16} color={palette.inkText} />
        ) : (
          <AppText style={{ fontSize: 12.5, fontWeight: '700', color: palette.inkText }}>Yedim</AppText>
        )}
      </PressableScale>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  summary: { backgroundColor: palette.white, borderRadius: 18, padding: 18 },
  calRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bar: { height: 8, borderRadius: 4, backgroundColor: palette.element, marginTop: 14, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: palette.volt },
  targetCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, borderRadius: 12, backgroundColor: palette.grouped, marginTop: 14 },
  macros: { flexDirection: 'row', marginTop: 16, gap: 10 },
  macro: { flex: 1, backgroundColor: palette.grouped, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  water: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 12 },
  waterDots: { flexDirection: 'row', gap: 5, marginTop: 10 },
  waterDot: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.element },
  waterDotOn: { backgroundColor: palette.blue },
  waterBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  eatBtn: { minWidth: 60, height: 36, borderRadius: 10, paddingHorizontal: 12, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  eatBtnOn: { backgroundColor: palette.volt },
  mealRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14, marginBottom: 10, overflow: 'hidden' },
  mealPost: { borderWidth: 1, borderColor: 'rgba(198,255,61,0.6)' },
  postAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: palette.volt },
  mealTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  postTag: { backgroundColor: 'rgba(198,255,61,0.30)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14, marginBottom: 10 },
  addCard: { backgroundColor: palette.white, borderRadius: 16, padding: 14, marginTop: 6 },
  input: { backgroundColor: palette.grouped, borderRadius: radius.field, paddingHorizontal: 12, height: 44, fontSize: 15, color: palette.inkText },
  formBtn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shopBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 16, marginTop: 12 },
});
