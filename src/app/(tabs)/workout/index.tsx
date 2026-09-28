import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { afterTransition } from '@/lib/afterTransition';
import { useProgram } from '@/lib/hooks';
import { t } from '@/lib/i18n';
import { getMyAssignedProgram, type AssignedProgram } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useFormat, useT, type Fmt } from '@/lib/useT';
import { exerciseLibrary, useAllPrograms, useDb, useWeekStats } from '@/store/db';
import { hitSlop, palette, spacing } from '@/theme';
import { estimateDurationMin, resolveDayExercises } from './day';

/**
 * Məşq — one job: start today's workout.
 *
 * This tab used to carry eight sections: today's card, a three-step onboarding
 * checklist, three tiles (check-in, a meal planner, bodyweight), a weekly chart,
 * programs, the exercise library and a second «Evdə məşq» engine. Starting a
 * workout from a program took six taps — Proqramlar → Kitabxana → program → day →
 * Məşqə başla → session — and nothing on screen said who had written any of it.
 *
 * What is left is what a person actually opens this tab to do:
 *   1. the workout that is due today, with ONE button that starts it;
 *   2. what a trainer has assigned, when somebody has;
 *   3. the week so far, in three numbers;
 *   4. the programs, and a way to write one.
 * Check-in moved to the QR tab. The meal planner and bodyweight tracking are
 * gone. There is one exercise library and one session logger.
 */

/* The week's training time. It is the sum of each logged session's own clock
   (session.tsx stores `durationMin` = from start to finish), so it is time spent
   TRAINING — a home session counts, a check-in does not. It was labelled «zalda»
   («at the gym»), which it never measured, and printed as «0d» — «d» for
   dəqiqə, which nobody could read. Minutes up to an hour, then hours with one
   decimal («1,5 saat»): «1 saat 20 dəq» does not fit a third of the card.

   The translator and formatter are passed in, not read from the module: the
   compiler memoises this call by its arguments, and a helper that reads the
   language on the side would keep the first language forever (see src/lib/useT.ts). */
const fmtTrainingTime = (sec: number, tr: typeof t, fmt: Fmt) => {
  const min = Math.round(sec / 60);
  if (min < 60) return tr('{n} dəq', { n: min, count: min });
  const h = Math.round(min / 6) / 10; // hours, one decimal
  return tr('{n} saat', { n: Number.isInteger(h) ? String(h) : fmt.decimal(h, 1) });
};

/* «Hamısı» is one 18 pt line of subhead text: 13 pt above and below makes the
   44 pt target (the shared 8 pt slop alone gave 34). */
const linkSlop = { ...hitSlop, top: 13, bottom: 13 };

