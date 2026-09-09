import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { azUpper } from '@/lib/az';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Challenge } from '@/data/challenges';
import { useChallenges } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { gymById, useChallengeProgress, useDb } from '@/store/db';
import { palette, spacing } from '@/theme';

/** A "gym day" runs 04:00 → 04:00, same boundary the engine's streak uses. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  d.setHours(d.getHours() - 4);
  return d.toISOString().slice(0, 10);
}

/** The last 7 gym-days as booleans (oldest → newest) from the user's REAL logs. */
function useLast7Days(): boolean[] {
  const workouts = useDb((s) => s.workouts);
  const checkIns = useDb((s) => s.checkIns);
  return useMemo(() => {
    const active = new Set<string>([...workouts.map((w) => dayKey(w.at)), ...checkIns.map((c) => dayKey(c.at))]);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return active.has(dayKey(d.toISOString()));
    });
  }, [workouts, checkIns]);
}

/** «3 gün qalıb» from a real end date. The old card showed `days_left`, an int in
 *  the database that nothing ever decremented. */
function daysLeftText(endsAt: string): string {
  const ms = Date.parse(endsAt) - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (days <= 0) return 'bugün bitir';
  if (days === 1) return '1 gün qalıb';
  return `${days} gün qalıb`;
}

export default function Challenges() {
  const router = useRouter();
  const { active: a, joinable, streak: streakChallenge } = useChallenges();
  const dayCells = useLast7Days();
  // Progress is computed from the user's own logs, inside the CHALLENGE's window —
  // never read from a seed literal, and never over the calendar month, which used
  // to count September sessions towards an August challenge.
  const activeProgress = useChallengeProgress(a?.unit ?? '', { startsAt: a?.startsAt, endsAt: a?.endsAt });
  const streakDays = useChallengeProgress('gün') ?? 0;
  const streakLeft = Math.max(0, streakChallenge.target - streakDays);
  const joined = useAppStore((s) => s.joinedChallenges);
  // A gym challenge belongs to the user's OWN gym. The seed label ("Iron Bay · komanda")
  // describes nobody in particular, so it is never rendered as-is.
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const homeGym = homeGymId ? gymById(homeGymId) : undefined;
  const scopeLabel = (c: Challenge) =>
    c.scope === 'gym' ? (homeGym ? `${homeGym.name} · komanda` : 'Komanda') : c.scopeLabel;

  return (
    <Screen>
      <NavBar
        title="Challenge-lər"
        right={
          <PressableScale activeScale={0.9} onPress={() => router.push('/challenge/gyms')}>
            <Icon name="trophy" size={22} color={palette.inkText} />
          </PressableScale>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Active (ink) — only when the server really has a published, unfinished
            challenge. This card used to be drawn from a hardcoded id, so an
            August challenge sat here in September and the admin panel's
            «Dayandır» changed nothing on it. */}
        {a ? (
          <PressableScale activeScale={0.98} onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: a.id } })} style={styles.activeCard}>
            <View style={styles.activeHead}>
              <AppText style={styles.activeOverline}>{azUpper(scopeLabel(a))}</AppText>
              {a.endsAt ? (
                <View style={styles.rewardTag}>
                  <Icon name="clock" size={11} color={palette.inkText} />
                  <AppText style={{ fontSize: 10.5, fontWeight: '700', color: palette.inkText }}>{daysLeftText(a.endsAt)}</AppText>
                </View>
              ) : null}
            </View>
            <AppText style={styles.activeTitle}>{a.title}</AppText>
            {activeProgress === null ? (
              /* The unit is not something SPOT can measure (a «5 dartma» target is
                 not in any workout row). A session count under a pull-up label
                 would be a wrong measurement dressed as a right one. */
              <AppText style={{ color: 'rgba(255,255,255,0.62)', fontSize: 12.5, marginTop: 14, lineHeight: 18 }}>
                Bu challenge-in hədəfi ({a.target} {a.unit}) qeyd etdiyin məşqlərdən avtomatik ölçülmür — irəliləyişi
                özün izləyirsən.
              </AppText>
            ) : (
              <>
                <View style={styles.activeProgress}>
                  <View style={styles.activeTrack}>
                    <View style={[styles.activeFill, { width: `${Math.min(100, (activeProgress / a.target) * 100)}%` }]} />
                  </View>
                  <AppText style={{ color: palette.white, fontSize: 14, fontWeight: '700' }}>
                    {activeProgress} / {a.target}
                  </AppText>
                </View>
                <AppText style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11.5, marginTop: 10 }}>
                  {activeProgress === 0 ? 'Hələ başlamamısan — ilk məşqini qeyd et.' : 'Son 7 gün'}
                </AppText>
                <View style={styles.dayCells}>
                  {dayCells.map((on, i) => (
                    <View key={i} style={[styles.dayCell, { backgroundColor: on ? palette.volt : 'rgba(255,255,255,0.14)' }]} />
                  ))}
                </View>
              </>
            )}
          </PressableScale>
        ) : (
          <View style={styles.noneCard}>
            <AppText variant="headline">Hazırda gedən challenge yoxdur</AppText>
            <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 5, lineHeight: 19 }}>
              Yeni challenge başlayanda burada görünəcək. Aşağıdaki streak isə həmişə sənindir — heç kimdən asılı deyil.
            </AppText>
          </View>
        )}

        {/* Streak (white) */}
        <View style={styles.streakCard}>
          <View style={styles.streakHead}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="flame" size={16} color={palette.streak} />
              <AppText style={styles.streakOverline}>{azUpper(streakChallenge.scopeLabel)}</AppText>
            </View>
            <AppText style={{ fontSize: 13, fontWeight: '700', color: palette.caption }}>{streakDays} gün</AppText>
          </View>
          <AppText variant="title3" style={{ marginTop: 2 }}>
            {streakChallenge.title}
          </AppText>
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 7 }}>
            {streakDays === 0
              ? `Ardıcıl ${streakChallenge.target} gün ən azı 1 məşq. Bu gün başlaya bilərsən.`
              : `Ardıcıl ${streakChallenge.target} gün ən azı 1 məşq. ${streakLeft} gün qalıb.`}
          </AppText>
          <View style={styles.streakProgress}>
            <View style={styles.streakTrack}>
              <View style={[styles.streakFill, { width: `${Math.min(100, (streakDays / streakChallenge.target) * 100)}%` }]} />
            </View>
            <AppText style={{ fontSize: 13.5, fontWeight: '700' }}>
              {streakDays} / {streakChallenge.target}
            </AppText>
          </View>
        </View>

        {joinable.length > 0 ? (
          <AppText variant="overline" color={palette.caption} style={{ marginTop: 18, marginBottom: 11 }}>
            Qoşula bilərsən
          </AppText>
        ) : null}
        {joinable.map((c) => (
          <JoinRow
            key={c.id}
            challenge={c}
            label={scopeLabel(c)}
            icon={c.scope === 'gym' ? 'users' : 'target'}
            joined={joined.includes(c.id)}
            onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })}
          />
        ))}
      </ScrollView>
    </Screen>
  );
}

