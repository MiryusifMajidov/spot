import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { tapFeedback } from '@/lib/feedback';
import {
  getNotifications,
  markRead,
  notifText,
  notifTarget,
  type NotifRow,
  type NotifType,
} from '@/lib/notifications';
import { hasSupabaseConfig } from '@/lib/supabase';
import { timeAgoAz } from '@/store/db';
import { openComments } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** loading → the read is in flight; ready → the list IS the truth;
 *  failed → we could not ask, which is not the same as «bildiriş yoxdur». */
type State = 'loading' | 'ready' | 'failed';

/* Every type the DATABASE can write, not just the ones this screen was first
   built for. The map used to hold eight keys while the table accepted twelve,
   and the row renderer read `.name` straight off the lookup — so the first
   `message`, `video_like`, `post_like` or `follow` row crashed the inbox for
   everyone who had one. A missing key now falls back instead of throwing. */
const FALLBACK_ICON = { name: 'bell' as IconName, tint: palette.tertiary };

const ICON: Record<NotifType, { name: IconName; tint: string }> = {
  comment_like: { name: 'heart', tint: palette.red },
  comment_reply: { name: 'msg', tint: palette.blue },
  mention: { name: 'msg', tint: palette.voltDeep },
  match_request: { name: 'users', tint: palette.blue },
  match_accepted: { name: 'check', tint: palette.voltDeep },
  trainer_request: { name: 'users', tint: palette.blue },
  trainer_decided: { name: 'check', tint: palette.voltDeep },
  review_reply: { name: 'star', tint: palette.voltDeep },
  message: { name: 'msg', tint: palette.blue },
  video_like: { name: 'heart', tint: palette.red },
  post_like: { name: 'heart', tint: palette.red },
  follow: { name: 'users', tint: palette.voltDeep },
};

export default function Notifications() {
  const router = useRouter();
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [state, setState] = useState<State>('loading');

  const load = useCallback(() => {
    if (!hasSupabaseConfig) {
      setState('failed');
      return;
    }
    setState('loading');
    getNotifications()
      .then((r) => {
        setRows(r);
        setState('ready');
      })
      .catch(() => setState('failed'));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (n: NotifRow) => {
    tapFeedback();
    // Mark read optimistically ONLY in the list; if the write fails the next
    // load brings the dot back, which is the truthful outcome.
    void markRead(n.id).catch(() => {});
    setRows((rs) => rs.map((r) => (r.id === n.id ? { ...r, read: true } : r)));
    const t = notifTarget(n);
    if (!t) return;
    if (t.kind === 'comments') openComments(t.key);
    else if (t.kind === 'chat') router.push({ pathname: '/chat/[id]', params: { id: t.profileId } });
    else if (t.kind === 'profile') router.push({ pathname: '/(tabs)/discover/partner/[id]', params: { id: t.profileId } });
    else router.push('/chat/requests');
  };

  const unread = rows.filter((r) => !r.read).length;

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar
        title="Bildirişlər"
        right={
          unread > 0 ? (
            <PressableScale
              onPress={() => {
                tapFeedback();
                void markRead().catch(() => {});
                setRows((rs) => rs.map((r) => ({ ...r, read: true })));
              }}
            >
              <AppText variant="footnote" color={palette.blue}>Hamısını oxu</AppText>
            </PressableScale>
          ) : undefined
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {state === 'loading' ? (
          <AppText variant="body" color={palette.textSecondary} style={styles.note}>
            Yüklənir…
          </AppText>
        ) : state === 'failed' ? (
          /* A failed read is not an empty inbox. */
          <View style={styles.empty}>
            <Icon name="shield" size={26} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>Yüklənmədi</AppText>
            <AppText variant="body" color={palette.textSecondary} center style={styles.emptySub}>
              Bildirişləri gətirmək alınmadı — neçəsi olduğunu bilmirik.
            </AppText>
            <PressableScale onPress={load} style={styles.retry}>
              <AppText variant="callout" color={palette.white}>Yenidən cəhd et</AppText>
            </PressableScale>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="bell" size={26} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>Hələ bildiriş yoxdur</AppText>
            <AppText variant="body" color={palette.textSecondary} center style={styles.emptySub}>
              Kimsə şərhini bəyənəndə, sənə təklif göndərəndə və ya səni etiketləyəndə burada görünəcək.
            </AppText>
          </View>
        ) : (
          rows.map((n) => {
            const ic = ICON[n.type] ?? FALLBACK_ICON;
            return (
              <PressableScale key={n.id} activeScale={0.98} onPress={() => open(n)}>
                <View style={[styles.row, !n.read && styles.rowUnread]}>
                  <Avatar name={n.actorName ?? '?'} size={40} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="callout" style={{ lineHeight: 20 }}>{notifText(n)}</AppText>
                    <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
                      {timeAgoAz(n.createdAt)}
                    </AppText>
                  </View>
                  <Icon name={ic.name} size={16} color={ic.tint} />
                  {!n.read ? <View style={styles.dot} /> : null}
                </View>
              </PressableScale>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingBottom: 24 },
  note: { textAlign: 'center', marginTop: 40 },
  empty: { alignItems: 'center', marginTop: 70, paddingHorizontal: 20 },
  emptySub: { marginTop: 6, lineHeight: 21, maxWidth: 300 },
  retry: { marginTop: 16, backgroundColor: palette.inkText, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: palette.white, borderRadius: 16, padding: 13, marginTop: 10,
  },
  rowUnread: { backgroundColor: 'rgba(198,255,61,0.14)' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.voltDeep },
});
