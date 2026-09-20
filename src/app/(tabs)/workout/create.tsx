import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAuthGate } from '@/lib/authGate';
import {
  clipProblem,
  PickedAsset,
  pickClipFromLibrary,
  recordClip,
  uploadExerciseClip,
} from '@/lib/exerciseVideo';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { useProgram } from '@/lib/hooks';
import { saveProgramDraft } from '@/lib/saveProgram';
import { useAppStore } from '@/store/appStore';
import { findProgram } from '@/store/db';
import { DraftItem, useProgramDraft } from '@/store/programDraft';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * Writing a program.
 *
 * What changed, and why it had to.
 *
 * The old form let you name a program, name its days and pick moves from a
 * library — and then wrote nothing but a list of library ids. The sets and reps
 * it printed under each move («3 set × 8-10») came from the library and could
 * not be edited, because the stored shape had nowhere to put a different
 * answer. A coach writing «5 set × 5» for a student had no field to write it
 * in, and if they had, it would not have survived the save (schema76).
 *
 * So every row is now the author's: how many sets, how many repetitions OR how
 * many seconds, and their own clip showing how they want it done. Moves the
 * library has never heard of can be typed by name, which is the difference
 * between a demo and something a trainer can actually use.
 *
 * The draft lives in `useProgramDraft` rather than in this component's state,
 * because the exercise picker is a screen of its own now — twenty-four taps to
 * fill one day was the previous arrangement.
 */

