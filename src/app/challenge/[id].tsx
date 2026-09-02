import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { useAuthGate } from '@/lib/authGate';
import { useChallenge } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { gymById, useChallengeProgress } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useChallenge(id);
  const gate = useAuthGate();
  const joined = useAppStore((s) => s.joinedChallenges.includes(id));
  const join = useAppStore((s) => s.joinChallenge);
  // Real progress from the user's own logs — the seed `c.progress` is never shown.
  const progress = useChallengeProgress(c?.unit ?? '');
  // A gym challenge is framed by the user's OWN gym, not by the seed's ("Iron Bay").
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const homeGym = homeGymId ? gymById(homeGymId) : undefined;
  const scopeLabel = !c ? '' : c.scope === 'gym' ? (homeGym ? `${homeGym.name} · komanda` : 'Komanda') : c.scopeLabel;

  // appStore has joinChallenge but no leave action; write the persisted slice directly
  // rather than leaving the user stuck in a challenge forever.
  const leave = () =>
    confirm('Challenge-dən çıx', 'İstədiyin vaxt yenidən qoşula bilərsən.', [
      { label: 'Ləğv et', style: 'cancel' },
      {
        label: 'Çıx',
        style: 'destructive',
        onPress: () => {
          useAppStore.setState((s) => ({ joinedChallenges: s.joinedChallenges.filter((x) => x !== id) }));
          toast('Challenge-dən çıxdın', 'info');
        },
      },
    ]);

  if (!c) return null;

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar
        right={
          <PressableScale activeScale={0.9} onPress={() => Share.share({ message: `"${c.title}" challenge-i — SPOT-da mənə qoşul!` }).catch(() => {})}>
            <Icon name="share" size={20} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="overline" color={palette.voltDeep}>
          {scopeLabel.toUpperCase()}
        </AppText>
        <AppText variant="title" style={{ marginTop: 8 }}>
          {c.title}
        </AppText>
        <AppText variant="body" color={palette.text3} style={{ marginTop: 10, lineHeight: 22 }}>
          {c.description}
        </AppText>

        {/* No countdown: the challenge carries no real end date, and a static seed
            number rendered as "Qalıb: 11 gün" would be a fabricated live count. */}
        <View style={styles.metaRow}>
          <Meta icon="trophy" label="Mükafat" value={c.reward} />
          <Meta icon="target" label="Hədəf" value={`${c.target} ${c.unit}`} />
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressTop}>
            <AppText variant="headline">Sənin irəliləyişin</AppText>
            <AppText variant="headline" color={palette.voltDeep}>
              {progress} / {c.target} {c.unit}
            </AppText>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, (progress / c.target) * 100)}%` }]} />
          </View>
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
            {progress === 0
              ? 'Qeyd etdiyin məşqlərdən avtomatik hesablanır — hələ data yoxdur.'
              : 'Qeyd etdiyin məşqlərdən avtomatik hesablanır.'}
          </AppText>
        </View>

        <View style={styles.boardNote}>
          <Icon name="users" size={15} color={palette.caption} />
          <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
            Reytinq cədvəli iştirakçı datası toplananda açılacaq. Uydurma sıralama göstərmirik.
          </AppText>
        </View>

        <View style={[styles.boardNote, { marginTop: 10 }]}>
          <Icon name="clock" size={15} color={palette.caption} />
          <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
            Bitmə tarixi hələ təyin olunmayıb — real tarix olmadan geri sayım göstərmirik.
          </AppText>
        </View>

        {c.id === 'cross-100t' ? (
          <Button title="Zallar reytinqinə bax" variant="secondary" icon="trophy" onPress={() => router.push('/challenge/gyms')} full style={{ marginTop: 16 }} />
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={joined ? 'Qoşulmusan ✓ · çıxmaq üçün toxun' : 'Challenge-ə qoşul'}
          variant={joined ? 'secondary' : 'primary'}
          full
          notify={!joined}
          onPress={() => {
            if (joined) {
              leave();
              return;
            }
            gate(() => {
              join(id);
              toast(`"${c.title}" challenge-inə qoşuldun`);
            }, 'Challenge-ə qoşulmaq üçün');
          }}
        />
      </View>
    </Screen>
  );
}

function Meta({ icon, label, value }: { icon: 'trophy' | 'users' | 'clock' | 'target'; label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Icon name={icon} size={17} color={palette.textSecondary} />
      <AppText variant="caption" color={palette.caption} style={{ marginTop: 7 }}>
        {label}
      </AppText>
      <AppText variant="subhead" style={{ marginTop: 2, fontWeight: '700' }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  metaRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  meta: { flex: 1, backgroundColor: palette.white, borderRadius: 14, padding: 13 },
  progressCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 12 },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  track: { height: 10, borderRadius: 5, backgroundColor: palette.element, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: palette.volt },
  boardNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 4 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
