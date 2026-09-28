import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
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
import { useT } from '@/lib/useT';
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
  const t = useT();
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
        toast(t('Kamera üçün icazə verilməyib — cihaz Ayarlarından SPOT-a icazə ver'), 'error');
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
        toast(t('Video əlavə olundu'));
      } catch {
        // Nothing is written to the row. A program that claims a video the
        // server never received plays nothing for the person following it.
        errorFeedback();
        toast(t('Video yüklənmədi — bağlantını yoxla və yenidən cəhd et'), 'error');
      } finally {
        setUploading(null);
      }
    };

    /* The form keeps taps while a field is being typed in, so this can run with
       the keyboard up. The action sheet is drawn at the bottom of the app's window
       and does not lift itself, so it would open behind the keyboard. */
    Keyboard.dismiss();
    actionSheet({
      title: item.name,
      message: t('Bu hərəkətin necə edildiyini göstər — 30 saniyəyə qədər.'),
      actions: [
        { label: t('Video çək'), onPress: () => void attach(recordClip) },
        { label: t('Qalereyadan seç'), onPress: () => void attach(pickClipFromLibrary) },
        ...(item.videoUrl
          ? [
              {
                label: t('Videonu sil'),
                style: 'destructive' as const,
                onPress: () => draft.patchItem(dayKey, item.key, { videoUrl: null }),
              },
            ]
          : []),
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });
  };

  // ---- days ----------------------------------------------------------------
  /* A day carries the author's work: every move in it, with its sets, reps and
     filmed clip. One tap on its «x» used to throw all of that away, and that «x»
     is now a full 44 pt target, so a slip is likelier — a day with moves in it
     asks first. An empty day still goes at once. */
  const removeDay = (dayKey: string, name: string, hasItems: boolean) => {
    if (!hasItems) {
      draft.removeDay(dayKey);
      return;
    }
    confirm(t('«{day}» silinsin?', { day: name }), t('İçindəki hərəkətlər də silinəcək.'), [
      { label: t('Ləğv et'), style: 'cancel' },
      { label: t('Sil'), style: 'destructive', onPress: () => draft.removeDay(dayKey) },
    ]);
  };

  // ---- save ----------------------------------------------------------------
  const sayWhatIsMissing = () => {
    if (!draft.title.trim()) {
      toast(t('Proqramın başlığını yaz'), 'info');
      return;
    }
    toast(t('Ən azı bir günə hərəkət əlavə et'), 'info');
  };

  const save = () =>
    gate(async () => {
      if (!ready || saving) return;
      const unnamed = allItems.find((it) => !it.name.trim());
      if (unnamed) {
        toast(t('Adı olmayan hərəkət var — adını yaz və ya sil'), 'error');
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
        toast(t('Proqram saxlanılmadı. Yenidən cəhd et.'), 'error');
        return;
      }
      if (result === 'refused') {
        /* The server read it and said no. Staying on the form is the point:
           «yenidən cəhd et» would be a lie about something that cannot succeed
           until the person changes what the message names. */
        errorFeedback();
        toast(problem ?? t('Server proqramı qəbul etmədi.'), 'error');
        return;
      }
      if (result === 'local') {
        // Said out loud, because it matters: a program only on this phone is
        // one nobody else — no student, no follower — can open.
        toast(t('Proqram yalnız bu cihazda saxlanıldı — serverə göndərilmədi'), 'info');
      } else {
        successFeedback();
        toast(draft.editingId ? t('Dəyişikliklər saxlanıldı') : t('Proqram yaradıldı — kitabxanadadır'), 'success');
      }
      leavingRef.current = true;
      router.back();
    }, draft.editingId ? t('Proqramı dəyişmək üçün') : t('Proqram yaratmaq üçün'));

  /* Leaving with work in it — by ANY route off the screen.
     The prompt used to hang on the NavBar chevron alone. The iOS edge swipe and
     the Android back button went straight past it, and those are what people
     actually use: a title, a description, eight moves and a filmed clip for
     each, gone to a reflex, with the clips left orphaned in storage.
     `usePreventRemove` sits on the navigator itself, so the chevron, the swipe
     and the hardware button all land here. A save sets `leavingRef` first so
     its own `router.back()` is let through without asking. */
  const navigation = useNavigation();
  const leavingRef = useRef(false);

  /* The keyboard covered the reps/set fields of the lower day cards: nothing moved
     the list. iOS does it natively (automaticallyAdjustKeyboardInsets on the
     ScrollView). Android edge-to-edge does not resize the window, so there the
     scroller shrinks by the overlap and scrolls by the same amount, keeping the
     tapped field where it was — the profile/edit pattern. Android only: on iOS this
     screen runs under the floating tab bar, so the lift's inset arithmetic does not
     hold, and the native adjustment already covers it. */
  const kbLift = useKeyboardLift();
  const lift = Platform.OS === 'android' ? kbLift : 0;
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lifted = useRef(0);
  useEffect(() => {
    const delta = lift - lifted.current;
    lifted.current = lift;
    if (delta > 0) scroller.current?.scrollTo({ y: scrollY.current + delta, animated: true });
  }, [lift]);

  usePreventRemove(draft.touched && !saving, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    confirm(t('Yazdıqların silinsin?'), t('Bu proqram hələ saxlanılmayıb.'), [
      { label: t('Yazmağa davam et'), style: 'cancel' },
      { label: t('Sil və çıx'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  if (editId && !existing) {
    return (
      <Screen>
        <NavBar />
        <View style={styles.center}>
          <AppText variant="body" color={palette.textSecondary}>
            {t('Proqram yüklənir…')}
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <NavBar
        right={
          <PressableScale
            onPress={ready ? save : sayWhatIsMissing}
            haptic={false}
            activeScale={0.94}
            disabled={saving}
            accessibilityRole="button"
            style={styles.navAction}>
            <AppText variant="headline" color={ready && !saving ? palette.blue : palette.tertiary}>
              {saving ? t('Saxlanılır…') : draft.editingId ? t('Saxla') : t('Yarat')}
            </AppText>
          </PressableScale>
        }
      />
      {/* This is a TAB screen and iOS 26's Liquid Glass tab bar floats over it:
          with only 40 pt of end padding the lock note and the «what is missing»
          hint stayed under the glass. "automatic" insets the list by the safe area,
          which inside a tab includes the bar. Android ignores the prop; there the
          tab scene already stops above the Material bar. */}
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        style={{ marginBottom: lift }}>
        <AppText variant="title" style={{ marginBottom: 18 }}>
          {draft.editingId ? t('Proqramı redaktə et') : t('Proqram yarat')}
        </AppText>

        <Label text={t('Başlıq')} first />
        <TextInput
          value={draft.title}
          onChangeText={(title) => draft.set({ title })}
          placeholder={t('Məsələn: 3 günlük güc')}
          placeholderTextColor={palette.caption}
          maxLength={80}
          style={styles.input}
        />

        <Label text={t('Təsvir')} />
        <TextInput
          value={draft.desc}
          onChangeText={(desc) => draft.set({ desc })}
          placeholder={t('Kimə uyğundur, nə lazımdır, necə işləyir?')}
          placeholderTextColor={palette.caption}
          multiline
          style={[styles.input, { height: 92, paddingTop: 12, textAlignVertical: 'top' }]}
        />

        <Label text={t('Günlər')} />
        {draft.days.map((d, i) => (
          <View key={d.key} style={styles.dayCard}>
            <View style={styles.dayHead}>
              <View style={styles.dayIndex}>
                <AppText style={{ fontSize: 13, fontWeight: '700', color: palette.voltDeep }}>{i + 1}</AppText>
              </View>
              <TextInput
                value={d.title}
                onChangeText={(v) => draft.patchDay(d.key, { title: v })}
                placeholder={t('Gün {n}', { n: i + 1 })}
                placeholderTextColor={palette.caption}
                maxLength={40}
                style={styles.dayTitleInput}
              />
              {draft.days.length > 1 ? (
                <PressableScale
                  activeScale={0.9}
                  onPress={() => removeDay(d.key, d.title.trim() || t('Gün {n}', { n: i + 1 }), d.items.length > 0)}
                  style={styles.removeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('Günü sil')}>
                  <View style={styles.removeDot}>
                    <Icon name="x" size={18} color={palette.textSecondary} />
                  </View>
                </PressableScale>
              ) : null}
            </View>
            <TextInput
              value={d.focus}
              onChangeText={(v) => draft.patchDay(d.key, { focus: v })}
              placeholder={t('Fokus (məs: sinə, triseps)')}
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
                {t('Hərəkət əlavə et')}
              </AppText>
            </PressableScale>
          </View>
        ))}

        <PressableScale activeScale={0.97} onPress={draft.addDay} style={styles.addDay}>
          <Icon name="plus" size={17} color={palette.inkText} />
          <AppText variant="headline">{t('Gün əlavə et')}</AppText>
        </PressableScale>

        <View style={styles.note}>
          <Icon name="lock" size={17} color={palette.caption} />
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
            {t('Bu versiyada bütün proqramlar hər kəsə açıqdır və pulsuzdur. SPOT-da onlayn ödəniş yoxdur.')}
          </AppText>
        </View>

        {!ready ? (
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 16, lineHeight: 18 }}>
            {draft.editingId
              ? t('Saxlamaq üçün başlıq yaz və ən azı bir günə hərəkət əlavə et.')
              : t('Yaratmaq üçün başlıq yaz və ən azı bir günə hərəkət əlavə et.')}
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
  const t = useT();
  const timed = item.mode === 'time';
  const [setsText, setSetsText] = useState(String(item.sets));
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <Icon name="dumbbell" size={15} color={palette.textSecondary} />
        <TextInput
          value={item.name}
          onChangeText={(name) => onPatch({ name })}
          placeholder={t('Hərəkətin adı')}
          placeholderTextColor={palette.caption}
          maxLength={80}
          style={styles.itemName}
        />
        <PressableScale
          activeScale={0.9}
          onPress={onRemove}
          style={[styles.removeBtn, styles.removeBtnInItem]}
          accessibilityRole="button"
          accessibilityLabel={t('Hərəkəti sil')}>
          <View style={styles.removeDot}>
            <Icon name="x" size={18} color={palette.textSecondary} />
          </View>
        </PressableScale>
      </View>

      <View style={styles.fields}>
        <View style={styles.field}>
          <AppText variant="caption" color={palette.caption}>
            {t('Set')}
          </AppText>
          {/* The text the person is typing lives here, not in the number.
              Coercing every keystroke made most counts unreachable: backspace
              on «4» produced «» which snapped to «1», and typing 5 then gave
              «15». Any count from 3 to 9 could not be entered at all. The
              number is committed when it is valid and restored on blur when
              the field is left empty. */}
          <TextInput
            value={setsText}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, 2);
              setSetsText(digits);
              const n = Number(digits);
              if (digits && Number.isFinite(n) && n >= 1 && n <= 20) onPatch({ sets: n });
            }}
            onBlur={() => {
              const n = Number(setsText);
              if (!setsText || !Number.isFinite(n) || n < 1) setSetsText(String(item.sets));
              else if (n > 20) {
                setSetsText('20');
                onPatch({ sets: 20 });
              }
            }}
            keyboardType="number-pad"
            maxLength={2}
            selectTextOnFocus
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
                /* The chip is drawn 22 pt tall. The slop takes the 8 pt gap above
                   and the 5 pt gap below (the value field below keeps its own taps)
                   for a 35 pt target. A real 44 pt chip would push this column's
                   field out of line with the «Set» field. The rows around it are
                   layout-only views that Fabric flattens, so the slop is tested
                   inside the move's box — on Android too. Giving modeRow or fields
                   a background would make them real views and cut it off there. */
                hitSlop={{ top: 8, bottom: 5, left: 3, right: 3 }}
                accessibilityRole="button"
                accessibilityState={{ selected: item.mode === m }}
                style={[styles.mode, item.mode === m ? styles.modeOn : null]}>
                <AppText variant="caption" color={item.mode === m ? palette.ink : palette.caption}>
                  {m === 'reps' ? t('Təkrar') : t('Müddət')}
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
                {t('san')}
              </AppText>
            ) : null}
          </View>
        </View>
      </View>

      <PressableScale activeScale={0.97} haptic={false} onPress={onVideo} disabled={uploading} style={styles.videoBtn}>
        <Icon name={item.videoUrl ? 'check' : 'video'} size={15} color={item.videoUrl ? palette.voltDeep : palette.blue} />
        <AppText variant="footnote" color={item.videoUrl ? palette.voltDeep : palette.blue}>
          {uploading ? t('Yüklənir…') : item.videoUrl ? t('Video əlavə olunub') : t('Video əlavə et')}
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
  // 44 = the «x» box below. Held with or without it, so adding a second day does
  // not make the first card's header jump by the box's extra height.
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
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

  /* The «x» that removes a day or a move. It was a 26 pt circle with a 14-15 px
     glyph — the cross itself drew about 7 px wide — and the circle was the whole
     tap target. The target is now a real 44 x 44 box (not hitSlop, which React
     Native never extends past the parent's bounds); the visible circle grows to 30
     with an 18 px glyph. marginRight gives back the box's side room, so the circle
     keeps its place at the card's right edge and the target reaches 7 pt into the
     card padding — both iOS and Android hit-test a child that overflows its row
     like this. The day header is 44 pt tall instead (dayHead): a negative vertical
     margin there would push the box over the «Fokus» field right under it, which
     is drawn later and so would take those taps. */
  removeBtn: { width: 44, height: 44, marginRight: -7, alignItems: 'center', justifyContent: 'center' },
  /* A move's header keeps its ~30 pt height: the box overflows 7 pt above (into
     the row's own top padding) and 7 pt below (into the 8 pt gap before the
     fields), so it covers nothing else that takes a touch. */
  removeBtnInItem: { marginVertical: -7 },
  removeDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  /* «Yarat» / «Saxla» is text, and the press area was only the text's own ~21 pt
     line. 44 pt tall fills the bar; the side padding is given back by the negative
     margin, so the word stays where it was and the target reaches toward the edge. */
  navAction: { height: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, marginRight: -spacing.sm },
  addMove: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, marginTop: 12, borderRadius: 11, backgroundColor: palette.grouped },
  addDay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator },
  note: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: palette.grouped, borderRadius: 14, padding: 14, marginTop: 22 },
});
