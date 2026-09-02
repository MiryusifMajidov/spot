import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getPartner } from '@/lib/api';
import { useTrainers } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { seedById, timeAgoAz, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { useDiscoverPrefs } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';
import { getMyThreads, type ThreadSummary } from '@/lib/chat';

type Row = {
  id: string;
  name: string;
  kind: 'partner' | 'trainer';
  last: string;
  at: string;
  time: string;
  unread: boolean;
};

export default function Chats() {
  const router = useRouter();
  const matches = useDb((s) => s.matches);
  const threads = useDb((s) => s.threads);
  const lastRead = useDiscoverPrefs((s) => s.lastRead);
  const trainers = useTrainers();
  // «…söhbətlərdə sənə görünməyəcək» is a promise this list has to keep.
  const blocked = useAppStore((s) => s.blocked);
  /** Real names for accepted partners. A profile UUID is an id, never a label —
   *  and «Yoldaş» on every row makes two conversations indistinguishable. */
  const [names, setNames] = useState<Record<string, string>>({});

  const incomingCount = useMemo(() => Object.values(matches).filter((m) => m.state === 'incoming').length, [matches]);
  const pendingOut = useMemo(() => Object.values(matches).filter((m) => m.state === 'requested').length, [matches]);

  const partnerIdsKey = useMemo(
    () =>
      Object.values(matches)
        .filter((m) => m.state === 'accepted' && !blocked.includes(m.partnerId))
        .map((m) => m.partnerId)
        .sort()
        .join(','),
    [matches, blocked]
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !partnerIdsKey) return;
      let alive = true;
      (async () => {
        const ids = partnerIdsKey.split(',').filter(Boolean);
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
    }, [partnerIdsKey])
  );

  /* `null` while the read is in flight or after it failed — the screen must not
     say «Hələ söhbət yoxdur» about a list it could not fetch. */
  const [serverThreads, setServerThreads] = useState<ThreadSummary[]>([]);
  const [threadsFailed, setThreadsFailed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!hasSupabaseConfig) return;
      getMyThreads()
        .then((t) => { if (alive) { setServerThreads(t); setThreadsFailed(false); } })
        .catch(() => alive && setThreadsFailed(true));
      return () => { alive = false; };
    }, [])
  );

  const chats: Row[] = useMemo(() => {
    const build = (id: string, name: string, kind: Row['kind']): Row => {
      const thread = threads[id] ?? [];
      const last = thread[thread.length - 1];
      return {
        id,
        name,
        kind,
        last: last ? (last.kind === 'invite' ? `📅 ${last.invite?.when ?? 'Məşq təklifi'}` : last.text) : 'Söhbətə başla',
        at: last?.at ?? '',
        time: last ? timeAgoAz(last.at) : '',
        // Unread = they wrote after I last opened the thread — not "they wrote last".
        unread: !!last && last.from === 'them' && last.at > (lastRead[id] ?? ''),
      };
    };

    // Real partner conversations: a match both sides agreed to. A blocked person
    // leaves the list — the block dialog says they will.
    const partnerRows = Object.values(matches)
      .filter((m) => m.state === 'accepted' && !blocked.includes(m.partnerId))
      .map((m) => build(m.partnerId, seedById(m.partnerId)?.name ?? names[m.partnerId] ?? 'Adı göstərilmir', 'partner'));

    // Real trainer/other conversations: any thread the user actually wrote in.
    const partnerIds = new Set(partnerRows.map((r) => r.id));
    const otherRows = Object.keys(threads)
      .filter((id) => !partnerIds.has(id) && !blocked.includes(id) && (threads[id]?.length ?? 0) > 0)
      .map((id) => build(id, trainers.find((t) => t.id === id)?.name ?? seedById(id)?.name ?? names[id] ?? 'Adı göstərilmir', 'trainer'));

    /* Server threads (schema42) are the real conversations — a message that
       reached the other person. They replace the device-only row for the same
       counterpart, because that row's preview came from a message nobody
       received. Anything the server does not know about still shows from the
       local store, with its own honest state. */
    const serverRows: Row[] = serverThreads
      .filter((t) => !blocked.includes(t.otherProfileId))
      .map((t) => ({
        id: t.otherProfileId,
        name: t.otherName ?? names[t.otherProfileId] ?? 'Adı göstərilmir',
        kind: 'partner' as const,
        last: t.lastBody ? (t.lastMine ? `Sən: ${t.lastBody}` : t.lastBody) : 'Söhbətə başla',
        at: t.lastAt ?? '',
        time: t.lastAt ? timeAgoAz(t.lastAt) : '',
        unread: t.unread > 0,
      }));

    const fromServer = new Set(serverRows.map((r) => r.id));
    return [...serverRows, ...partnerRows.filter((r) => !fromServer.has(r.id)), ...otherRows.filter((r) => !fromServer.has(r.id))]
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [matches, threads, lastRead, trainers, blocked, names, serverThreads]);

  return (
    <Screen>
      <NavBar title="Söhbətlər" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Requests box */}
        <PressableScale activeScale={0.98} onPress={() => router.push('/chat/requests')} style={styles.requests}>
          <View style={styles.reqIcon}>
            <Icon name="users" size={21} color={palette.streak} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">Sorğular</AppText>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 3 }}>
              {incomingCount > 0
                ? `${incomingCount} yeni sorğu`
                : pendingOut > 0
                  ? `${pendingOut} təklifin cavab gözləyir`
                  : 'Gələn və göndərdiyin təkliflər'}
            </AppText>
          </View>
          {incomingCount > 0 ? (
            <View style={styles.reqBadge}>
              <AppText style={{ color: palette.white, fontSize: 12, fontWeight: '700' }}>{incomingCount}</AppText>
            </View>
          ) : (
            <Icon name="chevR" size={18} color={palette.tertiary} />
          )}
        </PressableScale>

        {/* Chat list — real threads only */}
        {chats.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="msg" size={28} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              {threadsFailed ? 'Söhbətlər yüklənmədi' : 'Hələ söhbət yoxdur'}
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 260, lineHeight: 21 }}>
              {threadsFailed
                ? 'Söhbətləri gətirmək alınmadı — neçəsi olduğunu bilmirik. İnternet qayıdanda yenidən aç.'
                : 'Yoldaşa məşq təklif et və ya müəllimə yaz — söhbət qarşı tərəf qəbul edəndə burada açılacaq.'}
            </AppText>
          </View>
        ) : (
          <View style={{ marginTop: 6 }}>
            {chats.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <View style={styles.sep} /> : null}
                <ChatRow chat={c} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })} />
              </View>
            ))}
          </View>
        )}

        <View style={styles.note}>
          <Icon name="shield" size={15} color={palette.caption} />
          <AppText variant="caption" color={palette.caption} style={{ flex: 1, lineHeight: 17 }}>
            Naməlum adamdan gələn mesaj birbaşa buraya düşmür — əvvəlcə «Sorğular»a gedir.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