function JoinRow({
  challenge,
  label,
  icon,
  joined,
  onPress,
}: {
  challenge: Challenge;
  label: string;
  icon: IconName;
  joined: boolean;
  onPress: () => void;
}) {
  const isGym = challenge.scope === 'gym';
  return (
    <PressableScale activeScale={0.99} onPress={onPress} style={styles.joinRow}>
      <View style={[styles.joinIcon, { backgroundColor: isGym ? 'rgba(198,255,61,0.30)' : palette.element }]}>
        <Icon name={icon} size={24} color={isGym ? palette.voltDeep : palette.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{challenge.title}</AppText>
        <AppText variant="caption" color={palette.caption} style={{ marginTop: 4 }}>
          {label}
        </AppText>
      </View>
      <View style={[styles.joinBtn, joined && { backgroundColor: palette.volt }]}>
        <AppText style={{ color: joined ? palette.inkText : palette.white, fontSize: 12.5, fontWeight: '600' }}>{joined ? 'Qoşulmusan' : 'Qoşul'}</AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  activeCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 18, marginBottom: 13 },
  noneCard: { backgroundColor: palette.white, borderRadius: 20, padding: 18, marginBottom: 13 },
  activeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  activeOverline: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, color: palette.volt },
  rewardTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.volt, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  activeTitle: { color: palette.white, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  activeProgress: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  activeTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  activeFill: { height: 8, borderRadius: 4, backgroundColor: palette.volt },
  dayCells: { flexDirection: 'row', gap: 5, marginTop: 14 },
  dayCell: { flex: 1, height: 26, borderRadius: 6 },
  streakCard: { backgroundColor: palette.white, borderRadius: 20, padding: 17, marginBottom: 4 },
  streakHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  streakOverline: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, color: '#D14A15' },
  streakProgress: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 13 },
  streakTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: palette.element2, overflow: 'hidden' },
  streakFill: { height: 8, borderRadius: 4, backgroundColor: palette.streak },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: palette.white, borderRadius: 18, padding: 15, marginBottom: 11 },
  joinIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  joinBtn: { backgroundColor: palette.ink, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 8 },
});
