import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { bestsInWorkout } from '@/lib/lifts';
import { removeWorkout } from '@/lib/removeWorkout';
import { seedById, useDb, type Workout } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

const AZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
const AZ_MON_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];

function fmtDur(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}s ${m}d` : `${m}d`;
}

export default function History() {
  const [seg, setSeg] = useState(0);
  const workouts = useDb((s) => s.workouts);
  const checkIns = useDb((s) => s.checkIns);

  const now = new Date();
  const [offset, setOffset] = useState(0); // 0 = current month, negative = past
  const base = useMemo(() => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);
  const year = base.getFullYear();
  const month = base.getMonth();
  const isThisMonth = year === now.getFullYear() && month === now.getMonth();
  const today = now.getDate();

  const cal = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const woDays = new Set<number>();
    const ciDays = new Set<number>();
    for (const w of workouts) {
      const d = new Date(w.at);
      if (d.getFullYear() === year && d.getMonth() === month) woDays.add(d.getDate());
    }
    for (const c of checkIns) {
      const d = new Date(c.at);
      if (d.getFullYear() === year && d.getMonth() === month) ciDays.add(d.getDate());
    }
    // Activity decides the fill; "today" is only an outline, so an empty today never
    // looks like a completed day and a trained today keeps its own colour.
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const tone = woDays.has(day) ? 2 : ciDays.has(day) ? 1 : 0;
      return { tone, isToday: isThisMonth && day === today };
    });
  }, [workouts, checkIns, year, month, today, isThisMonth]);

  const monthStats = useMemo(() => {
    const mw = workouts.filter((w) => {
      const d = new Date(w.at);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    return {
      count: mw.length,
      volumeKg: mw.reduce((a, w) => a + w.volumeKg, 0),
      durationMin: mw.reduce((a, w) => a + (w.durationMin || 0), 0),
    };
  }, [workouts, year, month]);

  /* The list was `slice(0, 20)` with nothing else: no counter, no «daha çox», no
     word that it had been cut. Somebody whose profile card says «140 məşq» taps
     it, lands here, and 120 of their own recorded sessions are unreachable from
     the screen whose whole job is to show them. The window grows on demand and
     the footer says how much of the history is on screen. */
  const PAGE = 20;
  const [shown, setShown] = useState(PAGE);
  /* Which sessions are open. Every set the person logged — the weight, the reps,
     the RPE — was written to this device and then had nowhere to be read: the
     rows were plain `View`s and there is no per-workout screen. The detail is
     opened in place rather than on a new route, because it only ever exists on
     the device that recorded it (`public.workouts` stores the summary alone,
     which is what keeps a gym owner or an admin from ever reading a member's
     training). */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sorted = useMemo(() => [...workouts].sort((a, b) => b.at.localeCompare(a.at)), [workouts]);
  const sessions = useMemo(() => sorted.slice(0, shown), [sorted, shown]);

  return (
    <Screen edges={['top']}>
      <NavBar title="Məşq tarixçəsi" />
      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 12 }}>
        <Segmented options={['Siyahı', 'Təqvim']} value={seg} onChange={setSeg} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 }}>
        {seg === 1 ? (
        <View style={styles.calCard}>
          <View style={styles.calHead}>
            <AppText variant="headline">{AZ_MONTHS[month]} {year}</AppText>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <PressableScale haptic={false} activeScale={0.85} hitSlop={10} onPress={() => setOffset((o) => o - 1)}>
                <Icon name="chevL" size={17} color={palette.inkText} />
              </PressableScale>
              <PressableScale haptic={false} activeScale={0.85} hitSlop={10} disabled={offset >= 0} onPress={() => setOffset((o) => Math.min(0, o + 1))}>
                <Icon name="chevR" size={17} color={offset >= 0 ? palette.tertiary : palette.inkText} />
              </PressableScale>
            </View>
          </View>
          <View style={styles.calGrid}>
            {cal.map((c, i) => (
              <View
                key={i}
                style={[
                  styles.calCell,
                  { backgroundColor: c.tone === 0 ? '#F0F0F3' : c.tone === 1 ? 'rgba(198,255,61,0.45)' : palette.volt },
                  c.isToday && styles.calToday,
                ]}
              />
            ))}
          </View>
          <View style={styles.calStats}>
            <CalStat value={`${monthStats.count}`} label="məşq" />
            <View style={styles.vdiv} />
            <CalStat value={`${(monthStats.volumeKg / 1000).toFixed(1)} t`} label="həcm" />
            <View style={styles.vdiv} />
            <CalStat value={fmtDur(monthStats.durationMin)} label="zalda" />
          </View>
        </View>
        ) : null}

        {seg === 1 ? null : sessions.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="dumbbell" size={26} color={palette.tertiary} />
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 240 }}>
              Hələ məşq yoxdur. İlk məşqini qeyd et — burada tarixçən yığılacaq.
            </AppText>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {sessions.map((s) => {
              const d = new Date(s.at);
              // A workout restored from the server has no per-set detail, so
              // counting `exercises` would print «0 set» for a real session.
              // `setsDone` is the number that was actually recorded.
              const setsN = s.setsDone ?? s.exercises.reduce((a, e) => a + e.sets.length, 0);
              const partner = s.partnerId ? seedById(s.partnerId) : null;
              const isOpen = !!open[s.id];
              return (
                <View key={s.id} style={styles.session}>
                  <PressableScale
                    activeScale={0.99}
                    onPress={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                    style={styles.sessionHead}
                  >
                    <View style={[styles.sessionIcon, { backgroundColor: 'rgba(198,255,61,0.3)' }]}>
                      <Icon name="dumbbell" size={19} color="#5B7F00" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{s.title}</AppText>
                      <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                        {d.getDate()} {AZ_MON_SHORT[d.getMonth()]} · {fmtDur(s.durationMin || 0)} · {(s.volumeKg / 1000).toFixed(1)} t · {setsN} set
                      </AppText>
                    </View>
                    <View style={isOpen ? styles.chevOpen : undefined}>
                      <Icon name="chevD" size={17} color={palette.tertiary} />
                    </View>
                  </PressableScale>
                  {partner ? (
                    <View style={{ flexDirection: 'row', gap: 7, marginTop: 11 }}>
                      <View style={styles.tag}>
                        <AppText style={{ fontSize: 11, fontWeight: '600', color: '#3A3A42' }}>{partner.name} ilə</AppText>
                      </View>
                    </View>
                  ) : null}
                  {isOpen ? <SessionDetail workout={s} /> : null}
                </View>
              );
            })}
            {sorted.length > sessions.length ? (
              <PressableScale activeScale={0.98} onPress={() => setShown((n) => n + PAGE)} style={styles.more}>
                <AppText style={{ fontSize: 14, fontWeight: '600' }}>Daha çox göstər</AppText>
                <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                  {sessions.length} / {sorted.length} məşq göstərilir
                </AppText>
              </PressableScale>
            ) : sorted.length > PAGE ? (
              <AppText style={{ fontSize: 12, color: palette.tertiary, textAlign: 'center', paddingVertical: 10 }}>
                Hamısı göstərilir · {sorted.length} məşq
              </AppText>
            ) : null}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** «Məşqi sil» — the only way out of a session logged by mistake.
 *
 *  It sits inside the opened panel rather than on the row, so it cannot be hit
 *  while scrolling, and it asks first. The confirmation names what will happen
 *  to the personal record too, because deleting a workout that set one takes
 *  the record with it and that is not obvious from the word «sil». */
function DeleteWorkout({ workout }: { workout: Workout }) {
  const [busy, setBusy] = useState(false);
  const ask = () => {
    const bests = bestsInWorkout(workout);
    confirm(
      'Bu məşqi siləsən?',
      bests.length
        ? `${workout.title} — həmişəlik silinir. Bu məşqin yazdığı şəxsi rekord (${bests
            .map((b) => `${b.lift} ${b.value} kq`)
            .join(', ')}) da geri götürülür.`
        : `${workout.title} — həmişəlik silinir.`,
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Sil',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void (async () => {
              const r = await removeWorkout(workout);
              setBusy(false);
              if (!r.ok) {
                errorFeedback();
                // The workout is still on both sides. Saying «silindi» here and
                // letting the next sync bring it back is the exact failure this
                // whole path is written to avoid.
                toast('Məşq silinmədi — serverə çatmadı. Bağlantını yoxla.', 'error');
                return;
              }
              successFeedback();
              toast(r.prsRemoved > 0 ? 'Məşq və onun rekordu silindi' : 'Məşq silindi');
            })();
          },
        },
      ]
    );
  };
  return (
    <PressableScale activeScale={0.97} disabled={busy} onPress={ask} style={styles.deleteRow}>
      <Icon name="x" size={14} color={palette.red} />
      <AppText style={{ fontSize: 12.5, fontWeight: '600', color: palette.red }}>
        {busy ? 'Silinir…' : 'Məşqi sil'}
      </AppText>
    </PressableScale>
  );
}

/** What was actually lifted, set by set.
 *
 *  Three cases, and they are three different sentences:
 *   · the sets are here — they are listed, exactly as they were logged;
 *   · the row came back from the server without them (`summaryOnly`, or simply
 *     an empty `exercises` on a row with a real `setsDone`) — that is said
 *     plainly, because «no detail» is not «no work»;
 *   · a set that was left unfinished is counted separately rather than being
 *     quietly dropped or quietly included. */
function SessionDetail({ workout }: { workout: Workout }) {
  const withSets = workout.exercises.filter((e) => e.sets.length > 0);
  if (!withSets.length) {
    return (
      <View style={styles.detail}>
        <AppText style={{ fontSize: 12.5, color: palette.textSecondary, lineHeight: 18 }}>
          {workout.summaryOnly || (workout.setsDone ?? 0) > 0
            ? 'Bu məşq serverdən bərpa olunub. Set-lər yalnız yazıldığı cihazda saxlanılır — SPOT serverində məşqin yalnız ümumi rəqəmləri var.'
            : 'Bu məşqdə set qeyd olunmayıb.'}
        </AppText>
        <DeleteWorkout workout={workout} />
      </View>
    );
  }
  return (
    <View style={styles.detail}>
      {withSets.map((e, i) => {
        /* Every stored set is shown, with no `done` filter.
         *
         * A workout only ever holds the sets that were COMPLETED: the session
         * screen filters on `done` before it writes (src/app/(tabs)/workout/
         * session.tsx), and the home session only reaches finished moves. So a
         * filter here could never remove anything a current build wrote — but
         * on a row persisted by an older version it could remove a set that the
         * stored volume above was still counting, and the detail would then
         * contradict its own «0.7 t». What is written is what is shown. */
        return (
          <View key={`${e.name}-${i}`} style={i > 0 ? { marginTop: 12 } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <AppText style={{ fontSize: 13.5, fontWeight: '600', flexShrink: 1 }}>{e.name}</AppText>
              <AppText style={{ fontSize: 11, color: palette.tertiary }}>{e.muscle}</AppText>
            </View>
            <View style={styles.setRows}>
              {e.sets.map((x, j) => (
                <View key={j} style={styles.setChip}>
                  <AppText style={{ fontSize: 11.5, fontWeight: '600', color: '#3A3A42' }}>
                    {x.weight} kq × {x.reps}
                    {/* Per-set RPE, if a writer ever records one. Today «Necə
                        keçdi?» on the summary screen rates the whole session,
                        so this stays empty rather than inventing a number for
                        each set. */}
                    {x.rpe ? ` · RPE ${x.rpe}` : ''}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        );
      })}
      <DeleteWorkout workout={workout} />
    </View>
  );
}

function CalStat({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <AppText style={{ fontSize: 16, fontWeight: '700' }}>{value}</AppText>
      <AppText style={{ fontSize: 11, color: palette.tertiary, marginTop: 5 }}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  calCard: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 14 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  calCell: { width: '12.7%', aspectRatio: 1, borderRadius: 8 },
  calToday: { borderWidth: 2, borderColor: palette.ink },
  calStats: { flexDirection: 'row', gap: 14, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.12)' },
  vdiv: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.12)' },
  session: { backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  detail: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(60,60,67,0.12)' },
  setRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  setChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: palette.grouped },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 14, paddingVertical: 4 },
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sessionIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#F0F0F3', alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: palette.grouped },
  empty: { alignItems: 'center', paddingVertical: 40 },
  more: { backgroundColor: palette.white, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
});
