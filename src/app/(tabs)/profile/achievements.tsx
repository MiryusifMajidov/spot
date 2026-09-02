import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { useDb, useStats } from '@/store/db';
import { palette, spacing } from '@/theme';

type Badge = { icon: IconName; label: string; earned: boolean };

export default function Achievements() {
  const stats = useStats();
  const checkInCount = useDb((s) => s.checkIns.length);
  const partners = useDb((s) => Object.values(s.matches).filter((m) => m.state === 'accepted').length);
  const prSquat = stats.prs.find((p) => p.lift === 'Skvat')?.value ?? 0;
  const volumeT = stats.volumeKg / 1000;

  const badges: Badge[] = [
    { icon: 'qr', label: 'İlk check-in', earned: checkInCount > 0 },
    { icon: 'users', label: 'İlk yoldaş', earned: partners > 0 },
    { icon: 'trophy', label: '100 kq skvat', earned: prSquat >= 100 },
    { icon: 'flame', label: '21 gün seriya', earned: stats.streakDays >= 21 },
    { icon: 'dumbbell', label: '100 t həcm', earned: volumeT >= 100 },
    { icon: 'target', label: '10 məşq', earned: stats.count >= 10 },
  ];
  const earned = badges.filter((b) => b.earned);
  const locked = badges.filter((b) => !b.earned);

  const close = [
    { icon: 'target' as IconName, label: '50 məşq', cur: Math.min(stats.count, 50), total: 50 },
    { icon: 'users' as IconName, label: '5 yoldaşla məşq', cur: Math.min(partners, 5), total: 5 },
    { icon: 'dumbbell' as IconName, label: '100 t həcm', cur: Math.min(Math.round(volumeT), 100), total: 100 },
  ];

  const week = Array.from({ length: 7 }).map((_, i) => i < Math.min(stats.streakDays, 7));

  return (
    <Screen edges={['top']}>
      <NavBar title="Nailiyyətlər" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 }}>
        <View style={styles.streakCard}>
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
            <View style={styles.streakBadge}>
              <Icon name="flame" size={24} color={palette.streak} />
              <AppText style={{ fontSize: 15, fontWeight: '700', color: palette.white, marginTop: 5 }}>{stats.streakDays}</AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 18, fontWeight: '700', color: palette.white }}>{stats.streakDays} günlük seriya</AppText>
              <AppText style={{ fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
                {stats.streakDays > 0 ? 'Davam et — hər gün check-in və ya məşq seriyanı saxlayır.' : 'Check-in et və ya məşq qeyd et — seriya bu gün başlayır.'}
              </AppText>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 16 }}>
            {week.map((on, i) => (
              <View key={i} style={[styles.weekSeg, { backgroundColor: on ? palette.volt : 'rgba(255,255,255,0.14)' }]} />
            ))}
          </View>
        </View>

        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
          QAZANILMIŞ · {earned.length}
        </AppText>
        {earned.length === 0 ? (
          <AppText variant="body" color={palette.textSecondary} style={{ marginBottom: 16, lineHeight: 21 }}>
            Hələ nişan yoxdur. İlk check-in və ya məşqinlə başla.
          </AppText>
        ) : (
          <View style={styles.grid}>
            {earned.map((b) => (
              <View key={b.label} style={styles.badge}>
                <View style={styles.badgeIcon}>
                  <Icon name={b.icon} size={22} color="#5B7F00" />
                </View>
                <AppText style={{ fontSize: 12, fontWeight: '600', textAlign: 'center', lineHeight: 15 }}>{b.label}</AppText>
              </View>
            ))}
          </View>
        )}

        {locked.length > 0 ? (
          <>
            <AppText variant="overline" color={palette.tertiary} style={{ marginTop: 16, marginBottom: 12 }}>
              YAXINDIR
            </AppText>
            <View style={{ gap: 10 }}>
              {close.filter((c) => c.cur < c.total).map((c) => (
                <View key={c.label} style={styles.closeRow}>
                  <View style={styles.closeIcon}>
                    <Icon name={c.icon} size={21} color="#B4B4BB" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 14, fontWeight: '600' }}>{c.label}</AppText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 }}>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${(c.cur / c.total) * 100}%` }]} />
                      </View>
                      <AppText style={{ fontSize: 11.5, fontWeight: '600' }}>{c.cur}/{c.total}</AppText>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.note}>
          <Icon name="shield" size={15} color={palette.tertiary} />
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.textSecondary, flex: 1 }}>
            Nişanlar yalnız QR check-in və qeyd edilmiş məşqlərlə qazanılır. Satın alınmır, hədiyyə edilmir.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  streakCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 18, marginBottom: 14 },
  streakBadge: { width: 70, height: 70, borderRadius: 20, backgroundColor: 'rgba(255,107,53,0.22)', alignItems: 'center', justifyContent: 'center' },
  weekSeg: { flex: 1, height: 24, borderRadius: 5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  badge: { width: '31.5%', backgroundColor: palette.white, borderRadius: 16, padding: 14, alignItems: 'center' },
  badgeIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(198,255,61,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  closeRow: { backgroundColor: palette.white, borderRadius: 16, padding: 14, flexDirection: 'row', gap: 13, alignItems: 'center' },
  closeIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#F0F0F3', alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#EFEFF2', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: palette.ink },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 16, paddingHorizontal: 4 },
});
