import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { Screen } from '@/components/ui/Screen';
import { useGyms } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { useChallengeProgress } from '@/store/db';
import { palette, spacing } from '@/theme';

/**
 * Cross-gym ranking. The app does not yet aggregate per-gym volume server-side, so
 * there is no honest ranking to draw — the old table was hardcoded tonnage with
 * "SƏNİN ZALIN" pinned to Iron Bay for everyone. Until the aggregate exists this
 * screen shows the one number that IS real: the user's own contribution.
 */
export default function GymRanking() {
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const gyms = useGyms();
  const myGym = gyms.find((g) => g.id === homeGymId) ?? null;
  const myTons = useChallengeProgress('t');

  return (
    <Screen>
      <NavBar title="Zallar arası reytinq" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary}>
            SƏNİN TÖHFƏN · BU AY
          </AppText>
          <AppText variant="title" style={{ marginTop: 10 }}>
            {myTons} t
          </AppText>
          <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 8, lineHeight: 19 }}>
            {myGym ? `${myGym.name} adına qeyd etdiyin ümumi həcm.` : 'Əsas zalını seçsən, töhfən həmin zala yazılacaq.'}
            {myTons === 0 ? ' Məşqlərini qeyd et — rəqəm buradan artacaq.' : ''}
          </AppText>
        </View>

        <View style={styles.note}>
          <Icon name="target" size={15} color={palette.caption} />
          <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
            Zallar arası cədvəl kifayət qədər üzv məşqlərini qeyd edəndə açılacaq. Sıralama üzv başına düşən həcmə görə olacaq — böyük zal avtomatik qazanmır. Uydurma rəqəm göstərmirik.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 18 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 4, marginTop: 16 },
});
