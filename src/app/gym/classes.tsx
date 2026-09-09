import { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyNote, GymGate, updateMyGym, useMyGym, type ScheduleItem } from '@/lib/gymOwner';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

const sortByTime = (a: ScheduleItem, b: ScheduleItem) => a.time.localeCompare(b.time);

export default function GymClasses() {
  const insets = useSafeAreaInsets();
  // The row editor is a Modal — its own window, which Android never resizes for
  // the keyboard. Pad it by the measured overlap so the fields and «Saxla» stay
  // above the IME instead of under it.
  const kb = useKeyboardOverlap();
  const state = useMyGym();
  const gym = state.gym;

  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [editing, setEditing] = useState<{ index: number | null; time: string; name: string; trainer: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (gym) setItems([...gym.schedule].sort(sortByTime));
  }, [gym]);

  if (!gym) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped, paddingTop: insets.top }}>
        <GymGate state={state} />
      </View>
    );
  }

  const persist = async (next: ScheduleItem[]) => {
    const prev = items;
    setItems(next);
    setSaving(true);
    try {
      const { extrasSaved } = await updateMyGym(gym.id, { schedule: next });
      if (!extrasSaved) {
        setItems(prev);
        toast('Cədvəl saxlanılmadı — supabase/schema7_gym_owner.sql işlədilməyib', 'error');
      } else {
        toast('Cədvəl yeniləndi');
      }
    } catch {
      setItems(prev);
      toast('Cədvəl saxlanılmadı — bağlantını yoxla', 'error');
    }
    setSaving(false);
  };

  const submit = () => {
    if (!editing) return;
    const time = editing.time.trim();
    const name = editing.name.trim();
    if (!time || !name) return;
    const row: ScheduleItem = { time, name, trainer: editing.trainer.trim() };
    const next = editing.index === null ? [...items, row] : items.map((it, i) => (i === editing.index ? row : it));
    setEditing(null);
    persist(next.sort(sortByTime));
  };

  const remove = (index: number) => {
    confirm('Cədvəldən silinsin?', items[index]?.name, [
      { label: 'Ləğv et', style: 'cancel' },
      { label: 'Sil', style: 'destructive', onPress: () => persist(items.filter((_, i) => i !== index)) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <View style={styles.head}>
          <AppText variant="largeTitle">Cədvəl</AppText>
          <PressableScale
            activeScale={0.9}
            onPress={() => setEditing({ index: null, time: '', name: '', trainer: '' })}
            style={styles.fab}>
            <Icon name="plus" size={20} color={palette.inkText} />
          </PressableScale>
        </View>
        {/* This used to say the schedule «zal profilinə yazılır» — the gym profile.
            It does not: `gyms.schedule` is written and saved, but nothing on the
            customer side reads it (the `Gym` type has no schedule field, `mapGym`
            does not select it, and the Kəşf gym page has no such section). Owners
            typed out a whole week on that promise and then found no timetable
            anywhere on their own gym's page. Until the customer-side section
            exists, the screen states what is actually true today. */}
        <AppText variant="body" color={palette.textSecondary} style={{ marginBottom: 16, lineHeight: 21 }}>
          Zalının dərs cədvəlini özün yazırsan və saxlanılır, amma hazırda yalnız bu paneldə görünür — müştərinin
          gördüyü zal səhifəsində cədvəl bölməsi hələ yoxdur. Üzvlər tətbiq daxilində dərsə də yazıla bilmir: yer
          sayı və növbə göstərmirik, çünki belə bir sistem yoxdur.
        </AppText>

        {!items.length ? (
          <EmptyNote
            title="Hələ cədvəl yoxdur"
            body="«+» düyməsi ilə saat, dərsin adı və məşqçini əlavə et. Yalnız sənin yazdıqların görünür."
          />
        ) : (
          <View style={{ gap: 11 }}>
            {items.map((c, i) => (
              <PressableScale
                key={`${c.time}-${c.name}-${i}`}
                activeScale={0.98}
                onPress={() => setEditing({ index: i, time: c.time, name: c.name, trainer: c.trainer })}
                onLongPress={() => remove(i)}
                style={styles.card}>
                <View style={{ width: 52 }}>
                  <AppText style={{ fontSize: 16, fontWeight: '700' }}>{c.time}</AppText>
                </View>
                <View style={styles.vdiv} />
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontSize: 15, fontWeight: '600' }}>{c.name}</AppText>
                  {c.trainer ? (
                    <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>{c.trainer}</AppText>
                  ) : null}
                </View>
                <PressableScale activeScale={0.9} onPress={() => remove(i)} style={styles.del}>
                  <Icon name="x" size={14} color={palette.tertiary} />
                </PressableScale>
              </PressableScale>
            ))}
          </View>
        )}

        {items.length ? (
          <AppText style={{ fontSize: 11.5, lineHeight: 16, color: palette.tertiary, marginTop: 14, paddingHorizontal: 4 }}>
            Sətrə toxun — redaktə et. Uzun bas və ya «×» — sil.
          </AppText>
        ) : null}
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: (kb > 0 ? kb : insets.bottom) + 16 }]}>
            <AppText variant="headline">{editing?.index === null ? 'Cədvələ əlavə et' : 'Sətri redaktə et'}</AppText>
            <Field
              label="Saat"
              value={editing?.time ?? ''}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, time: t } : e))}
              placeholder="18:00"
            />
            <Field
              label="Dərsin adı"
              value={editing?.name ?? ''}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, name: t } : e))}
              placeholder="HIIT · 45 dəq"
            />
            <Field
              label="Məşqçi (istəyə bağlı)"
              value={editing?.trainer ?? ''}
              onChangeText={(t) => setEditing((e) => (e ? { ...e, trainer: t } : e))}
              placeholder="Ad Soyad"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Button title="Ləğv et" variant="secondary" full onPress={() => setEditing(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={saving ? 'Saxlanılır…' : 'Saxla'}
                  variant="primary"
                  full
                  disabled={!editing?.time.trim() || !editing?.name.trim() || saving}
                  onPress={submit}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{ marginTop: 14 }}>
      <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 7, fontWeight: '600' }}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.caption}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  fab: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  vdiv: { width: StyleSheet.hairlineWidth, height: 32, backgroundColor: 'rgba(60,60,67,0.14)' },
  del: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  modalBg: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.grouped, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  input: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: palette.inkText, borderWidth: 1, borderColor: palette.separator },
});
