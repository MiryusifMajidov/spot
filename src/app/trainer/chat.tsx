import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { LargeHeader } from '@/components/ui/LargeHeader';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getMyThreads, type ThreadSummary } from '@/lib/chat';
import { hasSupabaseConfig } from '@/lib/supabase';
import { timeAgoAz } from '@/store/db';
import { palette, spacing } from '@/theme';
import { useMyStudents } from './students';

/**
 * The trainer's inbox — only the people who are actually their students.
 * No demo conversations, no invented last messages: a student with no messages
 * yet simply shows "Hələ mesaj yoxdur".
 */
export default function TrainerChat() {
  const router = useRouter();
  const { active, loading, offline, failed, reload } = useMyStudents();

  /* The previews come from the SERVER, not from `useDb.threads`.
     That store is the pre-schema42 local chat engine: it only ever held
     messages this device had typed, so a trainer read «Hələ mesaj yoxdur»
     beside every student who had actually written to them. The messages were
     there the whole time — one screen further in, `chat/[id]` reads the real
     table — but the inbox that decides whether the trainer opens it at all was
     looking at the wrong place. */
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [threadsFailed, setThreadsFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig) return;
      let alive = true;
      getMyThreads()
        .then((t) => alive && (setThreads(t), setThreadsFailed(false)))
        // A failed read must not paint every student as «no messages» — it is
        // reported instead, the same rule the student list already follows.
        .catch(() => alive && setThreadsFailed(true));
      return () => {
        alive = false;
      };
    }, [])
  );

  const rows = useMemo(() => {
    const byProfile = new Map((threads ?? []).map((t) => [t.otherProfileId, t]));
    return active
      .map((s) => {
        const t = byProfile.get(s.profileId);
        return {
          id: s.profileId,
          name: s.name,
          last: t?.lastBody ?? null,
          at: t?.lastAt ?? null,
          unread: t?.unread ?? 0,
        };
      })
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  }, [active, threads]);

  return (
    <Screen edges={['top']}>
      <LargeHeader title="Söhbət" subtitle="Şagirdlərinlə yazışma" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 28 }}>
        {offline ? (
          <Notice title="Server bağlantısı yoxdur" body="Şagird siyahın serverdən gəlir. Bağlantı qurulanda söhbətlər burada görünəcək." />
        ) : loading && rows.length === 0 ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator color={palette.tertiary} />
          </View>
        ) : failed ? (
          <Notice title="Yüklənmədi" body="Şagird siyahısını gətirmək alınmadı." action={{ label: 'Yenidən cəhd et', onPress: reload }} />
        ) : threadsFailed ? (
          <Notice
            title="Mesajlar yüklənmədi"
            body="Şagirdlərin siyahısı gəldi, amma yazışmalar gəlmədi — bu, mesaj olmadığı demək deyil."
            action={{ label: 'Yenidən cəhd et', onPress: reload }}
          />
        ) : rows.length === 0 ? (
          <Notice
            title="Hələ söhbət yoxdur"
            body="Sorğu göndərən bir istifadəçini qəbul edəndən sonra onunla söhbət burada açılır."
            action={{ label: 'Şagirdlərə bax', onPress: () => router.push('/trainer/students') }}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((r) => (
              <PressableScale
                key={r.id}
                activeScale={0.99}
                accessibilityRole="button"
                accessibilityLabel={`${r.name} ilə söhbət`}
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: r.id } })}
                style={styles.row}>
                <Avatar name={r.name} size={52} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <AppText variant="headline" numberOfLines={1} style={{ flex: 1 }}>
                      {r.name}
                    </AppText>
                    {r.unread > 0 ? (
                      <View style={styles.unread}>
                        <AppText style={{ fontSize: 11, fontWeight: '700', color: palette.inkText }}>{r.unread}</AppText>
                      </View>
                    ) : null}
                    {r.at ? (
                      <AppText variant="caption" color={palette.tertiary}>
                        {timeAgoAz(r.at)}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText
                    variant="subhead"
                    color={r.unread > 0 ? palette.inkText : r.last ? palette.textSecondary : palette.tertiary}
                    numberOfLines={1}
                    style={{ marginTop: 3, fontWeight: r.unread > 0 ? '600' : '400' }}>
                    {r.last ?? 'Hələ mesaj yoxdur — ilk mesajı yaz'}
                  </AppText>
                </View>
              </PressableScale>
            ))}
          </View>
        )}

        {/* «Mesajlar bu cihazda saxlanılır» stopped being true at schema42 —
            messages live in public.messages with RLS and Realtime. Telling a
            trainer their students' messages are device-only would make them
            distrust a channel that works. */}
      </ScrollView>
    </Screen>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.notice}>
      <AppText style={{ fontSize: 15, fontWeight: '600', marginBottom: 6 }}>{title}</AppText>
      <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.textSecondary }}>{body}</AppText>
      {action ? (
        <PressableScale
          activeScale={0.97}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={styles.actionBtn}>
          <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{action.label}</AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 12 },
  unread: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: palette.volt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notice: { backgroundColor: palette.white, borderRadius: 16, padding: 16 },
  actionBtn: { height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center', marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18 },
});
