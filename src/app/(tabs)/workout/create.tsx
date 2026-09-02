import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { LEVELS } from '@/data/mock';
import { Exercise, Level, Program } from '@/data/types';
import { getMyProfile } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { exerciseById, exerciseLibrary, LibExercise, useDb } from '@/store/db';
import { actionSheet, toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';
import { estimateDurationMin, HOME_MOVES } from './day';

const GOAL_OPTIONS = ['Forma saxlamaq', 'Güc', 'Kütlə yığmaq', 'Arıqlamaq'];
const WEEK_OPTIONS = [2, 4, 8, 12];

/** Everything the user can put in a program: the gym library + the home moves. */
const ALL_MOVES: LibExercise[] = [...exerciseLibrary, ...HOME_MOVES];
const GROUPS: { label: string; muscles: string[] }[] = [
  { label: 'Sinə', muscles: ['Sinə'] },
  { label: 'Bel', muscles: ['Kürək'] },
  { label: 'Ayaq', muscles: ['Ayaq'] },
  { label: 'Arxa ayaq və gluteus', muscles: ['Arxa ayaq', 'Gluteus', 'Baldır'] },
  { label: 'Çiyin', muscles: ['Çiyin'] },
  { label: 'Qol', muscles: ['Biseps', 'Triseps'] },
  { label: 'Core', muscles: ['Qarın'] },
  { label: 'Tam bədən', muscles: ['Tam bədən'] },
];

interface DraftDay {
  title: string;
  focus: string;
  ids: string[];
}

const toExercise = (m: LibExercise): Exercise => ({
  id: m.id,
  name: m.name,
  muscle: m.muscle,
  sets: m.defaultSets,
  reps: m.reps,
  commonMistake: m.commonMistake,
  substitutes: m.substitutes,
});

export default function CreateProgram() {
  const router = useRouter();
  const gate = useAuthGate();
  const profile = useAppStore((s) => s.profile);
  const name = profile.name || 'Sən';
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [level, setLevel] = useState(1);
  const [goal, setGoal] = useState(0);
  const [weeks, setWeeks] = useState(1); // index into WEEK_OPTIONS
  const [days, setDays] = useState<DraftDay[]>([{ title: 'Gün 1', focus: '', ids: [] }]);
  const [saving, setSaving] = useState(false);

  const moves = (d: DraftDay) => d.ids.map((id) => ALL_MOVES.find((m) => m.id === id)).filter((m): m is LibExercise => !!m);
  const allMoves = days.flatMap(moves);
  // How many of the chosen moves really carry a clip. Every library move is
  // currently `videoUrl: ''`, so this is 0 — and the card below says that
  // instead of counting the moves and calling them videos.
  const withVideo = allMoves.filter((m) => !!exerciseById(m.id)?.videoUrl).length;
  const ready = !!title.trim() && days.some((d) => d.ids.length > 0);

  const addDay = () => setDays((s) => [...s, { title: `Gün ${s.length + 1}`, focus: '', ids: [] }]);
  const removeDay = (i: number) => setDays((s) => (s.length > 1 ? s.filter((_, x) => x !== i) : s));
  const patchDay = (i: number, patch: Partial<DraftDay>) => setDays((s) => s.map((d, x) => (x === i ? { ...d, ...patch } : d)));
  const removeMove = (i: number, id: string) => patchDay(i, { ids: days[i].ids.filter((x) => x !== id) });

  const pickMove = (dayIdx: number) => {
    actionSheet({
      title: 'Əzələ qrupu',
      actions: [
        ...GROUPS.map((g) => ({
          label: g.label,
          onPress: () =>
            setTimeout(
              () =>
                actionSheet({
                  title: g.label,
                  actions: [
                    ...ALL_MOVES.filter((e) => g.muscles.includes(e.muscle)).map((e) => ({
                      label: `${e.name} · ${e.equipment}`,
                      onPress: () =>
                        setDays((s) => s.map((d, x) => (x === dayIdx && !d.ids.includes(e.id) ? { ...d, ids: [...d.ids, e.id] } : d))),
                    })),
                    { label: 'Bağla', style: 'cancel' as const },
                  ],
                }),
              250
            ),
        })),
        { label: 'Bağla', style: 'cancel' as const },
      ],
    });
  };

  const create = () =>
    gate(async () => {
      if (!ready || saving) return;
      setSaving(true);
      const built = days.map((d) => ({
        title: d.title.trim() || 'Gün',
        focus: d.focus.trim() || moves(d).map((m) => m.muscle).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'Tam bədən',
        exercises: moves(d).map(toExercise),
      }));
      const bodyweightOnly = allMoves.length > 0 && allMoves.every((m) => m.equipment === 'Bədən');
      // No audience tag: `programs` has no audience column and its read policy is
      // public, so a 'Zalım' tag would restrict nothing — it would only make the
      // supposedly private program match MORE text searches in the library.
      const tags = bodyweightOnly ? ['Evdə', 'Avadanlıqsız'] : [];
      const program: Omit<Program, 'id'> & { desc: string } = {
        desc: desc.trim(),
        title: title.trim(),
        creatorName: name,
        creatorType: profile.role === 'trainer' ? 'trainer' : 'user',
        creatorVerified: false,
        weeks: WEEK_OPTIONS[weeks],
        daysPerWeek: built.length,
        level: LEVELS[level] as Level,
        goal: GOAL_OPTIONS[goal],
        paid: false,
        rating: 0,
        minutes: estimateDurationMin(allMoves.length ? moves(days.find((d) => d.ids.length)!) : []),
        // Moves that actually HAVE a clip — not moves that exist in the library.
        // The old expression counted library membership, so a program built from
        // six moves was saved as «6 video» and its detail page printed that,
        // while `exerciseLibrary` holds `videoUrl: ''` for every single move
        // (SPOT owns no technique footage yet — see the NO_VIDEO note in
        // src/store/db.ts). It was a count of videos that do not exist.
        videoCount: allMoves.filter((m) => !!exerciseById(m.id)?.videoUrl).length,
        doneBy: 0,
        tags,
        saves: 0,
        days: built,
      };

      // Local engine first — the program must exist and be runnable offline.
      const id = useDb.getState().createProgram(program);

      // Then mirror to Supabase (so other users / the admin panel can see it).
      if (hasSupabaseConfig) {
        // `creator_verified`, `rating`, `done_by` and `saves` are NOT written:
        // schema34 withholds them from every client, because a program's badge
        // and its popularity are not the author's to declare — and the library
        // sorts by `saves`, so a self-assigned number would buy the top of the
        // list. The database defaults them to false/0 and only real activity
        // moves them.
        const base = {
          id,
          title: program.title,
          creator_name: program.creatorName,
          creator_type: program.creatorType,
          weeks: program.weeks,
          days_per_week: program.daysPerWeek,
          level: program.level,
          goal: program.goal,
          paid: false,
          minutes: program.minutes,
          video_count: program.videoCount,
          tags: program.tags,
          days: built.map((d) => ({ title: d.title, focus: d.focus, exercise_ids: d.exercises.map((e) => e.id) })),
        };
        try {
          // owner_id is a FK to profiles(id) — NOT the auth uid. Writing the auth uid
          // violated the FK, so every created program fell back to an OWNERLESS row
          // and its creator could never edit it again (policy `programs_update`
          // matches on owner_id).
          const me = await getMyProfile();
          // `owner_id` is now REQUIRED by the insert policy (schema34) — an
          // ownerless program cannot be edited by anybody, which is the bug
          // schema9 documented, and it is also how a program could be attributed
          // to someone who never wrote it. So the retry-without-owner_id path is
          // gone: no profile means no server copy, and the catch below says so.
          if (!me?.id) throw new Error('no profile');
          const { error } = await supabase
            .from('programs')
            .insert({ ...base, owner_id: me.id, description: program.desc || null });
          if (error) throw error;
        } catch {
          toast('Proqram cihazında saxlanıldı — serverə göndərilmədi', 'info');
          setSaving(false);
          router.back();
          return;
        }
      }
      // The «təsvir saxlanılmadı» variant is gone with the retry that produced
      // it: the insert now either lands whole or reports failure, so there is no
      // half-saved program to warn about.
      toast('Proqram yaradıldı — kitabxanadadır', 'success');
      setSaving(false);
      router.back();
    }, 'Proqram yaratmaq üçün');

  return (
    <Screen>
      <NavBar
        right={
          <PressableScale onPress={ready ? create : undefined} haptic={false} activeScale={0.94}>
            <AppText variant="headline" color={ready ? palette.blue : palette.tertiary}>
              Yarat
            </AppText>
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <AppText variant="title" style={{ marginBottom: 18 }}>
          Proqram yarat
        </AppText>

        <Label text="Başlıq" />
        <TextInput value={title} onChangeText={setTitle} placeholder="Məsələn: Evdə 20 dəqiqə" placeholderTextColor={palette.caption} style={styles.input} />

        <Label text="Təsvir" />
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder="Proqram kimə uyğundur, nə lazımdır?"
          placeholderTextColor={palette.caption}
          multiline
          style={[styles.input, { height: 92, paddingTop: 12, textAlignVertical: 'top' }]}
        />

        <Label text="Səviyyə" />
        <Segmented options={[...LEVELS]} value={level} onChange={setLevel} />

        <Label text="Məqsəd" />
        <Segmented options={GOAL_OPTIONS} value={goal} onChange={setGoal} />

        <Label text="Neçə həftə" />
        <Segmented options={WEEK_OPTIONS.map((w) => `${w} həftə`)} value={weeks} onChange={setWeeks} />

        {/* ---- day builder ---- */}
        <Label text="Proqram günləri" />
        {days.map((d, i) => (
          <View key={i} style={styles.dayCard}>
            <View style={styles.dayHead}>
              <View style={styles.dayIndex}>
                <AppText style={{ fontSize: 13, fontWeight: '700', color: palette.voltDeep }}>{i + 1}</AppText>
              </View>
              <TextInput
                value={d.title}
                onChangeText={(v) => patchDay(i, { title: v })}
                placeholder={`Gün ${i + 1}`}
                placeholderTextColor={palette.caption}
                style={styles.dayTitleInput}
              />
              {days.length > 1 ? (
                <PressableScale activeScale={0.9} onPress={() => removeDay(i)} style={styles.removeBtn}>
                  <Icon name="x" size={15} color={palette.textSecondary} />
                </PressableScale>
              ) : null}
            </View>
            <TextInput
              value={d.focus}
              onChangeText={(v) => patchDay(i, { focus: v })}
              placeholder="Fokus (məs: sinə, triseps)"
              placeholderTextColor={palette.caption}
              style={styles.focusInput}
            />

            {moves(d).map((m) => (
              <View key={m.id} style={styles.moveRow}>
                <Icon name="dumbbell" size={15} color={palette.textSecondary} />
                <View style={{ flex: 1 }}>
                  <AppText variant="subhead">{m.name}</AppText>
                  <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
                    {m.defaultSets} set × {m.reps} · {m.equipment}
                  </AppText>
                </View>
                <PressableScale activeScale={0.9} onPress={() => removeMove(i, m.id)} style={styles.removeBtn}>
                  <Icon name="x" size={14} color={palette.textSecondary} />
                </PressableScale>
              </View>
            ))}

            <PressableScale activeScale={0.97} onPress={() => pickMove(i)} style={styles.addMove}>
              <Icon name="plus" size={16} color={palette.blue} />
              <AppText variant="subhead" color={palette.blue}>
                Hərəkət əlavə et
              </AppText>
            </PressableScale>
          </View>
        ))}

        <PressableScale activeScale={0.97} onPress={addDay} style={styles.addDay}>
          <Icon name="plus" size={17} color={palette.inkText} />
          <AppText variant="headline">Gün əlavə et</AppText>
        </PressableScale>

        {/* Video note — honest about where the videos come from */}
        <View style={styles.videoCard}>
          <View style={styles.videoIcon}>
            <Icon name="video" size={18} color={palette.voltDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="callout">
              {withVideo > 0
                ? `${withVideo} hərəkətin videosu var`
                : 'Hərəkət videoları hələ yoxdur'}
            </AppText>
            <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
              {withVideo > 0
                ? 'SPOT kitabxanasından seçdiyin hərəkətlər set, təkrar və ən çox edilən səhvi ilə birlikdə gəlir.'
                : 'SPOT kitabxanasından seçdiyin hərəkətlər set, təkrar və ən çox edilən səhvi ilə gəlir — texnika videoları çəkiləndən sonra əlavə olunacaq.'}
            </AppText>
          </View>
        </View>

        {/* Visibility was a segmented control that stored nothing readable — every
         *  program is published publicly either way. A switch that does not switch
         *  anything is worse than no switch, so we state the truth instead. */}
        <View style={styles.lockedRow}>
          <Icon name="lock" size={18} color={palette.caption} />
          <View style={{ flex: 1 }}>
            <AppText variant="callout" color={palette.textSecondary}>
              Kim görə bilər
            </AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
              Bu versiyada bütün proqramlar hər kəsə açıqdır.
            </AppText>
          </View>
        </View>

        {/* Paid (locked) */}
        <View style={styles.lockedRow}>
          <Icon name="lock" size={18} color={palette.caption} />
          <View style={{ flex: 1 }}>
            <AppText variant="callout" color={palette.textSecondary}>
              Ödənişli proqram
            </AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
              SPOT-da ödəniş yoxdur — bütün proqramlar pulsuzdur.
            </AppText>
          </View>
        </View>

        {!ready ? (
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 18, lineHeight: 18 }}>
            Yaratmaq üçün başlıq yaz və ən azı bir günə hərəkət əlavə et.
          </AppText>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Label({ text }: { text: string }) {
  return (
    <AppText variant="overline" color={palette.caption} style={{ marginTop: 18, marginBottom: 10 }}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  input: { backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, height: 52, fontSize: 16, color: palette.inkText },
  dayCard: { backgroundColor: palette.white, borderRadius: 16, padding: 14, marginBottom: 10 },
  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayIndex: { width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  dayTitleInput: { flex: 1, fontSize: 16, fontWeight: '600', color: palette.inkText, paddingVertical: 6 },
  focusInput: { fontSize: 13.5, color: palette.textSecondary, paddingVertical: 6, marginLeft: 38 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  removeBtn: { width: 26, height: 26, borderRadius: 13, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  addMove: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, marginTop: 4, borderRadius: 11, backgroundColor: palette.grouped },
  addDay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator },
  videoCard: { flexDirection: 'row', gap: 12, backgroundColor: 'rgba(198,255,61,0.16)', borderRadius: 14, padding: 14, marginTop: 22 },
  videoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(198,255,61,0.30)', alignItems: 'center', justifyContent: 'center' },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.grouped, borderRadius: 14, padding: 14, marginTop: 22 },
});
