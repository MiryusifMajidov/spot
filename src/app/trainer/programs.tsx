import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { LargeHeader } from '@/components/ui/LargeHeader';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { Level, Program } from '@/data/types';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { useDb } from '@/store/db';
import { actionSheet, confirm, toast } from '@/store/ui';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';

const LEVELS: Level[] = ['Başlanğıc', 'Orta', 'İrəli'];

/** Day skeleton for a new program — real, runnable days, not empty placeholders. */
function buildDays(daysPerWeek: number): Program['days'] {
  const rotation =
    daysPerWeek >= 3
      ? [
          { name: 'Push', focus: 'Sinə · Çiyin · Triseps' },
          { name: 'Pull', focus: 'Kürək · Biseps' },
          { name: 'Ayaq', focus: 'Ayaq · Sağrı' },
        ]
      : [{ name: 'Tam bədən', focus: 'Bütün əzələ qrupları' }];
  return Array.from({ length: daysPerWeek }, (_, i) => {
    const d = rotation[i % rotation.length];
    return { title: `Gün ${i + 1} · ${d.name}`, focus: d.focus, exercises: [] };
  });
}

interface Draft {
  id: string | null;
  title: string;
  goal: string;
  weeks: string;
  daysPerWeek: string;
  minutes: string;
  level: number;
}

const emptyDraft: Draft = { id: null, title: '', goal: '', weeks: '8', daysPerWeek: '3', minutes: '60', level: 1 };

