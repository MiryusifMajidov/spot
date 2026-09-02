import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { seedById, useDb } from '@/store/db';
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

  const sessions = useMemo(
    () => [...workouts].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
    [workouts]
  );

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
              return (
                <View key={s.id} style={styles.session}>
                  <View style={styles.sessionHead}>
                    <View style={[styles.sessionIcon, { backgroundColor: 'rgba(198,255,61,0.3)' }]}>
                      <Icon name="dumbbell" size={19} color="#5B7F00" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{s.title}</AppText>
                      <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                        {d.getDate()} {AZ_MON_SHORT[d.getMonth()]} · {fmtDur(s.durationMin || 0)} · {(s.volumeKg / 1000).toFixed(1)} t · {setsN} set
                      </AppText>
                    </View>
                  </View>
                  {partner ? (
                    <View style={{ flexDirection: 'row', gap: 7, marginTop: 11 }}>
                      <View style={styles.tag}>
                        <AppText style={{ fontSize: 11, fontWeight: '600', color: '#3A3A42' }}>{partner.name} ilə</AppText>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
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
  sessionHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sessionIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#F0F0F3', alignItems: 'center', justifyContent: 'center' },
  tag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: palette.grouped },
  empty: { alignItems: 'center', paddingVertical: 40 },
});
