import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { StatusBarScrim } from '@/components/ui/StatusBarScrim';
import { showAccountSwitcher } from '@/lib/accounts';
import { GymGate, getMyGymClaim, useMyGym, type GymClaimRow } from '@/lib/gymOwner';
import { getGymDayPasses, getGymOccupancy } from '@/lib/roles';
import { useT } from '@/lib/useT';
import { palette, radius, spacing } from '@/theme';

/**
 * The gym account on the phone — a mini panel (owner's decision, 2026-10-29).
 *
 * The phone keeps what reception does standing up: today's three numbers, the
 * day-pass check and the check-in code. Everything that is real management —
 * schedule, members, reviews, prices, photos, the map pin — lives in the web
 * gym panel (web/gym), where it is done at a desk. The ownership claim stays
 * here too: it is a one-time form that create-gym sends the owner to.
 */
interface Today {
  now: number;
  checkIns: number;
  passesUsed: number;
}

/** Which reads failed. A failed read is shown as «—», never as a zero. */
interface Failed {
  occupancy: boolean;
  passes: boolean;
}

export default function GymPanel() {
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const state = useMyGym();
  const gym = state.gym;

  const [today, setToday] = useState<Today | null>(null);
  const [failed, setFailed] = useState<Failed>({ occupancy: false, passes: false });
  const [claim, setClaim] = useState<GymClaimRow | null>(null);
  /** false = the claim could not be read, so nothing is asserted about it. */
  const [claimKnown, setClaimKnown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (gymId: string) => {
    const [occ, passes, claimRow] = await Promise.allSettled([
      getGymOccupancy(gymId),
      getGymDayPasses(gymId),
      getMyGymClaim(gymId),
    ]);
    setToday({
      now: occ.status === 'fulfilled' ? occ.value.now : 0,
      checkIns: occ.status === 'fulfilled' ? occ.value.today : 0,
      passesUsed: passes.status === 'fulfilled' ? passes.value.usedToday : 0,
    });
    setFailed({ occupancy: occ.status === 'rejected', passes: passes.status === 'rejected' });
    setClaim(claimRow.status === 'fulfilled' ? claimRow.value : null);
    setClaimKnown(claimRow.status === 'fulfilled');
  }, []);

  useEffect(() => {
    if (!gym) return;
    void (async () => {
      await load(gym.id);
    })();
  }, [gym, load]);

  const refresh = async () => {
    if (!gym) return;
    setRefreshing(true);
    state.reload();
    await load(gym.id);
    setRefreshing(false);
  };

  if (!gym) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped, paddingTop: insets.top }}>
        <GymGate state={state} />
      </View>
    );
  }

  const claimed = gym.claimStatus === 'claimed';
  const claimRow = !claimKnown
    ? { title: t('Sahiblik təsdiqi'), sub: t('Müraciətinin statusuna bax') }
    : claim?.status === 'pending' && claim.voen
      ? { title: t('Sahiblik təsdiqi gözlənilir'), sub: t('Müraciətinə bax') }
      : claim?.status === 'rejected'
        ? { title: t('Müraciət qəbul olunmadı'), sub: t('Səbəbə bax və yenidən göndər') }
        : { title: t('Sahibliyi təsdiqlə'), sub: t('VÖEN göndər · idarəni öz əlinə al') };

  const stat = (label: string, value: number | undefined, bad: boolean, tint?: boolean) => (
    <View style={[styles.stat, { backgroundColor: tint ? palette.voltTint : palette.white }]}>
      <AppText variant="caption" color={tint ? palette.voltText : palette.textSecondary}>
        {label}
      </AppText>
      <AppText style={styles.statBig}>{bad ? '—' : today ? String(value ?? 0) : '·'}</AppText>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.tertiary} />}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: spacing.screen, paddingBottom: 28 }}>
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <AppText variant="caption" color={palette.tertiary}>
              {t('Zal paneli · admin')}
            </AppText>
            <AppText variant="largeTitle" numberOfLines={2} style={{ marginTop: 4 }}>
              {gym.name}
            </AppText>
            {gym.district ? (
              <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 4 }}>
                {gym.district}
              </AppText>
            ) : null}
          </View>
          <PressableScale
            activeScale={0.94}
            onPress={() => showAccountSwitcher(router)}
            hitSlop={{ top: 4, bottom: 4 }}
            accessibilityRole="button"
            style={styles.modePill}>
            <Icon name="user" size={15} color={palette.inkText} />
            <AppText style={{ color: palette.inkText, fontSize: 13, fontWeight: '600' }}>{t('Hesabı dəyiş')}</AppText>
          </PressableScale>
        </View>

        {!gym.listed ? (
          <PressableScale activeScale={0.98} onPress={() => router.push('/gym/claim')} style={styles.unlisted}>
            <Icon name="lock" size={20} color={palette.streakText} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 14, fontWeight: '600' }}>{t('Zal hələ Kəşfdə görünmür')}</AppText>
              <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 3 }}>
                {t('Müştərilər zalı axtarışda və xəritədə tapa bilmir. Moderator yoxlayandan və ya sahiblik (VÖEN) təsdiqlənəndən sonra dərc olunur.')}
              </AppText>
            </View>
          </PressableScale>
        ) : null}

        <View style={styles.statRow}>
          {stat(t('İndi zalda'), today?.now, failed.occupancy, true)}
          {stat(t('bu gün'), today?.checkIns, failed.occupancy)}
          {stat(t('Day-pass'), today?.passesUsed, failed.passes)}
        </View>

        <Button title={t('Day-pass yoxla')} icon="check" full onPress={() => router.push('/gym/pass')} />
        <Button
          title={t('Zal kodu')}
          icon="qr"
          variant="secondary"
          full
          onPress={() => router.push('/gym/qr')}
          style={{ marginTop: 10 }}
        />

        {!claimed ? (
          <PressableScale activeScale={0.98} onPress={() => router.push('/gym/claim')} style={[styles.card, styles.row]}>
            <Icon name="shield" size={20} color={palette.rowIcon} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 15, fontWeight: '600' }}>{claimRow.title}</AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
                {claimRow.sub}
              </AppText>
            </View>
            <Icon name="chevR" size={17} color={palette.chevron} />
          </PressableScale>
        ) : null}

        <View style={[styles.card, { marginTop: claimed ? 18 : 12 }]}>
          <View style={styles.row}>
            <Icon name="browser" size={20} color={palette.rowIcon} />
            <AppText style={{ fontSize: 15, fontWeight: '600', flex: 1 }}>{t('Zalı kompüterdən idarə et')}</AppText>
          </View>
          <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
            {t('Dərs cədvəli, üzvlər, rəylər, qiymətlər, şəkillər və zalın xəritədəki yeri SPOT Zal panelində idarə olunur. Kompüterdə aç və eyni hesabla daxil ol.')}
          </AppText>
        </View>
      </ScrollView>
      <StatusBarScrim />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, backgroundColor: palette.element, borderRadius: 999, paddingHorizontal: 12, marginTop: 6 },
  unlisted: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: palette.streakTint, borderRadius: radius.card, padding: 14, marginBottom: 14 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  stat: { flex: 1, borderRadius: radius.card, padding: 14 },
  statBig: { fontSize: 28, fontWeight: '700', marginTop: 8, letterSpacing: -0.8, color: palette.inkText },
  card: { backgroundColor: palette.white, borderRadius: radius.card, padding: 16, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
