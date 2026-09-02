import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { exerciseLibrary, gymById, useAllPrograms, useDb, useLatestWeight, useStats, useWeekStats } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { getMyAssignedProgram, type AssignedProgram } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import { afterTransition } from '@/lib/afterTransition';
import { palette, spacing } from '@/theme';
import { estimateDurationMin, resolveDayExercises } from './day';
import { useNutritionSummary } from './nutrition';

const DAY_LABELS = ['B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş', 'B']; // Mon..Sun
const AZ_DAYS = ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'];
const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}s ${m}d` : `${m}d`;
}

export default function WorkoutToday() {
  const router = useRouter();
  const programs = useAllPrograms();
  const workouts = useDb((s) => s.workouts);
  const saved = useDb((s) => s.savedPrograms);

  const stats = useStats();
  const week = useWeekStats();
  const weight = useLatestWeight();
  const nutrition = useNutritionSummary();
  // Never substitute a catalogue gym for one the user has not chosen.
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const homeGym = homeGymId ? gymById(homeGymId) : undefined;

  // "The program I'm following" = the one I last trained with, else the one I
  // saved. Never an arbitrary catalogue row — if there is none, we say so.
  const active = useMemo(() => {
    const lastId = workouts.find((w) => w.programId)?.programId;
    return programs.find((p) => p.id === lastId) ?? programs.find((p) => saved.includes(p.id)) ?? null;
  }, [programs, workouts, saved]);

  // Which day comes next = how many sessions I have logged against this program.
  const dayCount = active?.days?.length ?? 0;
  const doneForProgram = active ? workouts.filter((w) => w.programId === active.id).length : 0;
  const todayDayIndex = dayCount ? doneForProgram % dayCount : 0;
  const todayDay = active?.days?.[todayDayIndex];
  const todayTitle = todayDay?.title ?? 'Sərbəst məşq';
  const todayExercises = useMemo(
    () => (active ? resolveDayExercises(active, todayDayIndex, todayTitle) : []),
    [active, todayDayIndex, todayTitle]
  );
  const todayMinutes = active?.minutes || estimateDurationMin(todayExercises);

  const startToday = () =>
    router.push({ pathname: '/(tabs)/workout/session', params: { programId: active?.id ?? '', dayIndex: String(todayDayIndex), title: todayTitle } });

  /* The program a trainer assigned to this student. Until now `getMyAssignedProgram`
     had no callers at all, so an assignment the trainer was told had been delivered
     never reached the student's app. `failed` is tracked separately: a read that
     errored must not be shown as "no trainer has assigned you anything".
     The fetch runs after interactions so it cannot delay the native tab switch. */
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
  const dateLabel = `${AZ_DAYS[now.getDay()]}, ${now.getDate()} ${AZ_MONTHS[now.getMonth()]}`;
  const todayIdx = (now.getDay() + 6) % 7;
  const maxVol = Math.max(1, ...week.perDay);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <AppText variant="footnote" color={palette.caption}>
              {dateLabel}
            </AppText>
            <AppText variant="largeTitle" style={{ marginTop: 4 }}>
              Məşq
            </AppText>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.streak}>
              <Icon name="flame" size={15} color={palette.streak} />
              <AppText style={{ fontSize: 13, fontWeight: '700', color: '#D14A15' }}>{stats.streakDays}</AppText>
            </View>
            <PressableScale activeScale={0.9} onPress={() => router.push('/chat')}>
              <Icon name="msg" size={25} color={palette.inkText} />
            </PressableScale>
          </View>
        </View>

        {/* What a trainer assigned to me — shown only when one really exists. */}
        {assigned ? (
          <PressableScale
            activeScale={0.98}
            onPress={() =>
              assigned.programId
                ? router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: assigned.programId } })
                : undefined
            }
            style={styles.assignedCard}>
            <View style={styles.assignedHead}>
              <Icon name="verified" size={14} color={palette.blue} />
              <AppText variant="overline" color={palette.blue}>
                MÜƏLLİMİN TƏYİN ETDİYİ PROQRAM
              </AppText>
            </View>
            <AppText variant="title3" style={{ marginTop: 8 }}>
              {assigned.title}
            </AppText>
            {assigned.trainerName ? (
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3 }}>
                {assigned.trainerName}
              </AppText>
            ) : null}
            {assigned.note ? (
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
                «{assigned.note}»
              </AppText>
            ) : null}
            {assigned.programId ? (
              <View style={styles.assignedGo}>
                <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>Proqrama bax</AppText>
                <Icon name="chevR" size={14} color={palette.inkText} />
              </View>
            ) : null}
          </PressableScale>
        ) : assignedFailed ? (
          <View style={styles.assignedFail}>
            <Icon name="x" size={14} color="#FF9500" />
            <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
              Müəllim proqramı yoxlanıla bilmədi — bağlantını yoxla.
            </AppText>
          </View>
        ) : null}

        {/* New-user roadmap (only until the first workout is logged) */}
        {stats.count === 0 ? (
          <View style={styles.roadmap}>
            <AppText variant="overline" color={palette.voltDeep} style={{ marginBottom: 12 }}>
              BAŞLANĞIC · 3 ADDIM
            </AppText>
            {homeGym ? (
              <RoadStep n={1} done label="Zalını seçdin" sub={homeGym.name} />
            ) : (
              <RoadStep
                n={1}
                label="Zalını seç"
                sub="Yoldaşlar və check-in zala görə işləyir"
                onPress={() => router.push('/(tabs)/profile/edit')}
              />
            )}
            <RoadStep
              n={2}
              label="İlk məşqini et"
              sub={active ? 'Bugünkü məşqlə başla — statistikan buradan yığılır' : 'Kitabxanadan proqram seç və başla'}
              onPress={active ? startToday : () => router.push('/(tabs)/workout/library')}
            />
            <RoadStep n={3} label="İlk yoldaşını tap" sub="Kəşf → Yoldaşlar" onPress={() => router.push('/(tabs)/discover')} />
          </View>
        ) : null}

        {/* Today's workout */}
        {active ? (
          <View style={styles.todayCard}>
            <View style={styles.todayHead}>
              <View style={styles.voltDot} />
              <AppText style={styles.todayOverline}>BUGÜNKÜ MƏŞQ</AppText>
            </View>
            <AppText style={styles.todayTitle}>{todayTitle}</AppText>
            <AppText style={styles.todaySub}>
              {todayExercises.length} hərəkət · ~{todayMinutes} dəq · {active.title}
            </AppText>
            {dayCount > 1 ? (
              <View style={styles.progress}>
                {Array.from({ length: dayCount }).map((_, i) => (
                  <View key={i} style={[styles.progressSeg, { backgroundColor: i < todayDayIndex ? palette.volt : 'rgba(255,255,255,0.2)' }]} />
                ))}
              </View>
            ) : null}
            <PressableScale onPress={startToday} style={styles.startBtn}>
              <Icon name="play" size={19} color={palette.inkText} />
              <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>Məşqə başla</AppText>
            </PressableScale>
          </View>
        ) : (
          <View style={styles.todayCard}>
            <View style={styles.todayHead}>
              <View style={styles.voltDot} />
              <AppText style={styles.todayOverline}>PROQRAM SEÇİLMƏYİB</AppText>
            </View>
            <AppText style={styles.todayTitle}>Hansı proqramla gedirsən?</AppText>
            <AppText style={styles.todaySub}>
              Kitabxanadan bir proqram seç (və ya özün yarat) — bundan sonra bugünkü məşqin burada görünəcək.
            </AppText>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <PressableScale onPress={() => router.push('/(tabs)/workout/library')} style={[styles.startBtn, { flex: 1, marginTop: 0 }]}>
                <AppText style={{ fontSize: 15, fontWeight: '600', color: palette.inkText }}>Kitabxana</AppText>
              </PressableScale>
              <PressableScale onPress={() => router.push('/(tabs)/workout/home')} style={[styles.startBtn, { flex: 1, marginTop: 0, backgroundColor: 'rgba(255,255,255,0.14)' }]}>
                <AppText style={{ fontSize: 15, fontWeight: '600', color: palette.white }}>Evdə məşq</AppText>
              </PressableScale>
            </View>
          </View>
        )}

        {/* Quick tiles */}
        <View style={styles.tiles}>
          <QuickTile icon="qr" title="Check-in" sub={homeGym?.name ?? 'Zal seç'} onPress={() => router.push('/(tabs)/workout/checkin')} />
          <QuickTile
            icon="meal"
            title="Qida"
            sub={nutrition.target ? `${nutrition.consumed} / ${nutrition.target} kkal` : `${nutrition.consumed} kkal`}
            onPress={() => router.push('/(tabs)/workout/nutrition')}
          />
          <QuickTile icon="scale" title="Çəki" sub={weight != null ? `${weight} kq` : 'Qeyd et'} onPress={() => router.push('/(tabs)/workout/weight')} />
        </View>

        {/* This week */}
        <SectionHeader title="Bu həftə" action="Detallar" onAction={() => router.push('/(tabs)/profile/analytics')} />
        <View style={styles.card}>
          <View style={styles.chart}>
            {DAY_LABELS.map((label, i) => {
              const vol = week.perDay[i];
              const isToday = i === todayIdx;
              const h = vol > 0 ? 14 + Math.round((vol / maxVol) * 46) : 14;
              const bg = isToday ? palette.volt : vol > 0 ? palette.ink : 'rgba(120,120,128,0.18)';
              return (
                <View key={label} style={styles.barCol}>
                  <View style={[styles.bar, { height: h, backgroundColor: bg }]} />
                  <AppText style={[styles.barLabel, isToday && { color: palette.inkText, fontWeight: '600' }]}>{label}</AppText>
                </View>
              );
            })}
          </View>
          <View style={styles.statsRow}>
            <Stat value={`${week.count}`} label="məşq" />
            <View style={styles.statDivider} />
            <Stat value={`${(week.volumeKg / 1000).toFixed(1)} t`} label="ümumi həcm" />
            <View style={styles.statDivider} />
            <Stat value={fmtDuration(week.durationSec)} label="zalda vaxt" />
          </View>
        </View>

        {/* Programs */}
        <SectionHeader title="Proqramlar" action="Kitabxana" onAction={() => router.push('/(tabs)/workout/library')} />
        <PressableScale
          activeScale={0.98}
          onPress={() =>
            active
              ? router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: active.id } })
              : router.push('/(tabs)/workout/library')
          }
          style={styles.activeProgram}>
          <View style={styles.programIcon}>
            <Icon name="dumbbell" size={20} color="#B4B4BB" />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="callout">{active?.title ?? 'Proqram seç'}</AppText>
            <View style={styles.programMeta}>
              {active?.creatorVerified ? <Icon name="verified" size={12} color={palette.blue} /> : null}
              <AppText variant="caption" color={palette.caption}>
                {active ? `${active.creatorName} · ${active.level}` : 'Kitabxanadan seç və ya özün yarat'}
              </AppText>
            </View>
          </View>
          <Icon name="chevR" size={18} color={palette.tertiary} />
        </PressableScale>

        {/* Tools */}
        <View style={styles.toolRow}>
          <PressableScale activeScale={0.97} onPress={() => router.push('/(tabs)/workout/exercises')} style={styles.tool}>
            <Icon name="grid" size={20} color={palette.inkText} />
            <AppText style={{ fontSize: 13.5, fontWeight: '600', marginTop: 9 }}>Hərəkət kitabxanası</AppText>
            <AppText style={{ fontSize: 11.5, color: palette.caption, marginTop: 3 }}>{exerciseLibrary.length} hərəkət · video</AppText>
          </PressableScale>
          <PressableScale activeScale={0.97} onPress={() => router.push('/(tabs)/workout/home')} style={styles.tool}>
            <Icon name="dumbbell" size={20} color={palette.inkText} />
            <AppText style={{ fontSize: 13.5, fontWeight: '600', marginTop: 9 }}>Evdə məşq</AppText>
            <AppText style={{ fontSize: 11.5, color: palette.caption, marginTop: 3 }}>Avadanlıqsız</AppText>
          </PressableScale>
        </View>
      </ScrollView>
    </Screen>
  );
}

function RoadStep({ n, label, sub, done, onPress }: { n: number; label: string; sub: string; done?: boolean; onPress?: () => void }) {
  return (
    <PressableScale activeScale={onPress ? 0.98 : 1} haptic={!!onPress} onPress={onPress} style={styles.roadStep}>
      <View style={[styles.roadNum, done && { backgroundColor: palette.volt, borderColor: palette.volt }]}>
        {done ? <Icon name="check" size={15} color={palette.inkText} /> : <AppText style={{ fontSize: 13, fontWeight: '700', color: palette.inkText }}>{n}</AppText>}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline" style={done ? { color: palette.textSecondary } : undefined}>{label}</AppText>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>{sub}</AppText>
      </View>
      {onPress ? <Icon name="chevR" size={17} color={palette.tertiary} /> : null}
    </PressableScale>
  );
}

function QuickTile({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress?: () => void }) {
  return (
    <PressableScale activeScale={0.96} onPress={onPress} style={styles.tile}>
      <Icon name={icon} size={19} color={palette.textSecondary} />
      <AppText style={{ fontSize: 13.5, fontWeight: '600', marginTop: 9 }}>{title}</AppText>
      <AppText style={{ fontSize: 11.5, color: palette.caption, marginTop: 3 }}>{sub}</AppText>
    </PressableScale>
  );
}

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <AppText style={{ fontSize: 17, fontWeight: '600' }}>{title}</AppText>
      {action && onAction ? (
        <PressableScale activeScale={0.94} onPress={onAction} haptic={false}>
          <AppText variant="subhead" color={palette.blue} style={{ fontWeight: '400' }}>
            {action}
          </AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <AppText style={{ fontSize: 16, fontWeight: '700' }}>{value}</AppText>
      <AppText style={{ fontSize: 11.5, color: palette.caption, marginTop: 4 }}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  assignedCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(10,132,255,0.28)' },
  assignedHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assignedGo: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
  assignedFail: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.white, borderRadius: 14, padding: 12, marginBottom: 16 },
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 2, marginBottom: 16 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 5 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,107,53,0.14)' },
  roadmap: { backgroundColor: palette.white, borderRadius: 20, padding: 18, marginBottom: 12 },
  roadStep: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 9 },
  roadNum: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  todayCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 18 },
  todayHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
  voltDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.volt },
  todayOverline: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, color: palette.volt },
  todayTitle: { fontSize: 22, fontWeight: '700', color: palette.white, letterSpacing: -0.4 },
  todaySub: { fontSize: 13.5, color: 'rgba(255,255,255,0.55)', marginTop: 7, lineHeight: 19 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 14 },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  startBtn: { height: 50, borderRadius: 14, backgroundColor: palette.volt, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tile: { flex: 1, backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20, marginBottom: 11 },
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 16 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 74 },
  barCol: { alignItems: 'center', gap: 7 },
  bar: { width: 26, borderRadius: 7 },
  barLabel: { fontSize: 11, fontWeight: '500', color: palette.caption },
  statsRow: { flexDirection: 'row', gap: 16, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  activeProgram: { backgroundColor: palette.white, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  toolRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tool: { flex: 1, backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  programIcon: { width: 48, height: 48, borderRadius: 12, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  programMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
});
