import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { azUpper } from '@/lib/az';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Standing } from '@/data/challenges';
import { useAuthGate } from '@/lib/authGate';
import { challengeStandings, useChallenge } from '@/lib/hooks';
import { joinChallenge as joinChallengeOnServer, leaveChallenge as leaveChallengeOnServer } from '@/lib/social';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { gymById, useChallengeProgress } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** A real deadline, from a real timestamp. The old screen said «Bitmə tarixi hələ
 *  təyin olunmayıb» for every challenge, because the table only had a `days_left`
 *  int that nothing decremented. */
function endsText(endsAt: string): string {
  const days = Math.ceil((Date.parse(endsAt) - Date.now()) / 86400000);
  if (days <= 0) return 'bugün';
  if (days === 1) return '1 gün';
  return `${days} gün`;
}

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useChallenge(id);
  const gate = useAuthGate();
  const joined = useAppStore((s) => s.joinedChallenges.includes(id));
  const join = useAppStore((s) => s.joinChallenge);
  /* Real progress from the user's own logs, inside the CHALLENGE's window. The
     seeded `progress` column is gone (schema60) and the window used to be the
     calendar month, which credited September sessions to an August challenge.
     `null` means the unit is not measurable from a workout row. */
  const progress = useChallengeProgress(c?.unit ?? '', { startsAt: c?.startsAt, endsAt: c?.endsAt });

  /* The ranking, counted on the server. The screen used to promise «Reytinq
     cedveli istirakci datasi toplananda acilacaq» — this is that data.
     `undefined` = not read yet, `null` = the read failed (never drawn as empty). */
  const [board, setBoard] = useState<Standing[] | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !id) return;
      let alive = true;
      challengeStandings(id)
        .then((r) => alive && setBoard(r))
        .catch(() => alive && setBoard(null));
      return () => {
        alive = false;
      };
    }, [id])
  );
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
          if (!hasSupabaseConfig) {
            toast('Challenge-dən çıxdın (yalnız bu cihazda)', 'info');
            return;
          }
          leaveChallengeOnServer(id)
            .then(() => toast('Challenge-dən çıxdın', 'info'))
            .catch(() => {
              useAppStore.setState((s) => ({ joinedChallenges: [...s.joinedChallenges, id] }));
              toast('Çıxmaq alınmadı — yenidən cəhd et', 'error');
            });
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
          {azUpper(scopeLabel)}
        </AppText>
        <AppText variant="title" style={{ marginTop: 8 }}>
          {c.title}
        </AppText>
        <AppText variant="body" color={palette.text3} style={{ marginTop: 10, lineHeight: 22 }}>
          {c.description}
        </AppText>

        <View style={styles.metaRow}>
          {c.endsAt ? <Meta icon="clock" label="Bitir" value={endsText(c.endsAt)} /> : null}
          <Meta icon="target" label="Hədəf" value={`${c.target} ${c.unit}`} />
          <Meta icon="users" label="İştirakçı" value={`${c.participants}`} />
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressTop}>
            <AppText variant="headline">Sənin irəliləyişin</AppText>
            {progress !== null ? (
              <AppText variant="headline" color={palette.voltDeep}>
                {progress} / {c.target} {c.unit}
              </AppText>
            ) : null}
          </View>
          {progress !== null ? (
            <>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.min(100, (progress / c.target) * 100)}%` }]} />
              </View>
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
                {progress === 0
                  ? 'Qeyd etdiyin məşqlərdən avtomatik hesablanır — hələ data yoxdur.'
                  : 'Qeyd etdiyin məşqlərdən avtomatik hesablanır.'}
              </AppText>
            </>
          ) : (
            /* A «5 dartma» target is not in any workout row — `workouts` stores
               duration, volume and set count, not per-exercise reps. This used to
               fall through to counting SESSIONS, so three workouts read as
               «3 / 5 dartma». A wrong measurement is worse than none. */
            <AppText variant="footnote" color={palette.caption} style={{ lineHeight: 18 }}>
              Bu hədəf ({c.target} {c.unit}) qeyd etdiyin məşqlərdən avtomatik ölçülə bilmir — SPOT məşqin
              müddətini və ümumi çəkisini saxlayır, hər hərəkətin təkrarını yox. İrəliləyişi özün izləyirsən.
            </AppText>
          )}
        </View>

        {/* The ranking. Counted from the participants' own workout rows — only for
            people who joined, and only ever one number each: no exercise, no
            weight, no dates. */}
        <AppText variant="overline" color={palette.caption} style={{ marginTop: 20, marginBottom: 10 }}>
          SIRALAMA
        </AppText>
        {board === null ? (
          <View style={styles.boardNote}>
            <Icon name="x" size={15} color={palette.red} />
            <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
              Sıralama yüklənmədi — bu, iştirakçı olmadığı demək deyil. Bağlantını yoxlayıb yenidən aç.
            </AppText>
          </View>
        ) : board === undefined ? (
          <View style={styles.boardNote}>
            <Icon name="clock" size={15} color={palette.caption} />
            <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
              Sıralama yüklənir…
            </AppText>
          </View>
        ) : board.length === 0 ? (
          <View style={styles.boardNote}>
            <Icon name="users" size={15} color={palette.caption} />
            <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
              Hələ heç kim qoşulmayıb. Birinci sən ola bilərsən.
            </AppText>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {board.map((r, i) => (
              <View key={r.profileId} style={[styles.boardRow, r.isMe && styles.boardRowMe]}>
                <AppText style={styles.rank}>{i + 1}</AppText>
                <Avatar name={r.name} uri={r.avatarUrl ?? undefined} size={34} />
                <View style={{ flex: 1 }}>
                  <AppText variant="subhead">{r.isMe ? 'Sən' : r.name || 'Ad yoxdur'}</AppText>
                  {r.username ? (
                    <AppText variant="caption" color={palette.caption}>
                      @{r.username}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="subhead" color={palette.voltDeep}>
                  {r.done === null ? '—' : `${r.done} ${c.unit}`}
                </AppText>
              </View>
            ))}
          </View>
        )}

        {/* The reward. It is the gym's or the admin's to hand over, not SPOT's —
            SPOT holds no money and gives nothing out, and it does not pick a
            winner. Saying that out loud is the difference between a prize and a
            trophy icon that means nothing. */}
        {c.reward ? (
          <View style={[styles.boardNote, { marginTop: 16 }]}>
            <Icon name="trophy" size={15} color={palette.caption} />
            <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
              Mükafat: {c.reward}. Mükafatı challenge-i açan tərəf verir — SPOT ödəniş qəbul etmir, mükafat
              paylamır və qalibi özü seçmir. Yuxarıdaki sıralama qeyd olunan məşqlərdən hesablanır.
            </AppText>
          </View>
        ) : null}

        {/* Was `c.id === 'cross-100t'` — a hardcoded seed id. The gym ranking is
            relevant to any tonnage-based team challenge. */}
        {c.scope === 'gym' && c.unit.toLowerCase() === 't' ? (
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
              /* `joinChallenge` (schema43) is the row that makes it real. It was
                 written and never called: the toast said «qoşuldun» while only
                 this device knew, the participant count could never move, and
                 the next launch's `syncSocial` replaced the local list with the
                 server's empty one — so the challenge quietly un-joined itself. */
              join(id);
              if (!hasSupabaseConfig) {
                toast('Serverə yazılmadı — qoşulma yalnız bu cihazdadır', 'error');
                return;
              }
              joinChallengeOnServer(id)
                .then(() => toast(`"${c.title}" challenge-inə qoşuldun`))
                .catch(() => {
                  useAppStore.setState((st) => ({
                    joinedChallenges: st.joinedChallenges.filter((x) => x !== id),
                  }));
                  toast('Qoşulmaq alınmadı — yenidən cəhd et', 'error');
                });
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
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: palette.white, borderRadius: 14, padding: 12 },
  boardRowMe: { borderWidth: 1.5, borderColor: palette.volt },
  rank: { width: 20, fontSize: 14, fontWeight: '800', color: palette.caption, textAlign: 'center' },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  track: { height: 10, borderRadius: 5, backgroundColor: palette.element, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: palette.volt },
  boardNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 4 },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
