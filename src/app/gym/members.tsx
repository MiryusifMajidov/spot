import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { EmptyNote, GymGate, daysSince, getGymRoster, useMyGym, type RosterMember } from '@/lib/gymOwner';
import { palette, spacing } from '@/theme';

/** No check-in for this many days = at risk of churn. Derived, never invented. */
const RISK_DAYS = 14;

type Filter = 'all' | 'new' | 'risk';

const isNew = (m: RosterMember) => {
  if (!m.joinedAt) return false;
  const d = new Date(m.joinedAt);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};
/**
 * Churn risk = a member who really has not checked in for RISK_DAYS. A member we
 * have known for less than that has not had the chance yet, so a missing
 * check-in is NOT risk — it would invent a status the app never obtained.
 */
const isRisk = (m: RosterMember) => {
  const d = daysSince(m.lastCheckIn);
  if (d !== null) return d >= RISK_DAYS;
  const joined = daysSince(m.joinedAt);
  return joined !== null && joined >= RISK_DAYS;
};

export default function GymMembers() {
  const insets = useSafeAreaInsets();
  const state = useMyGym();
  const gym = state.gym;

  const [members, setMembers] = useState<RosterMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The roster query failed — that is NOT the same as "no members yet". */
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async (gymId: string) => {
    try {
      setMembers(await getGymRoster(gymId));
      setFailed(false);
    } catch {
      // Keep the last roster we really read; never report an empty gym.
      setFailed(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (gym) load(gym.id);
  }, [gym, load]);

  const counts = useMemo(
    () => ({ all: members.length, new: members.filter(isNew).length, risk: members.filter(isRisk).length }),
    [members]
  );

  const shown = useMemo(() => {
    const list = filter === 'new' ? members.filter(isNew) : filter === 'risk' ? members.filter(isRisk) : members;
    return [...list].sort((a, b) => b.checkIns30d - a.checkIns30d);
  }, [members, filter]);

  const stats = useMemo(() => {
    const total = members.length;
    if (!total) return null;
    const visits = members.reduce((s, m) => s + m.checkIns30d, 0);
    const active = members.filter((m) => m.checkIns30d > 0).length;
    return {
      avg: (visits / total).toFixed(1),
      activeShare: `${Math.round((active / total) * 100)}%`,
      lapsed: counts.risk,
      enough: total >= 5,
    };
  }, [members, counts.risk]);

  if (!gym) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped, paddingTop: insets.top }}>
        <GymGate state={state} />
      </View>
    );
  }

  const refresh = async () => {
    setRefreshing(true);
    await load(gym.id);
    setRefreshing(false);
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: `Hamısı ${counts.all}` },
    { key: 'new', label: `Yeni ${counts.new}` },
    { key: 'risk', label: `İtirilmə riski ${counts.risk}` },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.tertiary} />}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <AppText variant="largeTitle" style={{ marginBottom: 14 }}>
          {loaded && !failed ? `Üzvlər · ${members.length}` : 'Üzvlər'}
        </AppText>

        {failed ? (
          <View style={styles.failCard}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="x" size={17} color="#D14A15" />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>Üzv siyahısı yüklənmədi</AppText>
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 5 }}>
                  {members.length
                    ? 'Aşağıdakı siyahı əvvəlki yükləmədən qalıb — köhnə ola bilər. Bağlantını yoxla.'
                    : 'Bu, «üzv yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və yenidən cəhd et.'}
                </AppText>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <Button title="Yenidən cəhd et" variant="secondary" full onPress={refresh} />
            </View>
          </View>
        ) : null}

        {failed && !members.length ? null : (
          <>
            <View style={styles.filters}>
              {FILTERS.map((f) => (
                <PressableScale
                  key={f.key}
                  activeScale={0.95}
                  onPress={() => setFilter(f.key)}
                  style={[styles.chip, filter === f.key && styles.chipOn]}>
                  <AppText style={{ fontSize: 12.5, fontWeight: '600', color: filter === f.key ? palette.white : palette.inkText }}>
                    {f.label}
                  </AppText>
                </PressableScale>
              ))}
            </View>

            <View style={styles.card}>
              <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 13 }}>
                DAVAMİYYƏT · SON 30 GÜN
              </AppText>
              {stats && stats.enough ? (
                <View style={{ flexDirection: 'row', gap: 11 }}>
                  <Stat value={stats.avg} label="üzv başına check-in" />
                  <View style={styles.vdiv} />
                  <Stat value={stats.activeShare} label="aktiv üzv payı" />
                  <View style={styles.vdiv} />
                  <Stat value={String(stats.lapsed)} label={`${RISK_DAYS} gün gəlməyən`} danger />
                </View>
              ) : (
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary }}>
                  {members.length
                    ? `Hələ ${members.length} üzv var — faiz hesablamaq üçün az. Rəqəmlər 5 üzvdən sonra göstərilir ki, yanıltmasın.`
                    : 'Yetərli məlumat yoxdur.'}
                </AppText>
              )}
            </View>

            {!members.length ? (
              <EmptyNote
                title={loaded ? 'Hələ üzv yoxdur' : 'Yüklənir…'}
                body="SPOT-da zalını seçən hər kəs burada görünəcək — ad, check-in tezliyi və üzvlük statusu ilə. Siyahı üzvlər zalını özləri seçdikcə dolur."
              />
            ) : !shown.length ? (
              <EmptyNote title="Bu filtrdə üzv yoxdur" body="Filtri dəyiş və ya bütün üzvlərə bax." />
            ) : (
              <View style={{ gap: 10 }}>
                {shown.map((m) => {
                  const since = daysSince(m.lastCheckIn);
                  const risk = isRisk(m);
                  const fresh = isNew(m);
                  const tag = risk ? TAG.risk : fresh ? TAG.new : m.checkIns30d >= 12 ? TAG.loyal : null;
                  const last =
                    since === null
                      ? // The query only looks 30 days back, so this is all we know.
                        'son 30 gündə check-in yoxdur'
                      : since === 0
                        ? 'bugün check-in edib'
                        : since === 1
                          ? 'dünən check-in edib'
                          : `son check-in: ${since} gün əvvəl`;
                  return (
                    <View key={m.profileId} style={styles.memberCard}>
                      <View style={styles.memberHead}>
                        <View>
                          <Avatar name={m.anonymous ? '?' : m.name} size={46} />
                          {m.hereNow ? <View style={styles.onlineDot} /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <AppText
                            style={{ fontSize: 14.5, fontWeight: '600', color: m.anonymous ? palette.textSecondary : palette.inkText }}>
                            {m.name}
                          </AppText>
                          <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                            {m.anonymous
                              ? 'Adını zal siyahısında göstərməyə icazə verməyib'
                              : `30 gündə ${m.checkIns30d} check-in · ${last}${m.hereNow ? ' · indi zalda' : ''}`}
                          </AppText>
                        </View>
                        {tag ? (
                          <View style={[styles.tag, { backgroundColor: tag.bg }]}>
                            <AppText style={{ fontSize: 10.5, fontWeight: '700', color: tag.color }}>{tag.label}</AppText>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        <View style={styles.privacy}>
          <Icon name="lock" size={15} color={palette.tertiary} />
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.textSecondary, flex: 1 }}>
            Zal admini üzvün məşq detallarını, çəkisini və söhbətlərini GÖRMÜR — yalnız check-in tezliyini və üzvlük
            statusunu. Üzvə birbaşa yazmaq imkanı da yoxdur.
          </AppText>
        </View>

        <AppText style={{ fontSize: 11.5, lineHeight: 16, color: palette.tertiary, marginTop: 12, paddingHorizontal: 4 }}>
          Bütün rəqəmlər son 30 günün real check-in-lərindən hesablanır — uydurma statistika göstərmirik. «Yeni» = bu ay
          SPOT-a qeydiyyatdan keçib və zalın kimi bu zalı seçib. «Risk» = ən azı {RISK_DAYS} gündür SPOT-dadır və son{' '}
          {RISK_DAYS} gündə check-in etməyib. Təzə qoşulan üzv risk sayılmır — hələ gəlməyə vaxtı olmayıb.
        </AppText>
      </ScrollView>
    </View>
  );
}

const TAG = {
  loyal: { label: 'SADİQ', bg: 'rgba(198,255,61,0.3)', color: '#3F5500' },
  new: { label: 'YENİ', bg: 'rgba(10,132,255,0.12)', color: palette.blue },
  risk: { label: 'RİSK', bg: 'rgba(255,107,53,0.16)', color: '#D14A15' },
};

function Stat({ value, label, danger }: { value: string; label: string; danger?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText style={{ fontSize: 20, fontWeight: '700', color: danger ? '#D14A15' : palette.inkText }}>{value}</AppText>
      <AppText style={{ fontSize: 11, lineHeight: 15, color: palette.tertiary, marginTop: 6 }}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 7, marginBottom: 14 },
  failCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: palette.white },
  chipOn: { backgroundColor: palette.ink },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 14 },
  vdiv: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.12)' },
  memberCard: { backgroundColor: palette.white, borderRadius: 16, padding: 13 },
  memberHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: palette.volt, borderWidth: 2.5, borderColor: palette.white },
  tag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
  privacy: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 16, paddingHorizontal: 4 },
});