export default function CreateProgram() {
  const router = useRouter();
  const gate = useAuthGate();
  const profile = useAppStore((s) => s.profile);

  /* `?id=` turns this screen into the editor. Same form, same fields: a
     separate «edit» screen is how the two drift apart until one of them can do
     something the other cannot. */
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const remote = useProgram(editId ?? '');
  const existing = editId ? findProgram(editId) ?? remote ?? undefined : undefined;

  const draft = useProgramDraft();
  const [saving, setSaving] = useState(false);
  /* Which row is uploading, by key. A `busy` boolean would grey out every
     video button on the screen while one of them worked. */
  const [uploading, setUploading] = useState<string | null>(null);
  /* A ref, not state: this only has to stop the draft being re-seeded on a
     later render, and a setState reached straight from the effect body is a
     cascading render the compiler bails out of the whole component over. The
     re-render that delivers `existing` comes from `useProgram` anyway. */
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current) return;
    if (editId) {
      // Wait for the program itself rather than opening an empty form titled
      // «Redaktə» — that form, saved, would have erased the program.
      if (!existing) return;
      draft.startEdit(existing);
    } else {
      draft.startNew();
    }
    seeded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, existing]);

  const allItems = draft.days.flatMap((d) => d.items);
  const ready = !!draft.title.trim() && draft.days.some((d) => d.items.length > 0);

  // ---- video ---------------------------------------------------------------
  const attachClip = (dayKey: string, item: DraftItem) => {
    const attach = async (get: () => Promise<PickedAsset | null | 'no-permission'>) => {
      const asset = await get();
      if (asset === 'no-permission') {
        toast('Kamera üçün icazə verilməyib — cihaz Ayarlarından SPOT-a icazə ver', 'error');
        return;
      }
      if (!asset) return;
      const problem = clipProblem(asset);
      if (problem) {
        errorFeedback();
        toast(problem, 'error');
        return;
      }
      setUploading(item.key);
      try {
        const url = await uploadExerciseClip(asset.uri, asset.fileSize ?? null);
        draft.patchItem(dayKey, item.key, { videoUrl: url });
        successFeedback();
        toast('Video əlavə olundu');
      } catch {
        // Nothing is written to the row. A program that claims a video the
        // server never received plays nothing for the person following it.
        errorFeedback();
        toast('Video yüklənmədi — bağlantını yoxla və yenidən cəhd et', 'error');
      } finally {
        setUploading(null);
      }
    };

    actionSheet({
      title: item.name,
      message: 'Bu hərəkətin necə edildiyini göstər — 30 saniyəyə qədər.',
      actions: [
        { label: 'Video çək', onPress: () => void attach(recordClip) },
        { label: 'Qalereyadan seç', onPress: () => void attach(pickClipFromLibrary) },
        ...(item.videoUrl
          ? [
              {
                label: 'Videonu sil',
                style: 'destructive' as const,
                onPress: () => draft.patchItem(dayKey, item.key, { videoUrl: null }),
              },
            ]
          : []),
        { label: 'Ləğv et', style: 'cancel' as const },
      ],
    });
  };

  // ---- save ----------------------------------------------------------------
  const sayWhatIsMissing = () => {
    if (!draft.title.trim()) {
      toast('Proqramın başlığını yaz', 'info');
      return;
    }
    toast('Ən azı bir günə hərəkət əlavə et', 'info');
  };

  const save = () =>
    gate(async () => {
      if (!ready || saving) return;
      const unnamed = allItems.find((it) => !it.name.trim());
      if (unnamed) {
        toast('Adı olmayan hərəkət var — adını yaz və ya sil', 'error');
        return;
      }
      setSaving(true);
      const { result, problem } = await saveProgramDraft({
        editingId: draft.editingId,
        title: draft.title,
        desc: draft.desc,
        days: draft.days,
        creatorName: profile.name || 'Sən',
        creatorType: profile.role === 'trainer' ? 'trainer' : 'user',
      });
      setSaving(false);

      if (result === 'failed') {
        errorFeedback();
        toast('Proqram saxlanılmadı. Yenidən cəhd et.', 'error');
        return;
      }
      if (result === 'refused') {
        /* The server read it and said no. Staying on the form is the point:
           «yenidən cəhd et» would be a lie about something that cannot succeed
           until the person changes what the message names. */
        errorFeedback();
        toast(problem ?? 'Server proqramı qəbul etmədi.', 'error');
        return;
      }
      if (result === 'local') {
        // Said out loud, because it matters: a program only on this phone is
        // one nobody else — no student, no follower — can open.
        toast('Proqram yalnız bu cihazda saxlanıldı — serverə göndərilmədi', 'info');
      } else {
        successFeedback();
        toast(draft.editingId ? 'Dəyişikliklər saxlanıldı' : 'Proqram yaradıldı — kitabxanadadır', 'success');
      }
      router.back();
    }, draft.editingId ? 'Proqramı dəyişmək üçün' : 'Proqram yaratmaq üçün');

  /* Leaving with work in it. The old screen dropped everything on a back
     swipe with no prompt — an eight-move day, gone to a gesture. */
  const leave = () => {
    if (!draft.touched || saving) {
      router.back();
      return;
    }
    confirm('Yazdıqların silinsin?', 'Bu proqram hələ saxlanılmayıb.', [
      { label: 'Yazmağa davam et', style: 'cancel' },
      { label: 'Sil və çıx', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  if (editId && !existing) {
    return (
      <Screen>
        <NavBar />
        <View style={styles.center}>
          <AppText variant="body" color={palette.textSecondary}>
            Proqram yüklənir…
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavBar
        onBack={leave}
        right={
          <PressableScale onPress={ready ? save : sayWhatIsMissing} haptic={false} activeScale={0.94} disabled={saving}>
            <AppText variant="headline" color={ready && !saving ? palette.blue : palette.tertiary}>
              {saving ? 'Saxlanılır…' : draft.editingId ? 'Saxla' : 'Yarat'}
            </AppText>
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="title" style={{ marginBottom: 18 }}>
          {draft.editingId ? 'Proqramı redaktə et' : 'Proqram yarat'}
        </AppText>

        <Label text="Başlıq" first />
        <TextInput
          value={draft.title}
          onChangeText={(title) => draft.set({ title })}
          placeholder="Məsələn: 3 günlük güc"
          placeholderTextColor={palette.caption}
          maxLength={80}
          style={styles.input}
        />

        <Label text="Təsvir" />
        <TextInput
          value={draft.desc}
          onChangeText={(desc) => draft.set({ desc })}
          placeholder="Kimə uyğundur, nə lazımdır, necə işləyir?"
          placeholderTextColor={palette.caption}
          multiline
          style={[styles.input, { height: 92, paddingTop: 12, textAlignVertical: 'top' }]}
        />

        <Label text="Günlər" />
        {draft.days.map((d, i) => (
          <View key={d.key} style={styles.dayCard}>
            <View style={styles.dayHead}>
              <View style={styles.dayIndex}>
                <AppText style={{ fontSize: 13, fontWeight: '700', color: palette.voltDeep }}>{i + 1}</AppText>
              </View>
              <TextInput
                value={d.title}
                onChangeText={(v) => draft.patchDay(d.key, { title: v })}
                placeholder={`Gün ${i + 1}`}
                placeholderTextColor={palette.caption}
                maxLength={40}
                style={styles.dayTitleInput}
              />
              {draft.days.length > 1 ? (
                <PressableScale activeScale={0.9} onPress={() => draft.removeDay(d.key)} style={styles.removeBtn}>
                  <Icon name="x" size={15} color={palette.textSecondary} />
                </PressableScale>
              ) : null}
            </View>
            <TextInput
              value={d.focus}
              onChangeText={(v) => draft.patchDay(d.key, { focus: v })}
              placeholder="Fokus (məs: sinə, triseps)"
              placeholderTextColor={palette.caption}
              maxLength={60}
              style={styles.focusInput}
            />

            {d.items.map((it) => (
              <ItemEditor
                key={it.key}
                item={it}
                uploading={uploading === it.key}
                onPatch={(patch) => draft.patchItem(d.key, it.key, patch)}
                onRemove={() => draft.removeItem(d.key, it.key)}
                onVideo={() => attachClip(d.key, it)}
              />
            ))}

            <PressableScale
              activeScale={0.97}
              onPress={() => router.push({ pathname: '/(tabs)/workout/pick-exercises', params: { dayKey: d.key } })}
              style={styles.addMove}>
              <Icon name="plus" size={16} color={palette.blue} />
              <AppText variant="subhead" color={palette.blue}>
                Hərəkət əlavə et
              </AppText>
            </PressableScale>
          </View>
        ))}

        <PressableScale activeScale={0.97} onPress={draft.addDay} style={styles.addDay}>
          <Icon name="plus" size={17} color={palette.inkText} />
          <AppText variant="headline">Gün əlavə et</AppText>
        </PressableScale>

        <View style={styles.note}>
          <Icon name="lock" size={17} color={palette.caption} />
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
            Bu versiyada bütün proqramlar hər kəsə açıqdır və pulsuzdur. SPOT-da onlayn ödəniş yoxdur.
          </AppText>
        </View>

        {!ready ? (
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 16, lineHeight: 18 }}>
            {draft.editingId ? 'Saxlamaq' : 'Yaratmaq'} üçün başlıq yaz və ən azı bir günə hərəkət əlavə et.
          </AppText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * One exercise, as its author wants it done.
 *
 * Sets, then a choice between repetitions and a hold, then the number. The
 * choice is a real switch and not a guess from the text: «45» typed into a
 * field that decided for itself what it meant is how a plank became forty-five
 * repetitions.
 */
function ItemEditor({
  item,
  uploading,
  onPatch,
  onRemove,
  onVideo,
}: {
  item: DraftItem;
  uploading: boolean;
  onPatch: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
  onVideo: () => void;
}) {
  const timed = item.mode === 'time';
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <Icon name="dumbbell" size={15} color={palette.textSecondary} />
        <TextInput
          value={item.name}
          onChangeText={(name) => onPatch({ name })}
          placeholder="Hərəkətin adı"
          placeholderTextColor={palette.caption}
          maxLength={80}
          style={styles.itemName}
        />
        <PressableScale activeScale={0.9} onPress={onRemove} style={styles.removeBtn}>
          <Icon name="x" size={14} color={palette.textSecondary} />
        </PressableScale>
      </View>

      <View style={styles.fields}>
        <View style={styles.field}>
          <AppText variant="caption" color={palette.caption}>
            Set
          </AppText>
          <TextInput
            value={String(item.sets)}
            onChangeText={(v) => {
              const n = Number(v.replace(/\D/g, '').slice(0, 2));
              onPatch({ sets: Number.isFinite(n) && n > 0 ? Math.min(20, n) : 1 });
            }}
            keyboardType="number-pad"
            maxLength={2}
            style={styles.numInput}
          />
        </View>

        <View style={[styles.field, { flex: 1 }]}>
          <View style={styles.modeRow}>
            {(['reps', 'time'] as const).map((m) => (
              <PressableScale
                key={m}
                activeScale={0.95}
                haptic={false}
                onPress={() => onPatch({ mode: m })}
                style={[styles.mode, item.mode === m ? styles.modeOn : null]}>
                <AppText variant="caption" color={item.mode === m ? palette.ink : palette.caption}>
                  {m === 'reps' ? 'Təkrar' : 'Müddət'}
                </AppText>
              </PressableScale>
            ))}
          </View>
          <View style={styles.valueRow}>
            <TextInput
              value={item.value}
              onChangeText={(value) => onPatch({ value })}
              placeholder={timed ? '45' : '8-10'}
              placeholderTextColor={palette.caption}
              keyboardType={timed ? 'number-pad' : 'default'}
              maxLength={20}
              style={styles.valueInput}
            />
            {timed ? (
              <AppText variant="footnote" color={palette.caption}>
                san
              </AppText>
            ) : null}
          </View>
        </View>
      </View>

      <PressableScale activeScale={0.97} haptic={false} onPress={onVideo} disabled={uploading} style={styles.videoBtn}>
        <Icon name={item.videoUrl ? 'check' : 'video'} size={15} color={item.videoUrl ? palette.voltDeep : palette.blue} />
        <AppText variant="footnote" color={item.videoUrl ? palette.voltDeep : palette.blue}>
          {uploading ? 'Yüklənir…' : item.videoUrl ? 'Video əlavə olunub' : 'Video əlavə et'}
        </AppText>
      </PressableScale>
    </View>
  );
}

function Label({ text, first }: { text: string; first?: boolean }) {
  return (
    <AppText variant="overline" color={palette.caption} style={{ marginTop: first ? 0 : 20, marginBottom: 10 }}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: palette.white,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: palette.separator,
    paddingHorizontal: 14,
    height: 52,
    fontSize: 16,
    color: palette.inkText,
  },
  dayCard: { backgroundColor: palette.white, borderRadius: 16, padding: 14, marginBottom: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayIndex: { width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  dayTitleInput: { flex: 1, fontSize: 16, fontWeight: '600', color: palette.inkText, paddingVertical: 6 },
  focusInput: { fontSize: 13.5, color: palette.textSecondary, paddingVertical: 6, marginLeft: 38 },

  item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator, paddingTop: 10, marginTop: 8 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  itemName: { flex: 1, fontSize: 15, fontWeight: '600', color: palette.inkText, paddingVertical: 4 },
  fields: { flexDirection: 'row', gap: 12, marginTop: 8, marginLeft: 24 },
  field: { gap: 5 },
  numInput: {
    width: 54,
    height: 40,
    borderRadius: 10,
    backgroundColor: palette.grouped,
    textAlign: 'center',
    fontSize: 15,
    color: palette.inkText,
    padding: 0,
  },
  modeRow: { flexDirection: 'row', gap: 6 },
  mode: { paddingHorizontal: 9, height: 22, borderRadius: 11, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: palette.volt },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  valueInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: palette.grouped,
    paddingHorizontal: 11,
    fontSize: 15,
    color: palette.inkText,
  },
  videoBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, marginLeft: 24, paddingVertical: 6 },

  removeBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  addMove: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, marginTop: 12, borderRadius: 11, backgroundColor: palette.grouped },
  addDay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator },
  note: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: palette.grouped, borderRadius: 14, padding: 14, marginTop: 22 },
});
