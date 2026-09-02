import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { LargeHeader } from '@/components/ui/LargeHeader';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { timeAgoAz, useDb } from '@/store/db';
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
  const threads = useDb((s) => s.threads);

  const rows = useMemo(() => {
    return active
      .map((s) => {
        const msgs = threads[s.profileId] ?? [];
        const last = msgs[msgs.length - 1];
        return { id: s.profileId, name: s.name, last: last?.text ?? null, at: last?.at ?? null };
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
                    {r.at ? (
                      <AppText variant="caption" color={palette.tertiary}>
                        {timeAgoAz(r.at)}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="subhead" color={r.last ? palette.textSecondary : palette.tertiary} numberOfLines={1} style={{ marginTop: 3 }}>
                    {r.last ?? 'Hələ mesaj yoxdur — ilk mesajı yaz'}
                  </AppText>
                </View>
              </PressableScale>
            ))}
          </View>
        )}

        {rows.length > 0 ? (
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.caption, marginTop: 16 }}>
            Mesajlar hazırda bu cihazda saxlanılır.
          </AppText>
        ) : null}
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
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notice: { backgroundColor: palette.white, borderRadius: 16, padding: 16 },
  actionBtn: { height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center', marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18 },
});
