import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { LargeHeader } from '@/components/ui/LargeHeader';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { decideTrainerRequest, getMyStudents, type StudentRow } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import { timeAgoAz } from '@/store/db';
import { confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

export interface MyStudents {
  pending: StudentRow[];
  active: StudentRow[];
  loading: boolean;
  failed: boolean;
  offline: boolean;
  reload: () => void;
}

/**
 * The trainer's REAL students: people who asked to train with them (pending)
 * and the ones they accepted (active). Nothing is invented — when the server is
 * unreachable the screens say so instead of showing made-up rows.
 */
export function useMyStudents(): MyStudents {
  const [rows, setRows] = useState<{ pending: StudentRow[]; active: StudentRow[] }>({ pending: [], active: [] });
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig) {
        setLoading(false);
        return;
      }
      let alive = true;
      setLoading(true);
      getMyStudents()
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick])
  );

  return { ...rows, loading, failed, offline: !hasSupabaseConfig, reload };
}

export default function Students() {
  const router = useRouter();
  const { pending, active, loading, failed, offline, reload } = useMyStudents();
  const [tab, setTab] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const decide = (s: StudentRow, accept: boolean) => {
    const run = async () => {
      setBusy(s.requestId);
      try {
        await decideTrainerRequest(s.requestId, accept);
        toast(accept ? `${s.name} artıq şagirdindir` : 'Sorğu rədd edildi', accept ? 'success' : 'info');
        reload();
      } catch {
        toast('Sorğunu emal etmək alınmadı — internetini yoxla', 'error');
      } finally {
        setBusy(null);
      }
    };
    if (accept) {
      run();
      return;
    }
    confirm(`${s.name} sorğusunu rədd edəsən?`, 'Şagird yenidən sorğu göndərə bilər.', [
      { label: 'Ləğv et', style: 'cancel' },
      { label: 'Rədd et', style: 'destructive', onPress: run },
    ]);
  };

  // A count is a claim about the server. Print it only when the server answered.
  const counted = !loading && !failed && !offline;

  const openStudent = (s: StudentRow) =>
    router.push({ pathname: '/trainer/student/[id]', params: { id: s.profileId, name: s.name } });

  return (
    <Screen edges={['top']}>
      <LargeHeader title="Şagirdlər" subtitle="Sənə müraciət edən və qəbul etdiyin insanlar" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 28 }}>
        <View style={{ marginBottom: 14 }}>
          <Segmented
            options={[counted ? `Şagirdlər ${active.length}` : 'Şagirdlər', counted ? `Sorğular ${pending.length}` : 'Sorğular']}
            value={tab}
            onChange={setTab}
          />
        </View>

        {offline ? (
          <Notice
            title="Server bağlantısı yoxdur"
            body="Şagird sorğuları serverdən gəlir. Bağlantı qurulanda sorğular və şagirdlərin burada görünəcək."
          />
        ) : loading ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator color={palette.tertiary} />
          </View>
        ) : failed ? (
          <Notice title="Yüklənmədi" body="Şagird siyahısını gətirmək alınmadı." action={{ label: 'Yenidən cəhd et', onPress: reload }} />
        ) : tab === 0 ? (
          active.length === 0 ? (
            <Notice
              title="Hələ şagirdin yoxdur"
              body="İstifadəçilər səni Kəşf bölməsində tapıb sorğu göndərəndə sorğu «Sorğular» tabında görünəcək. Qəbul etdiyin insanlar burada olacaq."
            />
          ) : (
            <View style={{ gap: 11 }}>
              {active.map((s) => (
                <View key={s.requestId} style={styles.card}>
                  <PressableScale
                    activeScale={0.99}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name} şagird kartını aç`}
                    onPress={() => openStudent(s)}
                    style={styles.head}>
                    <Avatar name={s.name} size={48} />
                    <View style={{ flex: 1 }}>
                      <AppText style={{ fontSize: 15, fontWeight: '600' }}>
                        {s.name}
                        {s.age ? `, ${s.age}` : ''}
                      </AppText>
                      <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                        {[s.level, s.goals[0], `${timeAgoAz(s.since)} əvvəldən`].filter(Boolean).join(' · ')}
                      </AppText>
                    </View>
                    <Icon name="chevR" size={18} color={palette.tertiary} />
                  </PressableScale>

                  <View style={styles.programRow}>
                    <Icon name="dumbbell" size={15} color={s.programTitle ? palette.voltDeep : palette.tertiary} />
                    <AppText style={{ fontSize: 12.5, color: s.programTitle ? palette.text3 : palette.tertiary, flex: 1 }} numberOfLines={1}>
                      {s.programTitle ? s.programTitle : 'Proqram təyin edilməyib'}
                    </AppText>
                  </View>

                  <View style={styles.actions}>
                    <PressableScale
                      activeScale={0.97}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.name} üçün proqram təyin et`}
                      onPress={() => openStudent(s)}
                      style={styles.primaryBtn}>
                      <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>
                        {s.programTitle ? 'Proqramı yenilə' : 'Proqram təyin et'}
                      </AppText>
                    </PressableScale>
                    <PressableScale
                      activeScale={0.9}
                      accessibilityRole="button"
                      accessibilityLabel={`${s.name} ilə söhbət`}
                      hitSlop={8}
                      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: s.profileId } })}
                      style={styles.iconBtn}>
                      <Icon name="msg" size={18} color={palette.inkText} />
                    </PressableScale>
                  </View>
                </View>
              ))}
            </View>
          )
        ) : pending.length === 0 ? (
          <Notice
            title="Yeni sorğu yoxdur"
            body="Kimsə səninlə məşq etmək istəyəndə sorğusu — qeydi və uyğun vaxtı ilə birlikdə — burada görünəcək."
          />
        ) : (
          <View style={{ gap: 11 }}>
            {pending.map((s) => (
              <View key={s.requestId} style={styles.card}>
                <View style={styles.head}>
                  <Avatar name={s.name} size={48} />
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 15, fontWeight: '600' }}>
                      {s.name}
                      {s.age ? `, ${s.age}` : ''}
                    </AppText>
                    <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>
                      {[s.level, s.goals[0], timeAgoAz(s.since)].filter(Boolean).join(' · ')}
                    </AppText>
                  </View>
                </View>

                {s.note ? (
                  <AppText style={{ fontSize: 13.5, lineHeight: 19, color: palette.text3, marginTop: 12 }}>«{s.note}»</AppText>
                ) : null}
                {s.preferredTime ? (
                  <View style={styles.timeChip}>
                    <Icon name="clock" size={13} color={palette.textSecondary} />
                    <AppText style={{ fontSize: 12, color: palette.textSecondary }}>{s.preferredTime}</AppText>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <PressableScale
                    activeScale={0.97}
                    disabled={busy === s.requestId}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name} sorğusunu qəbul et`}
                    onPress={() => decide(s, true)}
                    style={[styles.primaryBtn, { backgroundColor: palette.volt }, busy === s.requestId && { opacity: 0.5 }]}>
                    <AppText style={{ color: palette.inkText, fontSize: 13, fontWeight: '600' }}>Qəbul et</AppText>
                  </PressableScale>
                  <PressableScale
                    activeScale={0.97}
                    disabled={busy === s.requestId}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name} sorğusunu rədd et`}
                    onPress={() => decide(s, false)}
                    style={styles.declineBtn}>
                    <AppText style={{ color: palette.textSecondary, fontSize: 13, fontWeight: '600' }}>İmtina</AppText>
                  </PressableScale>
                </View>
              </View>
            ))}
          </View>
        )}
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
          style={styles.noticeBtn}>
          <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{action.label}</AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  head: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  programRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, backgroundColor: palette.grouped, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.hairline },
  primaryBtn: { flex: 1, height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { flex: 1, height: 38, borderRadius: 11, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  notice: { backgroundColor: palette.white, borderRadius: 16, padding: 16 },
  noticeBtn: { height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center', marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18 },
});
