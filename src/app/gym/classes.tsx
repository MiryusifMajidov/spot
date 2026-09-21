import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyNote, GymGate, updateMyGym, useMyGym, type OwnedGym, type ScheduleItem } from '@/lib/gymOwner';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { useT } from '@/lib/useT';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

const sortByTime = (a: ScheduleItem, b: ScheduleItem) => a.time.localeCompare(b.time);

export default function GymClasses() {
  const t = useT();
  const insets = useSafeAreaInsets();
  // The row editor is a Modal — its own window, which Android never resizes for
  // the keyboard. Pad it by the measured overlap so the fields and «Saxla» stay
  // above the IME instead of under it.
  const kb = useKeyboardOverlap();
  const state = useMyGym();
  const gym = state.gym;

  /* The schedule as the gym row really has it. Derived here rather than copied
     into state by an effect: an effect runs AFTER the render that first has a
     loaded gym, so the screen printed «Hələ cədvəl yoxdur» for a frame while the
     rows were already in hand — the one thing this app must never say when it
     knows better. */
  const saved = useMemo(() => (gym ? [...gym.schedule].sort(sortByTime) : []), [gym]);
  /* A locally changed list, tagged with the gym object it was made from. A focus
     refetch hands back a NEW gym object, and the tag then stops matching — which
     drops the local list at exactly the moment the old effect used to overwrite
     it with the server's answer. */
  const [edited, setEdited] = useState<{ from: OwnedGym; items: ScheduleItem[] } | null>(null);
  const items = edited && edited.from === gym ? edited.items : saved;
  const [editing, setEditing] = useState<{ index: number | null; time: string; name: string; trainer: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (!gym) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped, paddingTop: insets.top }}>
        <GymGate state={state} />
      </View>
    );
  }

  const persist = async (next: ScheduleItem[]) => {
    const prev = items;
    setEdited({ from: gym, items: next });
    setSaving(true);
    try {
      const { extrasSaved } = await updateMyGym(gym.id, { schedule: next });
      if (!extrasSaved) {
        setEdited({ from: gym, items: prev });
        /* Not «the migration is missing» any more. `updateMyGym` now reports
           `extrasSaved: false` for a write that touched no row as well — which
           is what an RLS refusal looks like — and naming a .sql file as the
           cause of that would send the owner after the wrong thing. */
        toast(t('Cədvəl saxlanılmadı — serverdə yazıla bilmədi'), 'error');
      } else {
        toast(t('Cədvəl yeniləndi'));
      }
    } catch {
      setEdited({ from: gym, items: prev });
      toast(t('Cədvəl saxlanılmadı — bağlantını yoxla'), 'error');
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
    confirm(t('Cədvəldən silinsin?'), items[index]?.name, [
      { label: t('Ləğv et'), style: 'cancel' },
      { label: t('Sil'), style: 'destructive', onPress: () => persist(items.filter((_, i) => i !== index)) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <View style={styles.head}>
          <AppText variant="largeTitle">{t('Cədvəl')}</AppText>
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
          {t(
            'Zalının dərs cədvəlini özün yazırsan — yazdığın sətirlər zal səhifəsində, «Haqqında» bölməsində müştərilərə görünür. Üzvlər tətbiq daxilində dərsə yazıla bilmir: yer sayı və növbə göstərmirik, çünki belə bir sistem yoxdur.'
          )}
        </AppText>

        {!items.length ? (
          <EmptyNote
            title={t('Hələ cədvəl yoxdur')}
            body={t('«+» düyməsi ilə saat, dərsin adı və məşqçini əlavə et. Yalnız sənin yazdıqların görünür.')}
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
            {t('Sətrə toxun — redaktə et. Uzun bas və ya «×» — sil.')}
          </AppText>
        ) : null}
      </ScrollView>

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: (kb > 0 ? kb : insets.bottom) + 16 }]}>
            <AppText variant="headline">
              {editing?.index === null ? t('Cədvələ əlavə et') : t('Sətri redaktə et')}
            </AppText>
            <Field
              label={t('Saat')}
              value={editing?.time ?? ''}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, time: v } : e))}
              placeholder="18:00"
            />
            <Field
              label={t('Dərsin adı')}
              value={editing?.name ?? ''}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, name: v } : e))}
              placeholder={t('HIIT · 45 dəq')}
            />
            <Field
              label={t('Məşqçi (istəyə bağlı)')}
              value={editing?.trainer ?? ''}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, trainer: v } : e))}
              placeholder={t('Ad Soyad')}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Button title={t('Ləğv et')} variant="secondary" full onPress={() => setEditing(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={saving ? t('Saxlanılır…') : t('Saxla')}
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
