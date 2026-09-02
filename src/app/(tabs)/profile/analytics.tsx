import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAppStore } from '@/store/appStore';
import { computeMuscleVolume, estimate1RM, useDb, useStats, useWeekStats } from '@/store/db';
import { palette, spacing } from '@/theme';

export default function Analytics() {
  const workouts = useDb((s) => s.workouts);
  const stats = useStats();
  const week = useWeekStats();
  const plannedDays = useAppStore((s) => s.profile.days.length);
  const hasData = workouts.length > 0;

  const rawMuscles = computeMuscleVolume(workouts);
  const maxVol = Math.max(1, ...rawMuscles.map((m) => m.kg));
  const nonZero = rawMuscles.filter((m) => m.kg > 0);
  const minMuscle = nonZero.length ? nonZero.reduce((a, b) => (a.kg < b.kg ? a : b)) : null;
  const topMuscle = nonZero.length ? nonZero.reduce((a, b) => (a.kg > b.kg ? a : b)) : null;
  const imbalance = minMuscle && topMuscle && topMuscle.kg > minMuscle.kg * 2.5 ? { low: minMuscle.name, ratio: (topMuscle.kg / minMuscle.kg).toFixed(1) } : null;
  const muscles = rawMuscles.map((m) => ({
    name: m.name,
    vol: `${(m.kg / 1000).toFixed(1)} t`,
    pct: Math.round((m.kg / maxVol) * 100),
    warn: imbalance ? m.name === imbalance.low : false,
  }));

  const bench1rm = estimate1RM(workouts, (n) => n.toLowerCase().includes('bench'));
  // Denominator is the user's OWN weekly plan from onboarding — never an invented target.
  const target = plannedDays > 0 ? plannedDays : 0;
  const consistency = hasData && target > 0 ? Math.min(100, Math.round((week.count / target) * 100)) : null;

  const shareReport = () => {
    const lines = [
      'SPOT · məşq hesabatı',
      `Ümumi: ${stats.count} məşq · ${(stats.volumeKg / 1000).toFixed(1)} t həcm · ${stats.streakDays} gün seriya`,
      `Bu həftə: ${week.count} məşq${target > 0 ? ` / ${target} planlanmış` : ''}`,
      bench1rm > 0 ? `Bench 1RM proqnozu: ${bench1rm} kq` : null,
      nonZero.length > 0 ? `Əzələ həcmi: ${nonZero.map((m) => `${m.name} ${(m.kg / 1000).toFixed(1)} t`).join(' · ')}` : null,
      imbalance ? `Disbalans: ${imbalance.low} ən yüksək qrupdan ${imbalance.ratio} dəfə azdır.` : null,
    ].filter(Boolean);
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  return (
    <Screen edges={['top']}>
      <NavBar
        title="Analitika"
        right={
          <View style={styles.plusBadge}>
            <AppText style={{ fontSize: 10.5, fontWeight: '700', color: palette.volt }}>SPOT+</AppText>
          </View>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 }}>
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 14 }}>
            ƏZƏLƏ QRUPU ÜZRƏ HƏCM · 4 HƏFTƏ
          </AppText>
          {!hasData ? (
            <AppText variant="body" color={palette.textSecondary} style={{ lineHeight: 21 }}>
              Hələ məşq qeyd etməmisən. İlk məşqindən sonra hansı əzələ qrupuna nə qədər həcm düşdüyü burada görünəcək.
            </AppText>
          ) : (
          <>
          <View style={{ gap: 11 }}>
            {muscles.map((m) => (
              <View key={m.name}>
                <View style={styles.muscleHead}>
                  <AppText style={{ fontSize: 12.5, fontWeight: '600' }}>{m.name}</AppText>
                  <AppText style={{ fontSize: 12.5, fontWeight: '600', color: palette.tertiary }}>{m.vol}</AppText>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${m.pct}%`, backgroundColor: m.warn ? palette.streak : palette.ink }]} />
                </View>
              </View>
            ))}
          </View>
          {imbalance ? (
            <View style={styles.warn}>
              <AppText style={{ fontSize: 12.5, lineHeight: 18, color: '#8A4A25' }}>
                {imbalance.low} həcmi ən yüksək qrupdan {imbalance.ratio} dəfə azdır — disbalans riski. Bu qrupa hərəkət əlavə et.
              </AppText>
            </View>
          ) : nonZero.length >= 3 ? (
            <View style={[styles.warn, { backgroundColor: 'rgba(198,255,61,0.16)' }]}>
              <AppText style={{ fontSize: 12.5, lineHeight: 18, color: '#3F5500' }}>
                Əzələ qrupları balanslıdır. Belə davam et.
              </AppText>
            </View>
          ) : (
            <View style={[styles.warn, { backgroundColor: palette.grouped }]}>
              <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary }}>
                Balans qiymətləndirmək üçün hələ az datadır — ən azı 3 fərqli əzələ qrupuna məşq qeyd et.
              </AppText>
            </View>
          )}
          </>
          )}
        </View>

        <View style={styles.card}>
          <AppText variant="headline" style={{ marginBottom: 14 }}>
            Sinə pressi · 1RM proqnozu
          </AppText>
          {bench1rm > 0 ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 9 }}>
                <AppText style={{ fontSize: 28, fontWeight: '700', letterSpacing: -0.8 }}>{bench1rm} kq</AppText>
                <AppText style={{ fontSize: 12.5, fontWeight: '600', color: palette.tertiary }}>Epley düsturu ilə</AppText>
              </View>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
                Qeyd etdiyin ən ağır bench setinə əsaslanır. Daha çox məşq qeyd etdikcə dəqiqləşir.
              </AppText>
            </>
          ) : (
            <AppText variant="body" color={palette.textSecondary} style={{ lineHeight: 21 }}>
              Bench press qeyd et — 1RM proqnozun burada görünəcək.
            </AppText>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
          <MetricCard
            title="ARDICILLIQ"
            value={consistency == null ? '—' : `${consistency}%`}
            sub={target > 0 ? `həftədə ${target} gün plan` : 'plan seçilməyib'}
            subColor={consistency != null && consistency >= 75 ? '#5B7F00' : palette.tertiary}
          />
          <MetricCard title="SERIYA" value={`${stats.streakDays}`} sub="gün" subColor={palette.tertiary} />
          <MetricCard title="ÜMUMİ HƏCM" value={`${(stats.volumeKg / 1000).toFixed(1)}t`} sub={`${stats.count} məşq`} subColor={palette.tertiary} />
        </View>

        {hasData ? (
          <PressableScale activeScale={0.98} onPress={shareReport} style={styles.sendCard}>
            <View style={styles.sendIcon}>
              <Icon name="share" size={20} color={palette.volt} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Hesabatı paylaş</AppText>
              <AppText style={{ fontSize: 12, lineHeight: 17, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                Rəqəmlərini mətn kimi kopyala və müəlliminə göndər
              </AppText>
            </View>
          </PressableScale>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function MetricCard({ title, value, sub, subColor }: { title: string; value: string; sub: string; subColor: string }) {
  return (
    <View style={styles.metric}>
      <AppText style={{ fontSize: 10, fontWeight: '600', letterSpacing: 0.5, color: palette.tertiary }}>{title}</AppText>
      <AppText style={{ fontSize: 18, fontWeight: '700', marginTop: 8 }}>{value}</AppText>
      <AppText style={{ fontSize: 10.5, lineHeight: 13, color: subColor, marginTop: 6 }}>{sub}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  plusBadge: { backgroundColor: palette.ink, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5 },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 12 },
  muscleHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#EFEFF2', overflow: 'hidden' },
  barFill: { height: '100%' },
  warn: { backgroundColor: 'rgba(255,107,53,0.12)', borderRadius: 12, padding: 12, marginTop: 14 },
  trendChart: { height: 82, position: 'relative', marginTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(60,60,67,0.1)' },
  dot: { position: 'absolute', borderRadius: 6 },
  trendLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  metric: { flex: 1, backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  sendCard: { backgroundColor: palette.ink, borderRadius: 16, padding: 15, flexDirection: 'row', gap: 12, alignItems: 'center' },
  sendIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: 'rgba(198,255,61,0.2)', alignItems: 'center', justifyContent: 'center' },
});
