import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyNote, GymGate, getGymRoster, useMyGym, type RosterMember } from '@/lib/gymOwner';
import { useT } from '@/lib/useT';
import { palette, spacing } from '@/theme';

/*
 * The roster used to tag members «YENİ» and «RİSK» and count them in filter
 * chips. Both were read off the age of the member's SPOT ACCOUNT, because the app
 * does not record when somebody made this gym their home gym: a three-year-old
 * account that moved here last week was never «new», and was «at risk» after one
 * quiet fortnight. Neither status was measured, so neither is shown — each row
 * carries only what the check-in table really says about this gym.
 */

/** «SADİQ» = at least this many check-ins here in the last 30 days. Counted. */
const LOYAL_CHECKINS = 12;

/* Azerbaijan is UTC+4 all year, and «bugün»/«dünən» are the gym's calendar days.
   A plain 24-hour division called last night's check-in «bugün» at nine the next
   morning. Same anchor as the occupancy chart in gymOwner.tsx. */
const BAKU_OFFSET_MS = 4 * 3_600_000;
const bakuDay = (ms: number) => Math.floor((ms + BAKU_OFFSET_MS) / 86_400_000);
// Clamped: a phone clock a minute behind the server must not print «-1 gün».
const daysAgo = (iso: string) => Math.max(0, bakuDay(Date.now()) - bakuDay(new Date(iso).getTime()));

export default function GymMembers() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const state = useMyGym();
  const gym = state.gym;

  const [members, setMembers] = useState<RosterMember[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The roster query failed — that is NOT the same as "no members yet". */
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
    if (!gym) return;
    void (async () => {
      await load(gym.id);
    })();
  }, [gym, load]);

  const shown = useMemo(() => [...members].sort((a, b) => b.checkIns30d - a.checkIns30d), [members]);

  const stats = useMemo(() => {
    const total = members.length;
    if (!total) return null;
    const visits = members.reduce((s, m) => s + m.checkIns30d, 0);
    const active = members.filter((m) => m.checkIns30d > 0).length;
    return {
      avg: (visits / total).toFixed(1),
      activeShare: `${Math.round((active / total) * 100)}%`,
      enough: total >= 5,
    };
  }, [members]);

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

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.tertiary} />}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        <AppText variant="largeTitle" style={{ marginBottom: 14 }}>
          {loaded && !failed ? t('Üzvlər · {n}', { n: members.length, count: members.length }) : t('Üzvlər')}
        </AppText>

        {failed ? (
          <View style={styles.failCard}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="x" size={17} color="#D14A15" />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{t('Üzv siyahısı yüklənmədi')}</AppText>
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 5 }}>
                  {members.length
                    ? t('Aşağıdakı siyahı əvvəlki yükləmədən qalıb — köhnə ola bilər. Bağlantını yoxla.')
                    : t('Bu, «üzv yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və yenidən cəhd et.')}
                </AppText>
              </View>
            </View>
            <View style={{ marginTop: 12 }}>
              <Button title={t('Yenidən cəhd et')} variant="secondary" full onPress={refresh} />
            </View>
          </View>
        ) : null}

        {failed && !members.length ? null : !loaded ? (
          // Nothing is counted until the read returns: a stats card saying «Yetərli
          // məlumat yoxdur» or an empty-list note here would describe a gym we have
          // not looked at yet.
          <View style={styles.card}>
            <AppText style={{ fontSize: 14.5, color: palette.textSecondary }}>{t('Yüklənir…')}</AppText>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 13 }}>
                {t('DAVAMİYYƏT · SON 30 GÜN')}
              </AppText>
              {stats && stats.enough ? (
                <View style={{ flexDirection: 'row', gap: 11 }}>
                  <Stat value={stats.avg} label={t('üzv başına check-in')} />
                  <View style={styles.vdiv} />
                  <Stat value={stats.activeShare} label={t('aktiv üzv payı')} />
                </View>
              ) : (
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary }}>
                  {members.length
                    ? t('Hələ {n} üzv var — faiz hesablamaq üçün az. Rəqəmlər 5 üzvdən sonra göstərilir ki, yanıltmasın.', {
                        n: members.length,
                        count: members.length,
                      })
                    : t('Yetərli məlumat yoxdur.')}
                </AppText>
              )}
            </View>

            {!members.length ? (
              <EmptyNote
                title={t('Hələ üzv yoxdur')}
                body={t(
                  'SPOT-da zalını seçən üzvlər burada check-in tezliyi ilə görünəcək; adını gizlədən üzv adsız göstərilir. Siyahı üzvlər zalını özləri seçdikcə dolur.'
                )}
              />
            ) : (
              <View style={{ gap: 10 }}>
                {shown.map((m) => {
                  const since = m.lastCheckIn ? daysAgo(m.lastCheckIn) : null;
                  const loyal = m.checkIns30d >= LOYAL_CHECKINS;
                  const last =
                    since === null
                      ? /* The query only looks 30 days back, so this is all we know —
                           not «never checked in». */
                        t('son 30 gündə check-in yoxdur')
                      : since === 0
                        ? t('bugün check-in edib')
                        : since === 1
                          ? t('dünən check-in edib')
                          : t('son check-in: {n} gün əvvəl', { n: since, count: since });
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
                              ? t('Adını zal siyahısında göstərməyə icazə verməyib')
                              : `${t('30 gündə {n} check-in', { n: m.checkIns30d, count: m.checkIns30d })} · ${last}${
                                  m.hereNow ? ` · ${t('indi zalda')}` : ''
                                }`}
                          </AppText>
                        </View>
                        {loyal ? (
                          <View style={styles.tag}>
                            <AppText style={{ fontSize: 10.5, fontWeight: '700', color: '#3F5500' }}>{t('SADİQ')}</AppText>
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
            {t(
              'Zal admini üzvün məşq detallarını, çəkisini və söhbətlərini GÖRMÜR — yalnız bu zaldakı check-in-lərini. Üzvə birbaşa yazmaq imkanı da yoxdur.'
            )}
          </AppText>
        </View>

        <AppText style={{ fontSize: 11.5, lineHeight: 16, color: palette.tertiary, marginTop: 12, paddingHorizontal: 4 }}>
          {t(
            'Bütün rəqəmlər son 30 günün real check-in-lərindən hesablanır — uydurma statistika göstərmirik. «Sadiq» = son 30 gündə ən azı {n} check-in. Üzvün bu zalı nə vaxt seçdiyini bilmirik, ona görə «yeni» və ya «risk» kimi status göstərmirik.',
            { n: LOYAL_CHECKINS, count: LOYAL_CHECKINS }
          )}
        </AppText>
      </ScrollView>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText style={{ fontSize: 20, fontWeight: '700', color: palette.inkText }}>{value}</AppText>
      <AppText style={{ fontSize: 11, lineHeight: 15, color: palette.tertiary, marginTop: 6 }}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  failCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 14 },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 14 },
  vdiv: { width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.12)' },
  memberCard: { backgroundColor: palette.white, borderRadius: 16, padding: 13 },
  memberHead: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: palette.volt, borderWidth: 2.5, borderColor: palette.white },
  tag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: 'rgba(198,255,61,0.3)' },
  privacy: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 16, paddingHorizontal: 4 },
});
