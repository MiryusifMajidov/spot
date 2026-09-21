import { useLocalSearchParams, useRouter } from 'expo-router';
import { tapFeedback } from '@/lib/feedback';
import { useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { setMyWorkoutRpe } from '@/lib/api';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useDb, useStats } from '@/store/db';
import { palette } from '@/theme';

const RPE = ['Asan', 'Normal', 'Ağır'];
/** The workout ids the server knows are uuids (src/lib/ids.ts). A local-only
 *  row has nothing to update up there. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function Summary() {
  const router = useRouter();
  const t = useT();
  const params = useLocalSearchParams<{ title?: string; durationSec?: string; volumeKg?: string; setsDone?: string; maxKg?: string }>();
  const title = params.title || 'Məşq';
  const durationSec = Number(params.durationSec) || 0;
  const volumeKg = Number(params.volumeKg) || 0;
  const setsDone = Number(params.setsDone) || 0;
  const maxKg = Number(params.maxKg) || 0;
  const durationMin = Math.max(1, Math.round(durationSec / 60));
  const stats = useStats();

  const [rpe, setRpe] = useState<number | null>(null);
  /* Whether the tap actually reached the logged workout. The rating is only
     written onto a session that is still open (< 30 min old); before, the screen
     printed «Qeyd olundu — növbəti dəfə çəki təklifi buna görə hesablanacaq» even
     when the write had been skipped, i.e. it confirmed something it had thrown
     away. Nothing may be confirmed that was not stored. */
  const [stored, setStored] = useState(false);

  // The workout is already saved by the session screen. Rating it writes the RPE
  // onto that same logged workout, and `suggestNext` (src/store/db.ts) reads it
  // back to pick the next load: Asan → +2.5 kq üst / +5 kq ayaq, Normal → +2.5 kq
  // yalnız bütün setlər hədəfi vurubsa, Ağır → eyni çəki, ardıcıl iki Ağır → −5%.
  const rate = (i: number) => {
    tapFeedback();
    setRpe(i);
    const workouts = useDb.getState().workouts;
    const last = workouts[0];
    /* `rate` is only ever reached from the «Necə keçdi?» buttons' onPress, so this
       clock read happens on a tap and never while rendering; react-hooks/purity
       flags it because the function is declared in the component body. Reading the
       clock is the whole point — the rating may only land on a session that is
       still open, and «still» has to be measured at the moment of the tap. */
    // eslint-disable-next-line react-hooks/purity
    const fresh = !!last && Date.now() - new Date(last.at).getTime() < 30 * 60 * 1000;
    if (!fresh) {
      setStored(false);
      return;
    }
    useDb.setState({ workouts: [{ ...last, rpe: i }, ...workouts.slice(1)] });
    setStored(true);
    /* And up to the server, so the answer survives a new phone. It is sent from
       here because `trainingSync` skips a workout the server already has, and by
       the time this screen is open the row has been there for a minute — which
       is why every rating anyone had ever given was device-only until now.
       Nothing on screen depends on it: the confirmation below promises the next
       weight suggestion, and that reads the LOCAL copy written above. A phone
       with no signal keeps the rating where it is useful and loses only the
       backup. */
    if (hasSupabaseConfig && UUID.test(last.id)) {
      void setMyWorkoutRpe(last.id, RPE[i]).catch((e) => {
        if (__DEV__) console.warn('[summary] rpe not synced:', String((e as Error)?.message ?? e));
      });
    }
  };

  const share = () =>
    Share.share({
      message:
        volumeKg > 0
          ? t('{title} — {min} dəq · {sets} set · {vol} t həcm. SPOT ilə.', {
              title: t(title),
              min: durationMin,
              sets: setsDone,
              vol: (volumeKg / 1000).toFixed(1),
              count: setsDone,
            })
          : t('{title} — {min} dəq · {sets} set. SPOT ilə.', { title: t(title), min: durationMin, sets: setsDone, count: setsDone }),
    }).catch(() => {});

  const finish = () => router.replace('/(tabs)/workout');

  return (
    /* No 'bottom' edge — see the note on the «Bitir» button below. */
    <Screen edges={['top']} padded>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
        <Animated.View entering={FadeInDown.duration(300)} style={styles.hero}>
          <View style={styles.disc}>
            <Icon name="check" size={38} color={palette.inkText} />
          </View>
          <AppText variant="title" style={{ marginTop: 20 }}>
            {t('Məşq bitdi')}
          </AppText>
          <AppText variant="body" color={palette.textSecondary} style={{ marginTop: 6 }}>
            {t('{title} · {n} dəqiqə', { title: t(title), n: durationMin, count: durationMin })}
          </AppText>
        </Animated.View>

        <View style={styles.stats}>
          <Stat value={t('{m}d', { m: durationMin, count: durationMin })} label={t('müddət')} />
          <Stat value={volumeKg > 0 ? t('{n} t', { n: (volumeKg / 1000).toFixed(1) }) : '—'} label={t('həcm')} />
          <Stat value={`${setsDone}`} label={t('set')} />
        </View>

        <View style={styles.streakCard}>
          <View style={styles.streakIcon}>
            <Icon name="flame" size={18} color={palette.streak} />
          </View>
          <View style={{ flex: 1 }}>
            {/* «Seriya», the word Profil and Analitika already use for this same
                counter — the English «streak» was the odd one out in an
                Azerbaijani-only UI. */}
            <AppText variant="callout">
              {stats.streakDays > 0
                ? t('{n} günlük seriya', { n: stats.streakDays, count: stats.streakDays })
                : t('Seriya bugün başladı')}
            </AppText>
            <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
              {t('Ümumi {n} məşq qeyd olunub', { n: stats.count, count: stats.count })}
            </AppText>
          </View>
        </View>

        {maxKg > 0 ? (
          <View style={styles.prCard}>
            <View style={styles.prIcon}>
              <Icon name="trophy" size={18} color={palette.voltDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="callout">{t('Bu məşqin ən ağır seti')}</AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
                {t('{n} kq', { n: maxKg })}
              </AppText>
            </View>
          </View>
        ) : null}

        <AppText variant="overline" color={palette.caption} style={{ marginTop: 24, marginBottom: 12 }}>
          {t('Necə keçdi?')}
        </AppText>
        <View style={styles.rpeRow}>
          {RPE.map((r, i) => (
            <PressableScale key={r} activeScale={0.96} haptic={false} onPress={() => rate(i)} style={[styles.rpe, rpe === i && styles.rpeOn]}>
              <AppText variant="headline" color={rpe === i ? palette.white : palette.inkText}>
                {t(r)}
              </AppText>
            </PressableScale>
          ))}
        </View>
        {rpe !== null ? (
          <AppText
            variant="footnote"
            color={stored ? palette.voltDeep : '#FF9500'}
            style={{ marginTop: 10, paddingHorizontal: 4, lineHeight: 18 }}>
            {!stored
              ? t('Qiymətləndirmə yazılmadı — bu məşq artıq bağlanıb, ona görə növbəti çəki təklifinə təsir etməyəcək.')
              : rpe === 0
                ? t('Qeyd olundu — növbəti dəfə çəki artırılmış təklif olunacaq: üst bədən +2.5 kq, ayaq +5 kq.')
                : rpe === 1
                  ? t('Qeyd olundu — bütün setlərdə hədəf təkrarı vurmusansa, növbəti dəfə +2.5 kq təklif olunacaq, yoxsa eyni çəki.')
                  : t('Qeyd olundu — növbəti dəfə eyni çəki təklif olunacaq. İki məşq ardıcıl «Ağır» keçsə, çəki 5% azaldılıb bərpa (deload) təklif olunacaq.')}
          </AppText>
        ) : null}

        <PressableScale activeScale={0.98} onPress={share} style={styles.shareRow}>
          <Icon name="share" size={19} color={palette.inkText} />
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{t('Nəticəni paylaş')}</AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
              {t('Yalnız sən seçdiyin yerə göndərilir')}
            </AppText>
          </View>
          <Icon name="chevR" size={18} color={palette.tertiary} />
        </PressableScale>
      </ScrollView>

      {/* The Məşq tab scene is already clear of the native tab bar in
          (tabs)/_layout — the floating pill's footprint with the home indicator folded in,
          and its 10pt breathing gap sits between this button and the pill. Adding the
          bottom safe-area inset on top of that only left a dead strip under the button. */}
      <Button title={t('Bitir')} full onPress={finish} />
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="title2">{value}</AppText>
      <AppText variant="caption" color={palette.caption} style={{ marginTop: 4 }}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: 20 },
  disc: { width: 88, height: 88, borderRadius: 44, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 10, marginTop: 28 },
  stat: { flex: 1, backgroundColor: palette.white, borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14, marginTop: 12 },
  streakIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,107,53,0.14)', alignItems: 'center', justifyContent: 'center' },
  prCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14, marginTop: 12 },
  prIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  rpeRow: { flexDirection: 'row', gap: 10 },
  rpe: { flex: 1, height: 52, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  rpeOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 24 },
});