export default function TrainerPrograms() {
  const myName = useAppStore((s) => s.profile.name);
  const programs = useDb((s) => s.myPrograms);
  const createProgram = useDb((s) => s.createProgram);
  const updateProgram = useDb((s) => s.updateProgram);
  const deleteProgram = useDb((s) => s.deleteProgram);

  const [draft, setDraft] = useState<Draft | null>(null);

  /* The composer lives in a Modal — its own window, which Android does not resize
     under edge-to-edge, so KeyboardAvoidingView had nothing to work with and the
     Məqsəd / Həftə / Gün / Dəqiqə fields were typed blind under the IME. Pad the
     bottom-anchored sheet by the measured overlap instead; once the padded sheet
     passes maxHeight 88% the inner ScrollView gains real scroll range too. */
  const kb = useKeyboardOverlap();

  const openNew = () => setDraft(emptyDraft);
  const openEdit = (p: Program) =>
    setDraft({
      id: p.id,
      title: p.title,
      goal: p.goal ?? '',
      weeks: String(p.weeks),
      daysPerWeek: String(p.daysPerWeek),
      minutes: String(p.minutes),
      level: Math.max(0, LEVELS.indexOf(p.level)),
    });

  const clamp = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  const submit = () => {
    if (!draft || !draft.title.trim()) return;
    const weeks = clamp(draft.weeks, 1, 52, 8);
    const daysPerWeek = clamp(draft.daysPerWeek, 1, 7, 3);
    const minutes = clamp(draft.minutes, 10, 180, 60);
    const level = LEVELS[draft.level] ?? 'Orta';
    const goal = draft.goal.trim() || 'Ümumi hazırlıq';

    if (draft.id) {
      const existing = programs.find((p) => p.id === draft.id);
      const days = existing && existing.daysPerWeek === daysPerWeek ? existing.days : buildDays(daysPerWeek);
      updateProgram(draft.id, { title: draft.title.trim(), goal, weeks, daysPerWeek, minutes, level, days });
      toast('Proqram yeniləndi');
    } else {
      createProgram({
        title: draft.title.trim(),
        creatorName: myName || 'Müəllim',
        creatorType: 'trainer',
        creatorVerified: false,
        weeks,
        daysPerWeek,
        level,
        goal,
        paid: false,
        rating: 0,
        minutes,
        videoCount: 0,
        doneBy: 0,
        tags: [],
        saves: 0,
        days: buildDays(daysPerWeek),
      });
      toast('Proqram yaradıldı');
    }
    setDraft(null);
  };

  const rowMenu = (p: Program) =>
    actionSheet({
      title: p.title,
      actions: [
        { label: 'Redaktə et', onPress: () => openEdit(p) },
        {
          label: 'Sil',
          style: 'destructive',
          onPress: () =>
            confirm('Proqramı silmək?', `«${p.title}» siyahından silinəcək. Şagirdə artıq təyin etmisənsə, ona yenidən proqram təyin etməlisən.`, [
              { label: 'Ləğv et', style: 'cancel' },
              {
                label: 'Sil',
                style: 'destructive',
                onPress: () => {
                  deleteProgram(p.id);
                  toast('Proqram silindi', 'info');
                },
              },
            ]),
        },
        { label: 'Bağla', style: 'cancel' },
      ],
    });

  return (
    <Screen edges={['top']}>
      <LargeHeader
        title="Proqramlar"
        subtitle="Yaratdığın proqramlar. Hamısı pulsuzdur."
        right={
          <PressableScale
            activeScale={0.9}
            accessibilityRole="button"
            accessibilityLabel="Yeni proqram yarat"
            hitSlop={8}
            onPress={openNew}
            style={styles.fab}>
            <Icon name="plus" size={20} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 28 }}>
        {programs.length === 0 ? (
          <View style={styles.empty}>
            <AppText style={{ fontSize: 15, fontWeight: '600', marginBottom: 6 }}>Hələ proqram yaratmamısan</AppText>
            <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.textSecondary }}>
              İlk proqramını yarat — sonra onu şagirdlərinə təyin edə və özün də Məşq bölməsində işlədə bilərsən.
            </AppText>
            <PressableScale
              activeScale={0.97}
              accessibilityRole="button"
              accessibilityLabel="İlk proqramı yarat"
              onPress={openNew}
              style={[styles.primaryBtn, { marginTop: 15, alignSelf: 'flex-start', paddingHorizontal: 18 }]}>
              <AppText style={{ color: palette.white, fontSize: 13.5, fontWeight: '600' }}>Proqram yarat</AppText>
            </PressableScale>
          </View>
        ) : (
          <View style={{ gap: 11 }}>
            {programs.map((p) => (
              <View key={p.id} style={styles.card}>
                <PressableScale
                  activeScale={0.99}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title} proqramını redaktə et`}
                  onPress={() => openEdit(p)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.thumb}>
                    <Icon name="dumbbell" size={20} color={palette.voltDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 15, fontWeight: '600' }}>{p.title}</AppText>
                    <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                      {p.weeks} həftə · {p.daysPerWeek} gün/həftə · {p.minutes} dəq · {p.level}
                    </AppText>
                  </View>
                  <PressableScale
                    activeScale={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={`${p.title} üçün əməliyyatlar`}
                    hitSlop={10}
                    onPress={() => rowMenu(p)}
                    style={styles.moreBtn}>
                    <Icon name="more" size={18} color={palette.textSecondary} />
                  </PressableScale>
                </PressableScale>
                <View style={styles.metaRow}>
                  <View style={styles.tag}>
                    <AppText style={{ fontSize: 11.5, fontWeight: '600', color: palette.text3 }}>{p.goal}</AppText>
                  </View>
                  <View style={styles.tag}>
                    <AppText style={{ fontSize: 11.5, fontWeight: '600', color: palette.text3 }}>PULSUZ</AppText>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.caption, marginTop: 18 }}>
          Proqramlar bu cihazda saxlanılır. Şagirdə təyin edəndə proqramın adı və qeydin ona göndərilir — SPOT-da ödəniş yoxdur, bütün proqramlar pulsuzdur.
        </AppText>
      </ScrollView>

      <Modal visible={!!draft} animationType="slide" transparent onRequestClose={() => setDraft(null)}>
        <View style={styles.sheetWrap}>
          <View style={{ justifyContent: 'flex-end', flex: 1 }}>
            <View style={[styles.sheet, { paddingBottom: kb }]}>
              <View style={styles.sheetHead}>
                <PressableScale activeScale={0.94} accessibilityRole="button" accessibilityLabel="Bağla" onPress={() => setDraft(null)}>
                  <AppText style={{ fontSize: 15, color: palette.blue }}>Ləğv et</AppText>
                </PressableScale>
                <AppText variant="headline">{draft?.id ? 'Proqramı redaktə et' : 'Yeni proqram'}</AppText>
                <PressableScale
                  activeScale={0.94}
                  disabled={!draft?.title.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Proqramı yadda saxla"
                  onPress={submit}>
                  <AppText style={{ fontSize: 15, fontWeight: '600', color: draft?.title.trim() ? palette.blue : palette.tertiary }}>Saxla</AppText>
                </PressableScale>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.screen, paddingBottom: 28 }}>
                <Field label="Ad *" value={draft?.title ?? ''} onChangeText={(t) => setDraft((d) => (d ? { ...d, title: t } : d))} placeholder="Məs: Güc bazası 5x5" />
                <Field label="Məqsəd" value={draft?.goal ?? ''} onChangeText={(t) => setDraft((d) => (d ? { ...d, goal: t } : d))} placeholder="Məs: Güc, arıqlama, hipertrofiya" />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Həftə" value={draft?.weeks ?? ''} onChangeText={(t) => setDraft((d) => (d ? { ...d, weeks: t } : d))} placeholder="8" numeric />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Gün/həftə" value={draft?.daysPerWeek ?? ''} onChangeText={(t) => setDraft((d) => (d ? { ...d, daysPerWeek: t } : d))} placeholder="3" numeric />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Dəqiqə" value={draft?.minutes ?? ''} onChangeText={(t) => setDraft((d) => (d ? { ...d, minutes: t } : d))} placeholder="60" numeric />
                  </View>
                </View>
                <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 8, fontWeight: '600' }}>
                  Səviyyə
                </AppText>
                <Segmented options={LEVELS} value={draft?.level ?? 1} onChange={(i) => setDraft((d) => (d ? { ...d, level: i } : d))} />
                <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.caption, marginTop: 14 }}>
                  Gün sayına uyğun məşq günləri (Push / Pull / Ayaq) avtomatik qurulur — proqramı açıb hərəkətləri ora əlavə edə bilərsən.
                </AppText>
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  numeric?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 8, fontWeight: '600' }}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.caption}
        keyboardType={numeric ? 'numeric' : 'default'}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fab: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  thumb: { width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(198,255,61,0.3)', alignItems: 'center', justifyContent: 'center' },
  moreBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', gap: 7, marginTop: 12 },
  tag: { backgroundColor: palette.grouped, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  empty: { backgroundColor: palette.white, borderRadius: 16, padding: 16 },
  primaryBtn: { height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  sheetWrap: { flex: 1, backgroundColor: palette.overlay },
  sheet: { backgroundColor: palette.grouped, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.screen, paddingTop: 16, paddingBottom: 10 },
  input: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: palette.inkText, borderWidth: 1, borderColor: palette.separator },
});
