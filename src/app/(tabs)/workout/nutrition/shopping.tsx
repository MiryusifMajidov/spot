import AsyncStorage from '@react-native-async-storage/async-storage';
import { tapFeedback } from '@/lib/feedback';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useMeals } from '@/lib/hooks';
import { palette, spacing } from '@/theme';

const KEY = 'spot-shopping';
const UNIT = /^(.*?)[\s]([\d.,]+)\s*(kq|q|ml|l|ədəd|x\.q\.)$/i;

interface ShopRow {
  id: string;
  name: string;
  qty: string;
  meals: string[];
}

/** The list is built from the ingredients of the meals in the plan — so
 *  "qida planından yaradıldı" is literally true. */
function buildList(meals: { name: string; ingredients: string[] }[]): ShopRow[] {
  const map = new Map<string, { name: string; amounts: { n: number; unit: string }[]; raw: string[]; meals: Set<string> }>();
  for (const m of meals) {
    for (const ing of m.ingredients) {
      const match = ing.match(UNIT);
      const name = (match ? match[1] : ing).trim();
      const id = name.toLocaleLowerCase('az');
      const entry = map.get(id) ?? { name, amounts: [], raw: [], meals: new Set<string>() };
      if (match) entry.amounts.push({ n: Number(match[2].replace(',', '.')), unit: match[3].toLowerCase() });
      else entry.raw.push(ing);
      entry.meals.add(m.name);
      map.set(id, entry);
    }
  }
  return [...map.entries()].map(([id, e]) => {
    const byUnit = new Map<string, number>();
    for (const a of e.amounts) byUnit.set(a.unit, (byUnit.get(a.unit) ?? 0) + a.n);
    const qty = [...byUnit.entries()].map(([u, n]) => `${Math.round(n * 10) / 10} ${u}`).join(' + ');
    return { id, name: e.name, qty: qty || '—', meals: [...e.meals] };
  });
}

export default function Shopping() {
  const meals = useMeals();
  const items = useMemo(() => buildList(meals), [meals]);
  const [got, setGot] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        try {
          setGot(raw ? JSON.parse(raw) : {});
        } catch {
          setGot({});
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const toggle = (id: string) => {
    tapFeedback();
    setGot((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const clear = () => {
    setGot({});
    AsyncStorage.setItem(KEY, JSON.stringify({})).catch(() => {});
  };

  const remaining = items.filter((i) => !got[i.id]);

  const share = () =>
    Share.share({
      message: ['Alış-veriş siyahısı — SPOT', ...remaining.map((i) => `• ${i.name} ${i.qty !== '—' ? `(${i.qty})` : ''}`.trim())].join('\n'),
    }).catch(() => {});

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar
        title="Alış-veriş"
        right={
          <PressableScale activeScale={0.9} onPress={share}>
            <Icon name="share" size={20} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 12 }}>
          Qida planındakı {meals.length} yeməyin tərkibindən yaradıldı.
        </AppText>
        {items.length === 0 ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <AppText variant="body" color={palette.caption}>
                Qida planında məhsul yoxdur.
              </AppText>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {items.map((it, i) => {
              const done = !!got[it.id];
              return (
                <View key={it.id}>
                  {i > 0 ? <View style={styles.sep} /> : null}
                  <PressableScale activeScale={0.99} haptic={false} onPress={() => toggle(it.id)} style={styles.row}>
                    <View style={[styles.check, done && { backgroundColor: palette.voltDeep, borderColor: palette.voltDeep }]}>
                      {done ? <Icon name="check" size={13} color={palette.white} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText variant="body" style={done ? { textDecorationLine: 'line-through', color: palette.caption } : undefined}>
                        {it.name}
                      </AppText>
                      <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
                        {it.qty} · {it.meals.join(', ')}
                      </AppText>
                    </View>
                  </PressableScale>
                </View>
              );
            })}
          </View>
        )}

        {loaded && items.length > 0 && remaining.length < items.length ? (
          <PressableScale activeScale={0.97} onPress={clear} style={styles.clear}>
            <AppText variant="subhead" color={palette.blue}>
              İşarələri sıfırla
            </AppText>
          </PressableScale>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <AppText variant="caption" color={palette.caption}>
            alınmalıdır
          </AppText>
          <AppText variant="title2">
            {remaining.length} / {items.length}
          </AppText>
        </View>
        <AppText variant="footnote" color={palette.caption}>
          Siyahı cihazında saxlanılır
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 24 },
  card: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  clear: { alignItems: 'center', paddingVertical: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
