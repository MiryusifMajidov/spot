import { useFocusEffect, useRouter } from 'expo-router';
import { errorFeedback, successFeedback, tapFeedback } from '@/lib/feedback';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getMyProfile, getPartner } from '@/lib/api';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { seedById, timeAgoAz, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real pending `match_requests` row addressed to me. `name` stays null when the
 *  sender's profile could not be read — we say so instead of inventing one. */
type Incoming = { id: string; fromProfile: string; at: string; name: string | null };

/** loading → the server read is in flight; ready → the list below is the truth;
 *  offline → there is no backend on this build; error → the read failed, so we must
 *  not render "nobody asked you". */
type Phase = 'loading' | 'ready' | 'offline' | 'error';

/** What the SERVER says about an offer I sent. `unknown` is a real state — the read
 *  failed or has not landed yet — and must never be painted as «Gözləyir». */
type OutStatus = 'pending' | 'declined' | 'unknown';

/** Forget an offer I sent. `declineMatch` is deliberately NOT used here: it would
 *  hide that person from Kəşf for good, which the user never asked for. */
const forgetOutgoing = (partnerId: string) =>
  useDb.setState((s) => {
    const rest = { ...s.matches };
    delete rest[partnerId];
    return { matches: rest };
  });

export default function Requests() {
  const router = useRouter();
  const matches = useDb((s) => s.matches);
  const acceptMatch = useDb((s) => s.acceptMatch);
  const declineMatch = useDb((s) => s.declineMatch);
  // Blocking promises «söhbətlərdə sənə görünməyəcək» — a request inbox that keeps
  // showing a blocked person's live «Qəbul et» button makes that sentence a lie.
  const blocked = useAppStore((s) => s.blocked);

  const [incoming, setIncoming] = useState<Incoming[]>([]);
  /** Real pending rows from people I passed on in Kartlar (or removed here). They are
   *  NOT dropped: a deck gesture must not destroy a message somebody really sent. */
  const [hidden, setHidden] = useState<Incoming[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>(hasSupabaseConfig ? 'loading' : 'offline');
  /** Server-read state for the offers I sent — separate from `phase`, because a failed
   *  outgoing read must not turn the incoming list into «yüklənmədi». */
  const [outPhase, setOutPhase] = useState<Phase>(hasSupabaseConfig ? 'loading' : 'offline');
  const [outStatus, setOutStatus] = useState<Record<string, OutStatus>>({});
  // Real display names for people who are not in the local catalogue (profile UUIDs).
  const [names, setNames] = useState<Record<string, string>>({});

  const outgoing = useMemo(
    () =>
      Object.values(matches)
        .filter((m) => m.state === 'requested' && !blocked.includes(m.partnerId))
        .sort((a, b) => b.at.localeCompare(a.at)),
    [matches, blocked]
  );

  /** Incoming offers exist only on the server — nothing local ever writes them.
   *  The offers I SENT live there too: their answer is the only way this loop can
   *  close for the person who asked. */
  const load = useCallback(async () => {
    if (!hasSupabaseConfig) {
      setPhase('offline');
      setOutPhase('offline');
      return;
    }
    let me: Awaited<ReturnType<typeof getMyProfile>> = null;
    try {
      me = await getMyProfile();
      if (!me) {
        setIncoming([]);
        setHidden([]);
        setPhase('error');
        setOutPhase('error');
        return;
      }
      const { data, error } = await supabase
        .from('match_requests')
        .select('id,from_profile,created_at')
        .eq('to_profile', me.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as { id: string; from_profile: string; created_at: string }[];
      const blockedIds = useAppStore.getState().blocked;
      const visible = rows.filter((r) => !blockedIds.includes(r.from_profile));
      const resolved = await Promise.all(
        visible.map(async (r) => ({
          id: r.id,
          fromProfile: r.from_profile,
          at: r.created_at,
          name:
            seedById(r.from_profile)?.name ??
            (await getPartner(r.from_profile)
              .then((p) => p?.name ?? null)
              .catch(() => null)),
        }))
      );
      // A «Keç» in Kartlar (or a «Sil» here) writes `declined` locally. That is a
      // decision about a card, not permission to delete a real message — those rows
      // go to the collapsed «Gizlədilmiş» list instead of disappearing.
      const local = useDb.getState().matches;
      setIncoming(resolved.filter((r) => local[r.fromProfile]?.state !== 'declined'));
      setHidden(resolved.filter((r) => local[r.fromProfile]?.state === 'declined'));
      setPhase('ready');
    } catch {
      setIncoming([]);
      setHidden([]);
      setPhase('error');
    }

    // ---- the rows I SENT: without this read the sender never learns the answer ----
    if (!me) {
      setOutPhase('error');
      return;
    }
    try {
      const { data: mine, error: mineErr } = await supabase
        .from('match_requests')
        .select('to_profile,status,created_at')
        .eq('from_profile', me.id)
        // Oldest first, so a re-sent offer's newer row overwrites the older answer
        // in the map below — the status shown is always the current one.
        .order('created_at', { ascending: true });
      if (mineErr) throw mineErr;
      const byId = new Map<string, string>(
        ((mine ?? []) as { to_profile: string; status: string }[]).map((r) => [r.to_profile, r.status] as const)
      );
      const db = useDb.getState();
      const next: Record<string, OutStatus> = {};
      for (const m of Object.values(db.matches)) {
        if (m.state !== 'requested' || !UUID.test(m.partnerId)) continue;
        const status = byId.get(m.partnerId);
        if (status === 'accepted') {
          // The loop finally closes: the thread opens and this person counts as a yoldaş.
          db.acceptMatch(m.partnerId);
        } else if (status === 'declined') {
          next[m.partnerId] = 'declined';
        } else if (status === 'pending') {
          next[m.partnerId] = 'pending';
        } else {
          // No row at all — it was withdrawn from another device. Nothing is waiting.
          forgetOutgoing(m.partnerId);
        }
      }
      setOutStatus(next);
      setOutPhase('ready');
    } catch {
      setOutPhase('error');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Names for the offers I sent: the local catalogue first, then the real profile. */
  const outgoingIds = useMemo(() => outgoing.map((m) => m.partnerId).join(','), [outgoing]);
  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !outgoingIds) return;
      let alive = true;
      (async () => {
        const ids = outgoingIds.split(',').filter((id) => UUID.test(id));
        const pairs = await Promise.all(
          ids.map(
            async (id) =>
              [
                id,
                await getPartner(id)
                  .then((p) => p?.name ?? null)
                  .catch(() => null),
              ] as const
          )
        );
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const [id, name] of pairs) if (name) map[id] = name;
        setNames((prev) => ({ ...prev, ...map }));
      })();
      return () => {
        alive = false;
      };
    }, [outgoingIds])
  );

  /** Accept: write the answer to the server first. If the row could not be updated
   *  the match still becomes local, but the toast says exactly that instead of
   *  claiming the other person was told. */
  const accept = async (row: Incoming) => {
    let delivered = false;
    try {
      const { data, error } = await supabase
        .from('match_requests')
        .update({ status: 'accepted' })
        .eq('id', row.id)
        .select('id');
      delivered = !error && !!data?.length;
    } catch {
      delivered = false;
    }
    acceptMatch(row.fromProfile);
    setIncoming((rows) => rows.filter((r) => r.id !== row.id));
    setHidden((rows) => rows.filter((r) => r.id !== row.id));
    if (delivered) {
      successFeedback();
      toast('Təklif qəbul edildi');
    } else {
      tapFeedback();
      toast('Qəbul bu cihazda qeyd olundu — qarşı tərəfə hələ çatmayıb', 'info');
    }
    router.push({ pathname: '/chat/[id]', params: { id: row.fromProfile, name: row.name ?? '' } });
  };

  /** Decline: hide it on my side for good, and try to mark the row as well. */
  const decline = async (row: Incoming) => {
    tapFeedback();
    declineMatch(row.fromProfile);
    setIncoming((rows) => rows.filter((r) => r.id !== row.id));
    setHidden((rows) => rows.filter((r) => r.id !== row.id));
    try {
      const { data, error } = await supabase
        .from('match_requests')
        .update({ status: 'declined' })
        .eq('id', row.id)
        .select('id');
      if (error || !data?.length) toast('Sorğu siyahından silindi — göndərənə bildiriş getmir', 'info');
    } catch {
      toast('Sorğu siyahından silindi — göndərənə bildiriş getmir', 'info');
    }
  };

  const cancel = (partnerId: string, name: string) => {
    const deliverable = hasSupabaseConfig && UUID.test(partnerId);
    confirm(
      'Təklifi geri götür?',
      deliverable
        ? `${name} göndərdiyin təklifi artıq görməyəcək.`
        : 'Bu təklif serverə çatmayıb — yalnız bu cihazdan silinəcək.',
      [
        { label: 'İmtina', style: 'cancel' },
        {
          label: 'Geri götür',
          style: 'destructive',
          onPress: async () => {
            if (!deliverable) {
              forgetOutgoing(partnerId);
              toast('Təklif cihazdan silindi', 'info');
              return;
            }
            try {
              const me = await getMyProfile();
              if (!me) throw new Error('no profile');
              const { data, error } = await supabase
                .from('match_requests')
                .delete()
                .eq('from_profile', me.id)
                .eq('to_profile', partnerId)
                .eq('status', 'pending')
                .select('id');
              // A 0-row delete withdrew nothing — it must never read as success.
              if (error || !data?.length) throw error ?? new Error('not withdrawn');
              forgetOutgoing(partnerId);
              successFeedback();
              toast('Təklif geri götürüldü');
            } catch {
              errorFeedback();
              toast('Təklif geri götürülmədi — yenidən cəhd et', 'error');
            }
          },
        },
      ]
    );
  };

  /** The pill on a sent offer says only what the server confirmed. */
  const statusOf = (partnerId: string): OutStatus | 'local' | 'loading' => {
    if (!hasSupabaseConfig || !UUID.test(partnerId)) return 'local';
    if (outPhase === 'loading') return 'loading';
    if (outPhase !== 'ready') return 'unknown';
    return outStatus[partnerId] ?? 'unknown';
  };

  const nothing = incoming.length === 0 && outgoing.length === 0 && hidden.length === 0;

  const renderIncoming = (m: Incoming) => (
    <View key={m.id} style={styles.card}>
      <View style={styles.head}>
        <Avatar name={m.name ?? '?'} size={44} />
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{m.name ?? 'Adı göstərilmir'}</AppText>
          <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
            {timeAgoAz(m.at)}
          </AppText>
        </View>
      </View>
      <AppText variant="body" color={palette.text3} style={{ marginTop: 10, lineHeight: 21 }}>
        Birlikdə məşq etmək istəyir.
      </AppText>
      <View style={styles.btns}>
        <PressableScale activeScale={0.97} onPress={() => decline(m)} style={styles.decline}>
          <AppText style={{ color: palette.textSecondary, fontWeight: '600', fontSize: 14 }}>Sil</AppText>
        </PressableScale>
        <PressableScale activeScale={0.97} onPress={() => accept(m)} style={styles.accept}>
          <AppText style={{ color: palette.white, fontWeight: '600', fontSize: 14 }}>Qəbul et</AppText>
        </PressableScale>
      </View>
    </View>
  );

  return (
    <Screen>
      <NavBar title="Sorğular" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.note}>
          <Icon name="shield" size={15} color={palette.caption} />
          <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
            Bir sorğu = bir mesaj. Cavab vermədikcə söhbətə düşmür və göndərən «oxundu» görmür.
          </AppText>
        </View>

        {phase === 'loading' && nothing ? (
          <View style={styles.empty}>
            <Icon name="clock" size={26} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              Sorğular yüklənir…
            </AppText>
          </View>
        ) : null}

        {phase === 'error' ? (
          <View style={styles.empty}>
            <Icon name="bell" size={26} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              Sənə gələn sorğular yüklənmədi
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 280, lineHeight: 21 }}>
              Serverlə əlaqə alınmadı, ona görə sənə kimin təklif göndərdiyini göstərə bilmirik. İnterneti yoxlayıb bu
              səhifəni yenidən aç.
            </AppText>
            <PressableScale activeScale={0.96} onPress={load} style={styles.emptyBtn}>
              <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Yenidən cəhd et</AppText>
            </PressableScale>
          </View>
        ) : null}

        {phase === 'offline' ? (
          <View style={styles.empty}>
            <Icon name="bell" size={26} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              Sorğular hazırda əlçatan deyil
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 280, lineHeight: 21 }}>
              Bu quraşdırmada server bağlantısı yoxdur — sənə kimin təklif göndərdiyini oxuya bilmirik.
              {outgoing.length ? ' Aşağıda yalnız sənin göndərdiyin təkliflər var.' : ''}
            </AppText>
          </View>
        ) : null}

        {phase === 'ready' && nothing ? (
          <View style={styles.empty}>
            <Icon name="users" size={26} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              Sorğu yoxdur
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 280, lineHeight: 21 }}>
              Kimsə sənə məşq təklif edəndə sorğu burada görünəcək. Sənin göndərdiyin təkliflər də cavab gözlədiyi müddətdə
              burada olur.
            </AppText>
            <PressableScale activeScale={0.96} onPress={() => router.push('/(tabs)/discover/cards')} style={styles.emptyBtn}>
              <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Yoldaş axtar</AppText>
            </PressableScale>
          </View>
        ) : null}

        {incoming.length > 0 ? (
          <>
            <AppText variant="overline" color={palette.caption} style={{ marginBottom: 10 }}>
              Sənə gələn · {incoming.length}
            </AppText>
            {incoming.map(renderIncoming)}
          </>
        ) : null}

        {outgoing.length > 0 ? (
          <>
            <AppText variant="overline" color={palette.caption} style={{ marginTop: incoming.length ? 18 : 0, marginBottom: 10 }}>
              Göndərdiklərin · {outgoing.length}
            </AppText>
            {outgoing.map((m) => {
              const resolved = seedById(m.partnerId)?.name ?? names[m.partnerId] ?? null;
              const name = resolved ?? 'Adı göstərilmir';
              const st = statusOf(m.partnerId);
              const pill =
                st === 'pending'
                  ? { icon: 'clock' as const, label: 'Gözləyir' }
                  : st === 'declined'
                    ? { icon: 'x' as const, label: 'Qəbul edilmədi' }
                    : st === 'loading'
                      ? { icon: 'clock' as const, label: 'Yoxlanılır…' }
                      : st === 'local'
                        ? { icon: 'clock' as const, label: 'Göndərilməyib' }
                        : { icon: 'bell' as const, label: 'Vəziyyət naməlum' };
              return (
                <View key={m.partnerId} style={styles.card}>
                  <View style={styles.head}>
                    <Avatar name={name} size={44} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="headline">{name}</AppText>
                      <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
                        Göndərildi · {timeAgoAz(m.at)}
                      </AppText>
                    </View>
                    <View style={styles.pending}>
                      <Icon name={pill.icon} size={12} color={palette.textSecondary} />
                      <AppText style={{ fontSize: 11, fontWeight: '600', color: palette.textSecondary }}>{pill.label}</AppText>
                    </View>
                  </View>
                  {st === 'declined' ? (
                    <AppText variant="body" color={palette.text3} style={{ marginTop: 10, lineHeight: 21 }}>
                      {name} bu təklifi qəbul etmədi.
                    </AppText>
                  ) : st === 'unknown' ? (
                    <AppText variant="footnote" color={palette.caption} style={{ marginTop: 10, lineHeight: 18 }}>
                      Cavabı oxuya bilmədik — bu təklifin qəbul edilib-edilmədiyini bilmirik. Səhifəni yenidən aç.
                    </AppText>
                  ) : null}
                  {/* The picked hour lives only on this phone: `match_requests` has no
                      column for it, so it never travelled. Saying so beats showing it
                      in the place where a delivered message would be. */}
                  {m.question ? (
                    <>
                      <AppText variant="body" color={palette.text3} style={{ marginTop: 10, lineHeight: 21 }}>
                        {m.question}
                      </AppText>
                      <AppText variant="caption" color={palette.caption} style={{ marginTop: 4, lineHeight: 17 }}>
                        Bu vaxt yalnız səndə qeyd olunub — təklifin içində getmir.
                      </AppText>
                    </>
                  ) : null}
                  <View style={styles.btns}>
                    {st === 'declined' ? (
                      <PressableScale
                        activeScale={0.97}
                        onPress={() => {
                          tapFeedback();
                          forgetOutgoing(m.partnerId);
                          toast('Təklif siyahıdan silindi', 'info');
                        }}
                        style={styles.decline}>
                        <AppText style={{ color: palette.textSecondary, fontWeight: '600', fontSize: 14 }}>Siyahıdan sil</AppText>
                      </PressableScale>
                    ) : (
                      <PressableScale activeScale={0.97} onPress={() => cancel(m.partnerId, name)} style={styles.decline}>
                        <AppText style={{ color: palette.textSecondary, fontWeight: '600', fontSize: 14 }}>Geri götür</AppText>
                      </PressableScale>
                    )}
                    <PressableScale
                      activeScale={0.97}
                      onPress={() => router.push({ pathname: '/(tabs)/discover/partner/[id]', params: { id: m.partnerId } })}
                      style={styles.secondary}>
                      <AppText style={{ color: palette.inkText, fontWeight: '600', fontSize: 14 }}>Profilə bax</AppText>
                    </PressableScale>
                  </View>
                </View>
              );
            })}
          </>
        ) : null}

        {hidden.length > 0 ? (
          <>
            <PressableScale
              activeScale={0.98}
              haptic={false}
              onPress={() => setShowHidden((v) => !v)}
              style={[styles.hiddenHead, { marginTop: incoming.length || outgoing.length ? 18 : 0 }]}>
              <Icon name={showHidden ? 'chevD' : 'chevR'} size={16} color={palette.caption} />
              <AppText variant="overline" color={palette.caption} style={{ flex: 1 }}>
                Gizlədilmiş sorğular · {hidden.length}
              </AppText>
            </PressableScale>
            <AppText variant="caption" color={palette.caption} style={{ marginBottom: 10, lineHeight: 17, paddingHorizontal: 4 }}>
              Kartlarda «Keç» dediyin və ya buradan sildiyin adamlardan gələn real sorğular. Silinmir — istəsən burada qəbul
              edə bilərsən.
            </AppText>
            {showHidden ? hidden.map(renderIncoming) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingHorizontal: 4, marginBottom: 14 },
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.grouped, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  btns: { flexDirection: 'row', gap: 9, marginTop: 14 },
  decline: { flex: 1, height: 42, borderRadius: 12, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  secondary: { flex: 1, height: 42, borderRadius: 12, backgroundColor: palette.grouped, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  accept: { flex: 1, height: 42, borderRadius: 12, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  hiddenHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4, marginBottom: 2 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyBtn: { marginTop: 18, height: 44, paddingHorizontal: 22, borderRadius: 13, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
});