export default function WorkoutToday() {
  const router = useRouter();
  const t = useT();
  const fmt = useFormat();
  const programs = useAllPrograms();
  const workouts = useDb((s) => s.workouts);
  const saved = useDb((s) => s.savedPrograms);
  const week = useWeekStats();

  /* «The program I'm following» = the one I last trained with, else the one I
     saved. Never an arbitrary catalogue row — with none, the card says so.

     Resolved through `useProgram`, which reads this phone's own copy first and
     then the server. The list above holds only the person's OWN programs and
     SPOT's four starters, so a trainer's program — the whole reason a student
     is here — was never in it: after Day 1 of a coach's plan the card said
     «Sərbəst məşq», and «Məşqə başla» opened a generic library workout instead
     of the coach's Day 2. */
  const followingId = useMemo(() => {
    const lastId = workouts.find((w) => w.programId)?.programId;
    return lastId ?? saved.find((id) => !!id) ?? '';
  }, [workouts, saved]);
  const followed = useProgram(followingId);
  const active = useMemo(
    () => followed ?? programs.find((p) => saved.includes(p.id)) ?? null,
    [followed, programs, saved]
  );

  // Which day comes next = how many sessions I have logged against this program.
  const dayCount = active?.days?.length ?? 0;
  const doneForProgram = active ? workouts.filter((w) => w.programId === active.id).length : 0;
  const todayDayIndex = dayCount ? doneForProgram % dayCount : 0;
  const todayTitle = active?.days?.[todayDayIndex]?.title ?? 'Sərbəst məşq';
  const todayExercises = useMemo(
    () => (active ? resolveDayExercises(active, todayDayIndex, todayTitle, true) : []),
    [active, todayDayIndex, todayTitle]
  );
  const todayMinutes = todayExercises.length ? estimateDurationMin(todayExercises) : 0;

  const start = () =>
    router.push({
      pathname: '/(tabs)/workout/session',
      params: { programId: active?.id ?? '', dayIndex: String(todayDayIndex), title: todayTitle },
    });

  /* The program a trainer assigned to this student. `failed` is tracked apart: a
     read that errored must never be shown as «no trainer assigned you anything». */
  const [assigned, setAssigned] = useState<AssignedProgram | null>(null);
  const [assignedFailed, setAssignedFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig) return;
      let alive = true;
      const cancel = afterTransition(() => {
        getMyAssignedProgram()
          .then((a) => {
            if (!alive) return;
            setAssigned(a);
            setAssignedFailed(false);
          })
          .catch(() => alive && setAssignedFailed(true));
      });
      return () => {
        alive = false;
        cancel();
      };
    }, [])
  );

  const now = new Date();
  const dateLabel = fmt.weekdayAndDate(now);

  return (
    <Screen>
      {/* iOS 26: the Liquid Glass tab bar floats over this list. Left at RN's
          default («never») the last row («Hərəkət kitabxanası») would end under the
          glass — 32 pt of padding cannot scroll it out. react-native-screens does
          switch a tab's scroll view to «automatic», but only the one it finds down
          the FIRST-child chain at mount; saying it here does not depend on that.
          «automatic» lets UIKit add the tab bar's safe area at the bottom; the top
          is already padded by Screen, so nothing is added there (the same pairing
          as Screen's own `scroll` mode). iOS-only prop; Android's bar reserves its
          own space. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <AppText variant="footnote" color={palette.caption}>
              {dateLabel}
            </AppText>
            <AppText variant="largeTitle" style={{ marginTop: 4 }}>
              {t('Məşq')}
            </AppText>
          </View>
          <PressableScale
            activeScale={0.9}
            onPress={() => router.push('/chat')}
            accessibilityRole="button"
            accessibilityLabel={t('Söhbətlər')}
            style={styles.headerBtn}>
            <Icon name="msg" size={24} color={palette.inkText} />
          </PressableScale>
        </View>

        {/* ---------- 1. today, and the one button ---------- */}
        <View style={styles.todayCard}>
          <AppText variant="overline" style={{ color: palette.volt }}>
            {t('BUGÜNKÜ MƏŞQ')}
          </AppText>
          <AppText variant="title2" style={{ color: palette.white, marginTop: 8 }}>
            {t(todayTitle)}
          </AppText>
          <AppText variant="footnote" style={{ color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
            {active
              ? todayExercises.length
                ? t('{n} hərəkət · ~{min} dəq · {title}', {
                    n: todayExercises.length,
                    min: todayMinutes,
                    title: t(active.title),
                    count: todayExercises.length,
                  })
                : t(active.title)
              : t('Hərəkətləri özün seçəcəksən')}
          </AppText>

          <PressableScale activeScale={0.97} onPress={start} style={styles.startBtn}>
            <Icon name="play" size={18} color={palette.ink} />
            <AppText style={{ fontSize: 16, fontWeight: '700', color: palette.ink }}>{t('Məşqə başla')}</AppText>
          </PressableScale>

          {!active ? (
            <AppText variant="caption" style={{ color: 'rgba(255,255,255,0.5)', marginTop: 10, lineHeight: 17 }}>
              {t('Proqram seçsən, hər dəfə bura növbəti günün çıxacaq.')}
            </AppText>
          ) : null}
        </View>

        {/* ---------- 2. what a trainer assigned ---------- */}
        {assigned ? (
          <PressableScale
            activeScale={assigned.programId ? 0.98 : 1}
            /* A trainer can assign a program by NAME, with no row behind it (the
               plan lives on their own phone). There is nothing to open then, so
               the row does not pretend to be a link. */
            onPress={
              assigned.programId
                ? () => router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: assigned.programId as string } })
                : undefined
            }
            style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="user" size={17} color={palette.voltDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="subhead">{assigned.title}</AppText>
              <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
                {assigned.trainerName ? t('{name} sənə təyin etdi', { name: assigned.trainerName }) : t('Müəllimin sənə təyin etdi')}
              </AppText>
            </View>
            {assigned.programId ? <Icon name="chevR" size={16} color={palette.tertiary} /> : null}
          </PressableScale>
        ) : assignedFailed ? (
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="x" size={16} color={palette.red} />
            </View>
            <AppText variant="caption" color={palette.textSecondary} style={{ flex: 1, lineHeight: 17 }}>
              {t('Müəllim təyinatı yüklənmədi — bu, təyinat olmadığı demək deyil.')}
            </AppText>
          </View>
        ) : null}

        {/* ---------- 3. the week, in three numbers ---------- */}
        <View style={styles.week}>
          {/* `count` picks the plural: «1 тренировка», not «1 тренировок». */}
          <Stat value={String(week.count)} label={t('məşq', { count: week.count })} />
          <View style={styles.vdiv} />
          <Stat value={t('{n} t', { n: fmt.decimal(week.volumeKg / 1000, 1) })} label={t('həcm')} />
          <View style={styles.vdiv} />
          <Stat value={fmtTrainingTime(week.durationSec, t, fmt)} label={t('məşq vaxtı')} />
        </View>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 8 }}>
          {t('Bu həftə')}
        </AppText>

        {/* ---------- 4. programs ---------- */}
        <View style={styles.sectionHead}>
          <AppText variant="title3">{t('Proqramlar')}</AppText>
          <PressableScale haptic={false} hitSlop={linkSlop} onPress={() => router.push('/(tabs)/workout/library')}>
            <AppText variant="subhead" color={palette.blue}>
              {t('Hamısı')}
            </AppText>
          </PressableScale>
        </View>

        {active ? (
          <PressableScale
            activeScale={0.98}
            onPress={() => router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: active.id } })}
            style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="dumbbell" size={17} color={palette.voltDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="subhead">{t(active.title)}</AppText>
              <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
                {active.creatorName} · {t('{n} gün', { n: dayCount, count: dayCount })}
              </AppText>
            </View>
            <Icon name="chevR" size={16} color={palette.tertiary} />
          </PressableScale>
        ) : (
          <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/workout/library')} style={styles.row}>
            <View style={styles.rowIcon}>
              <Icon name="search" size={17} color={palette.voltDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="subhead">{t('Proqram seç')}</AppText>
              <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
                {t('SPOT-un, müəllimlərin və istifadəçilərin proqramları')}
              </AppText>
            </View>
            <Icon name="chevR" size={16} color={palette.tertiary} />
          </PressableScale>
        )}

        <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/workout/create')} style={styles.row}>
          <View style={styles.rowIcon}>
            <Icon name="plus" size={17} color={palette.voltDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="subhead">{t('Proqram yarat')}</AppText>
            <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
              {t('Günləri yaz, hərəkətləri seç — istəsən paylaş')}
            </AppText>
          </View>
          <Icon name="chevR" size={16} color={palette.tertiary} />
        </PressableScale>

        <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/workout/exercises')} style={styles.row}>
          <View style={styles.rowIcon}>
            <Icon name="grid" size={17} color={palette.voltDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="subhead">{t('Hərəkət kitabxanası')}</AppText>
            <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
              {t('{n} hərəkət · texnika və səhvlər', { n: exerciseLibrary.length, count: exerciseLibrary.length })}
            </AppText>
          </View>
          <Icon name="chevR" size={16} color={palette.tertiary} />
        </PressableScale>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      {/* A third of the card is ~80 pt on a small phone: shrink, never wrap. */}
      <AppText variant="title3" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {value}
      </AppText>
      <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 8, paddingBottom: 18 },
  /* A 44 pt target around a 24 px glyph. The negative margin keeps the GLYPH on
     the cards' right edge; only the invisible target reaches into the gutter. */
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  todayCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 20 },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.volt,
    marginTop: 18,
  },
  week: {
    flexDirection: 'row',
    /* Top, not centre: if one label wraps (large system text, a longer
       translation) the three numbers must still sit on one line. */
    alignItems: 'flex-start',
    backgroundColor: palette.white,
    borderRadius: 16,
    padding: 16,
    marginTop: 20,
  },
  vdiv: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: palette.separator, marginHorizontal: 14 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(198,255,61,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