function ChatRow({ chat, onPress }: { chat: Row; onPress: () => void }) {
  return (
    <PressableScale activeScale={0.99} haptic={false} onPress={onPress} style={styles.row}>
      <Avatar name={chat.name} size={52} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTop}>
          <AppText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {chat.name}
          </AppText>
          <View style={chat.kind === 'partner' ? styles.partnerTag : styles.trainerTag}>
            <AppText style={{ fontSize: 9.5, fontWeight: '700', color: chat.kind === 'partner' ? palette.voltText : palette.textSecondary }}>
              {chat.kind === 'partner' ? 'YOLDAŞ' : 'MÜƏLLİM'}
            </AppText>
          </View>
          <AppText variant="caption" color={palette.tertiary} style={{ marginLeft: 'auto' }}>
            {chat.time}
          </AppText>
        </View>
        <AppText variant="footnote" color={palette.caption} numberOfLines={1} style={{ marginTop: 5 }}>
          {chat.last}
        </AppText>
      </View>
      {chat.unread ? <View style={styles.unread} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 40 },
  requests: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14, marginBottom: 8 },
  reqIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,107,53,0.14)', alignItems: 'center', justifyContent: 'center' },
  reqBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: palette.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator, marginLeft: 64 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  partnerTag: { backgroundColor: 'rgba(198,255,61,0.35)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  trainerTag: { backgroundColor: palette.grouped, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  unread: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.blue },
  empty: { alignItems: 'center', paddingVertical: 40 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 18, paddingHorizontal: 4 },
});
