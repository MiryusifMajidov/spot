import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { COMPAT_UNKNOWN, COMPAT_UNKNOWN_SHORT, MISMATCH_COLOR, compatOf, splitReasons } from '@/components/PartnerRow';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Partner } from '@/data/types';
import { usePartnersForGym } from '@/lib/hooks';
import { useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { applyPartnerFilter, isoWeekKey, useDiscoverPrefs } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';
import { nameWithAge } from '@/lib/authorName';

export default function Weekly() {
  const router = useRouter();
  // Null until the user picks a gym — the weekly three are drawn from their own
  // gym or from nobody at all; never from a substituted catalogue gym.
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const filter = useDiscoverPrefs((s) => s.partnerFilter);
  const picks = useDiscoverPrefs((s) => s.weeklyPicks);
  const setWeeklyPicks = useDiscoverPrefs((s) => s.setWeeklyPicks);
  const matches = useDb((s) => s.matches);
  const all = usePartnersForGym(homeGymId ?? '');
  const candidates = useMemo(() => applyPartnerFilter(all, filter), [all, filter]);
  const week = isoWeekKey();

  // Freeze the three names for the ISO week — they genuinely refresh on Monday,
  // and re-pick only if someone dropped out of the pool.
  const stale = !picks || picks.week !== week || !picks.ids.every((id) => candidates.some((p) => p.id === id));
  useEffect(() => {
    if (!candidates.length || !stale) return;
    setWeeklyPicks(week, candidates.slice(0, 3).map((p) => p.id));
  }, [candidates, stale, week, setWeeklyPicks]);

  const list: Partner[] = useMemo(() => {
    if (!stale && picks) {
      return picks.ids.map((id) => candidates.find((p) => p.id === id)).filter((p): p is Partner => !!p);
    }
    return candidates.slice(0, 3);
  }, [stale, picks, candidates]);

  const [top, ...rest] = list;
  const topScore = top ? compatOf(top) : null;
  const topReasons = splitReasons(top);
  const open = (p: Partner) => router.push({ pathname: '/(tabs)/discover/match', params: { id: p.id } });

  const stateLabel = (id: string) => {
    const s = matches[id]?.state;
    if (s === 'accepted') return 'Qəbul edildi';
    if (s === 'requested') return 'Təklif göndərilib';
    return null;
  };

  return (
    <Screen>
      <NavBar title="Həftəlik təkliflər" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 14, lineHeight: 18 }}>
          Həftədə ən çox 3 təklif — az, ona görə dəyərli. Alqoritm zal, saat, səviyyə və məqsədə görə seçir; siyahı bazar
          ertəsi yenilənir.
        </AppText>

        {!top ? (
          <View style={styles.empty}>
            <Icon name={homeGymId ? 'users' : 'pin'} size={28} color={palette.tertiary} />
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 260, lineHeight: 21 }}>
              {homeGymId
                ? 'Bu həftə üçün hələ uyğun təklif yoxdur. Profilini tamamla — uyğun adam çıxan kimi burada görünəcək.'
                : 'Zalını seç — yoldaşlar zala görə tapılır.'}
            </AppText>
            {!homeGymId ? (
              <PressableScale activeScale={0.96} onPress={() => router.push('/(tabs)/profile/edit')} style={styles.emptyBtn}>
                <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Zalını seç</AppText>
              </PressableScale>
            ) : null}
          </View>
        ) : (
          <>
            {/* Top pick — ink */}
            <View style={styles.topCard}>
              <View style={styles.topHead}>
                <Avatar name={top.name} size={54} />
                <View style={{ flex: 1 }}>
                  <AppText variant="title3" color={palette.white}>
                    {nameWithAge(top.name, top.age)}
                  </AppText>
                  <AppText variant="footnote" color="rgba(255,255,255,0.55)" style={{ marginTop: 2 }}>
                    {top.level} · {top.usualTime}
                  </AppText>
                </View>
                {/* null = the score was never computed. «0 %» would be a verdict; this
                    is the absence of one, so it is never printed as a number. */}
                {topScore === null ? (
                  <View style={styles.unknownBadge}>
                    <AppText style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' }}>?</AppText>
                  </View>
                ) : (
                  <View style={styles.matchBadge}>
                    <AppText style={{ color: palette.inkText, fontSize: 13, fontWeight: '700' }}>{topScore}%</AppText>
                  </View>
                )}
              </View>
              {topScore === null ? (
                <AppText variant="body" color="rgba(255,255,255,0.82)" style={{ marginTop: 14, lineHeight: 21 }}>
                  {COMPAT_UNKNOWN} — onda bu adamın sənə nə qədər uyğun gəldiyini göstərə bilərik.
                </AppText>
              ) : (
                <>
                  <AppText variant="body" color="rgba(255,255,255,0.82)" style={{ marginTop: 14, lineHeight: 21 }}>
                    {topReasons.pros.length > 0
                      ? `${topReasons.pros.join(' · ')} — bu həftənin ən uyğun yoldaşı.`
                      : 'Bu həftənin ən uyğun yoldaşı.'}
                  </AppText>
                  {/* The differences are shown too — the pick is not a black box. */}
                  {topReasons.cons.length > 0 ? (
                    <AppText variant="footnote" color={MISMATCH_COLOR} style={{ marginTop: 6, lineHeight: 18 }}>
                      Fərq: {topReasons.cons.slice(0, 2).join(' · ')}
                    </AppText>
                  ) : null}
                </>
              )}
              {stateLabel(top.id) ? (
                <View style={styles.topState}>
                  <Icon name="check" size={15} color={palette.volt} />
                  <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.volt }}>{stateLabel(top.id)}</AppText>
                </View>
              ) : (
                <Button title="Məşq təklif et" variant="volt" icon="dumbbell" full onPress={() => open(top)} style={{ marginTop: 16 }} />
              )}
            </View>

            {rest.map((p) => {
              const s = compatOf(p);
              const r = splitReasons(p);
              return (
              <View key={p.id} style={styles.row}>
                <Avatar name={p.name} size={48} />
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">
                    {nameWithAge(p.name, p.age)}
                  </AppText>
                  <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
                    {stateLabel(p.id) ?? (s === null ? COMPAT_UNKNOWN_SHORT : r.pros.join(' · ') || `${s}% uyğun`)}
                  </AppText>
                  {!stateLabel(p.id) && s !== null && r.cons.length > 0 ? (
                    <AppText variant="caption" color={MISMATCH_COLOR} style={{ marginTop: 3 }}>
                      Fərq: {r.cons.slice(0, 2).join(' · ')}
                    </AppText>
                  ) : null}
                </View>
                <PressableScale activeScale={0.95} onPress={() => open(p)} style={styles.smallBtn}>
                  <Icon name={stateLabel(p.id) ? 'chevR' : 'dumbbell'} size={16} color={palette.white} />
                </PressableScale>
              </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  topCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 18, marginBottom: 14 },
  topHead: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  topState: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16 },
  matchBadge: { backgroundColor: palette.volt, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  unknownBadge: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14, marginBottom: 11 },
  smallBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyBtn: { marginTop: 16, height: 44, paddingHorizontal: 22, borderRadius: 13, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
});
