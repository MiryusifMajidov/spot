import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { followProfile } from '@/lib/social';
import { SuggestedTrainer, suggestedTrainers } from '@/lib/suggested';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useFormat, useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';

/**
 * The last step of registration: who is already here.
 *
 * A new account opens onto an empty feed and an empty everything — the one
 * thing SPOT can do at that moment is introduce a few real coaches. Which ones
 * is an admin decision (`featured_trainers`, schema75); when nothing is
 * configured the server shuffles the listed trainers instead, because
 * `trainers.rating` is pinned to 0 and ordering by it would hand the same two
 * people every placement forever.
 *
 * Three rules this screen keeps:
 *
 *  · It is SKIPPABLE, loudly. «Keç» sits in the top bar from the first frame,
 *    before the list has even loaded, and nothing is pre-selected — a follow the
 *    person did not choose is a follow they did not make.
 *  · It never invents a fifth trainer. The server is asked for five and answers
 *    with what exists. The screen shows what came back and claims no number.
 *  · When there is nobody to suggest — or the read fails — it does not appear at
 *    all. Registration is already finished and saved by this point, so it steps
 *    out of the way instead of showing a new member an empty box titled
 *    «tövsiyə olunanlar».
 */

type State = { k: 'loading' } | { k: 'ready'; rows: SuggestedTrainer[] };

export default function SuggestTrainers() {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<State>({ k: 'loading' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  /* A ref, not a state flag. `leave()` is reached from inside the effect below,
     and a setState there is a cascading render the compiler refuses to
     memoize around — so leaving writes no state at all. The guard is still
     needed: the auto-skip and an impatient tap on «Keç» can both fire. */
  const left = useRef(false);
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    router.replace('/(tabs)/discover');
  }, [router]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      leave();
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const rows = await suggestedTrainers(5);
        if (!alive) return;
        // Nothing to show is not a screen. Same for a read that failed: this is
        // an optional extra at the end of registration, and holding somebody at
        // the door over it would cost an account in order to say nothing.
        if (rows.length === 0) leave();
        else setState({ k: 'ready', rows });
      } catch {
        if (alive) leave();
      }
    })();
    return () => {
      alive = false;
    };
  }, [leave]);

  const chosen = state.k === 'ready' ? state.rows.filter((tr) => picked[tr.ownerId]) : [];

  const follow = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    const results = await Promise.allSettled(chosen.map((tr) => followProfile(tr.ownerId)));
    setBusy(false);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    /* Record the follows that REALLY landed in the list the feed reads its
       «İzlə / İzlənir» labels from. Only the server wrote them before, so the
       toast said «3 müəllim izlənilir» while the same trainers' videos, one tab
       over, still offered «İzlə» until the app was killed and relaunched. The
       failed ones are left out: a label must not claim a follow nobody made. */
    const landed = chosen.filter((_, i) => results[i].status === 'fulfilled').map((tr) => tr.ownerId);
    if (landed.length) {
      const cur = useAppStore.getState().following;
      useAppStore.getState().setSocialFromServer({
        following: [...cur, ...landed.filter((id) => !cur.includes(id))],
      });
    }

    if (ok === 0) {
      // Every one of them failed. «İzlənilir» here would leave the person
      // believing in a follow the server never recorded.
      errorFeedback();
      toast(t('İzləmək alınmadı — bağlantını yoxla. Müəllimləri sonra Kəşf-dən tapa bilərsən.'), 'error');
      return;
    }
    successFeedback();
    toast(
      ok === chosen.length
        ? t('{n} müəllim izlənilir', { n: ok, count: ok })
        : t('İzlənildi: {n} / {total} müəllim — qalanını sonra yenidən yoxla', {
            total: chosen.length,
            n: ok,
            count: chosen.length,
          })
    );
    leave();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }} />
        {/* Live from the first frame, on purpose: a skip must never wait on a
            network request the person did not ask for. */}
        <PressableScale activeScale={0.92} haptic={false} onPress={leave} style={styles.skip}>
          <AppText variant="body" color={palette.blue}>
            {t('Keç')}
          </AppText>
        </PressableScale>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText variant="title" style={{ marginBottom: 8 }}>
          {t('Hesabın hazırdır')}
        </AppText>
        <AppText variant="body" color={palette.textSecondary} style={{ marginBottom: 22, lineHeight: 21 }}>
          {t('SPOT-dakı müəllimlərdən bəziləri. İzləsən, paylaşdıqları məşq videoları lentində görünəcək. İstəmirsənsə keç — sonra Kəşf-dən tapa bilərsən.')}
        </AppText>

        {state.k === 'ready' ? (
          state.rows.map((tr) => (
            <TrainerRow
              key={tr.ownerId}
              trainer={tr}
              on={!!picked[tr.ownerId]}
              onToggle={() => setPicked((p) => ({ ...p, [tr.ownerId]: !p[tr.ownerId] }))}
            />
          ))
        ) : (
          <AppText variant="body" color={palette.textSecondary}>
            {t('Yüklənir…')}
          </AppText>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={
            busy
              ? t('İzlənilir…')
              : chosen.length === 0
                ? t('Seç və izlə')
                : chosen.length === 1
                  ? t('1 müəllimi izlə')
                  : t('{n} müəllimi izlə', { n: chosen.length, count: chosen.length })
          }
          onPress={() => void follow()}
          disabled={busy || chosen.length === 0}
          full
        />
        <PressableScale haptic={false} onPress={leave} style={styles.later}>
          <AppText variant="subhead" color={palette.textSecondary}>
            {t('İndi yox')}
          </AppText>
        </PressableScale>
      </View>
    </Screen>
  );
}

function TrainerRow({ trainer, on, onToggle }: { trainer: SuggestedTrainer; on: boolean; onToggle: () => void }) {
  const fmt = useFormat();
  const t = useT();
  return (
    <PressableScale activeScale={0.98} onPress={onToggle} style={[styles.row, on ? styles.rowOn : null]}>
      <Avatar name={trainer.name} uri={trainer.photoUrl} size={48} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <AppText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {trainer.name}
          </AppText>
          {trainer.verified ? <Icon name="verified" size={15} color={palette.blue} /> : null}
        </View>
        <AppText variant="footnote" color={palette.textSecondary} numberOfLines={1} style={{ marginTop: 2 }}>
          {trainer.specialty || t('Məşqçi')}
        </AppText>
        {/* A rating is printed only when somebody actually gave one. The column
            defaults to 0, and «0,0 ★» reads as a bad coach rather than as a
            coach nobody has rated yet. */}
        {trainer.rating > 0 ? (
          <View style={styles.metaRow}>
            <Icon name="star" size={12} color={palette.voltDeep} />
            <AppText variant="caption" color={palette.caption}>
              {fmt.decimal(trainer.rating, 1)}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={[styles.check, on ? styles.checkOn : null]}>
        {on ? <Icon name="check" size={15} color={palette.ink} /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, height: 44 },
  skip: { paddingHorizontal: 8, paddingVertical: 6 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: palette.separator,
    padding: 12,
    marginBottom: 10,
  },
  rowOn: { borderColor: palette.ink },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: palette.separator,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: palette.volt, borderColor: palette.volt },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 6 },
  later: { alignSelf: 'center', paddingVertical: 14 },
});
