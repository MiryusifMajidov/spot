import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { assignStudentProgram } from '@/lib/roles';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { timeAgoAz, useDb } from '@/store/db';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { useMyStudents } from '../students';

/**
 * One student, seen by their trainer.
 *
 * Everything here is real: the student's own public profile and the request
 * they wrote, plus the single lever the trainer actually has — assigning one of
 * their own programs and a note. SPOT never shows the trainer the student's
 * workouts, weight or progress: that data is the student's alone.
 *
 * The assignment is NOT private to the trainer. `assignStudentProgram` writes
 * student_programs, the student's own row is readable to them (policy sp_read),
 * and (tabs)/workout/index.tsx reads it on every focus and prints the title and
 * the note verbatim in the «MÜƏLLİMİN TƏYİN ETDİYİ PROQRAM» card. The screen
 * must say so before the trainer types something they would not say out loud.
 */
export default function StudentDetail() {
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { active, loading, offline, failed, reload } = useMyStudents();
  const myPrograms = useDb((s) => s.myPrograms);

  const student = useMemo(() => active.find((s) => s.profileId === id) ?? null, [active, id]);
  const name = student?.name ?? nameParam ?? 'Şagird';

  const matched = useMemo(
    () => (student?.programTitle ? myPrograms.find((p) => p.title === student.programTitle) ?? null : null),
    [myPrograms, student?.programTitle]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* Android edge-to-edge does not resize the window when the IME opens, so the
     note field and the «Proqramı təyin et» button below it end up under the
     keyboard. The shared primitive measures the OVERLAP; we give it back as
     scroll padding and push the tail of the form into view. */
  const kb = useKeyboardOverlap();
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (!kb) return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [kb]);

  const chosenId = selectedId ?? matched?.id ?? null;
  const chosen = myPrograms.find((p) => p.id === chosenId) ?? null;
  const title = chosen?.title ?? student?.programTitle ?? '';
  const noteValue = note ?? student?.programNote ?? '';

  const save = async () => {
    if (!student || !title || saving) return;
    setSaving(true);
    try {
      await assignStudentProgram({ studentId: student.profileId, programId: chosen?.id ?? null, title, note: noteValue.trim() });
      // The student really does receive this: their Məşq səhifəsi reads
      // student_programs on every focus. Say what happened, not less.
      toast(`${name} üçün proqram təyin edildi — «Məşq» səhifəsində ona görünür`);
      reload();
      router.back();
    } catch {
      toast('Yadda saxlamaq alınmadı — internetini yoxla', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !student) {
    return (
      <Screen edges={['top']}>
        <NavBar title={name} />
        <View style={{ paddingVertical: 60 }}>
          <ActivityIndicator color={palette.tertiary} />
        </View>
      </Screen>
    );
  }

  if (!student) {
    return (
      <Screen edges={['top']}>
        <NavBar title={name} />
        <View style={{ paddingHorizontal: spacing.screen }}>
          <View style={styles.card}>
            <AppText style={{ fontSize: 15, fontWeight: '600', marginBottom: 6 }}>
              {offline ? 'Server bağlantısı yoxdur' : failed ? 'Yüklənmədi' : 'Şagird tapılmadı'}
            </AppText>
            <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.textSecondary }}>
              {offline
                ? 'Şagird məlumatları serverdən gəlir. Bağlantı qurulanda bu səhifə açılacaq.'
                : failed
                  ? 'Məlumatı gətirmək alınmadı. Yenidən cəhd et.'
                  : 'Bu şagird artıq siyahında deyil — sorğu ləğv edilmiş və ya bitmiş ola bilər.'}
            </AppText>
            <PressableScale
              activeScale={0.97}
              accessibilityRole="button"
              accessibilityLabel="Şagirdlərə qayıt"
              onPress={() => router.back()}
              style={[styles.primaryBtn, { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18 }]}>
              <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>Şagirdlərə qayıt</AppText>
            </PressableScale>
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <NavBar
        title={name}
        right={
          <PressableScale
            activeScale={0.9}
            accessibilityRole="button"
            accessibilityLabel={`${name} ilə söhbət`}
            hitSlop={8}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: student.profileId } })}>
            <Icon name="msg" size={21} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 + kb }}>
        {/* --- who they are (their own public profile, nothing more) --- */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Avatar name={name} size={52} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 16, fontWeight: '600' }}>
                {name}
                {student.age ? `, ${student.age}` : ''}
              </AppText>
              <AppText style={{ fontSize: 12.5, color: palette.tertiary, marginTop: 4 }}>
                {[student.level, `${timeAgoAz(student.since)} əvvəldən şagirdin`].filter(Boolean).join(' · ')}
              </AppText>
            </View>
          </View>

          {student.goals.length ? (
            <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: 13 }}>
              {student.goals.map((g) => (
                <View key={g} style={styles.tag}>
                  <AppText style={{ fontSize: 11.5, fontWeight: '600', color: palette.text3 }}>{g}</AppText>
                </View>
              ))}
            </View>
          ) : null}

          {student.note ? (
            <View style={styles.quote}>
              <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 6 }}>
                SORĞUSUNDA YAZDIĞI
              </AppText>
              <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.text3 }}>«{student.note}»</AppText>
            </View>
          ) : null}

          {student.preferredTime ? (
            <View style={styles.timeChip}>
              <Icon name="clock" size={13} color={palette.textSecondary} />
              <AppText style={{ fontSize: 12, color: palette.textSecondary }}>Uyğun vaxt: {student.preferredTime}</AppText>
            </View>
          ) : null}
        </View>

        {/* --- the privacy red line, stated plainly --- */}
        <View style={styles.privacy}>
          <Icon name="lock" size={15} color={palette.textSecondary} />
          <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, flex: 1 }}>
            Şagirdin məşq jurnalı, çəkisi və şəxsi qeydləri sənə göstərilmir — bu məlumat yalnız ona aiddir. Nə etdiyini bilmək üçün ondan söhbətdə soruş.
          </AppText>
        </View>

        {/* --- what the trainer actually controls --- */}
        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 10, marginTop: 4 }}>
          TƏYİN EDİLMİŞ PROQRAM
        </AppText>

        {student.programTitle ? (
          <View style={[styles.card, { marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Icon name="dumbbell" size={16} color={palette.voltDeep} />
              <AppText style={{ fontSize: 14.5, fontWeight: '600', flex: 1 }}>{student.programTitle}</AppText>
            </View>
            {student.programNote ? (
              <AppText style={{ fontSize: 13, lineHeight: 19, color: palette.textSecondary, marginTop: 8 }}>{student.programNote}</AppText>
            ) : null}
          </View>
        ) : (
          <View style={[styles.card, { marginBottom: 12 }]}>
            <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.textSecondary }}>
              Hələ proqram təyin etməmisən. Aşağıdan öz proqramlarından birini seç və təyin et.
            </AppText>
          </View>
        )}

        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 10 }}>
          PROQRAMLARIN
        </AppText>

        {myPrograms.length === 0 ? (
          <View style={[styles.card, { marginBottom: 12 }]}>
            <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.textSecondary }}>
              Hələ proqram yaratmamısan. Əvvəlcə bir proqram yarat, sonra onu şagirdə təyin edə bilərsən.
            </AppText>
            <PressableScale
              activeScale={0.97}
              accessibilityRole="button"
              accessibilityLabel="Proqram yarat"
              onPress={() => router.push('/trainer/programs')}
              style={[styles.primaryBtn, { marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18 }]}>
              <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>Proqram yarat</AppText>
            </PressableScale>
          </View>
        ) : (
          <View style={{ gap: 9, marginBottom: 14 }}>
            {myPrograms.map((p) => {
              const on = p.id === chosenId;
              return (
                <PressableScale
                  key={p.id}
                  activeScale={0.99}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${p.title} proqramını seç`}
                  onPress={() => setSelectedId(p.id)}
                  style={[styles.pickRow, on && { borderColor: palette.ink }]}>
                  <View style={[styles.radio, on && { borderColor: palette.ink, backgroundColor: palette.ink }]}>
                    {on ? <Icon name="check" size={12} color={palette.white} /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{p.title}</AppText>
                    <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 3 }}>
                      {p.weeks} həftə · {p.daysPerWeek} gün/həftə · {p.level}
                    </AppText>
                  </View>
                </PressableScale>
              );
            })}
          </View>
        )}

        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 10 }}>
          QEYD · ŞAGİRD BUNU OXUYUR
        </AppText>
        <TextInput
          value={noteValue}
          onChangeText={setNote}
          multiline
          placeholder="Məs: həftədə 3 gün, çöməltmədə çəkini saxla, video qeydini göndər."
          placeholderTextColor={palette.caption}
          style={styles.input}
        />

        <PressableScale
          activeScale={0.98}
          disabled={!title || saving}
          accessibilityRole="button"
          accessibilityLabel="Proqramı şagirdə təyin et"
          onPress={save}
          style={[styles.saveBtn, (!title || saving) && { opacity: 0.4 }]}>
          <AppText style={{ color: palette.inkText, fontSize: 15, fontWeight: '600' }}>
            {saving ? 'Yadda saxlanılır…' : 'Proqramı təyin et'}
          </AppText>
        </PressableScale>
        {/* The student reads this. (tabs)/workout/index.tsx prints the title and
            the note verbatim on their Məşq screen — do not call it private. */}
        <AppText style={{ fontSize: 12, color: palette.caption, marginTop: 10, lineHeight: 17 }}>
          Proqramın adı və qeydin şagirdin «Məşq» səhifəsində eynilə ona görünür — birbaşa ona yazdığını nəzərə al.
          SPOT-da ödəniş yoxdur — hesablaşmanı şagirdlə özün aparırsan.
        </AppText>
        <PressableScale
          activeScale={0.97}
          accessibilityRole="button"
          accessibilityLabel={`${name} ilə söhbəti aç`}
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: student.profileId } })}
          style={styles.chatBtn}>
          <Icon name="msg" size={15} color={palette.inkText} />
          <AppText style={{ fontSize: 13.5, fontWeight: '600', color: palette.inkText }}>Söhbəti aç</AppText>
        </PressableScale>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 12 },
  tag: { backgroundColor: palette.grouped, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  quote: { backgroundColor: palette.grouped, borderRadius: 12, padding: 12, marginTop: 13 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12, backgroundColor: palette.grouped, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  privacy: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: palette.element, borderRadius: 14, padding: 13, marginBottom: 16 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 13, borderWidth: 1.5, borderColor: 'transparent' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: palette.white, borderRadius: 14, padding: 14, fontSize: 15, minHeight: 96, textAlignVertical: 'top', color: palette.inkText, borderWidth: 1, borderColor: palette.separator },
  primaryBtn: { height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  chatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 13, backgroundColor: palette.element, marginTop: 12 },
  saveBtn: { height: 50, borderRadius: 14, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
});
