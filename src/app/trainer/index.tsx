import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { PressableScale } from '@/components/ui/PressableScale';
import { showAccountSwitcher } from '@/lib/accounts';
import { decideTrainerRequest, getMyListing, setMyListed, type StudentRow } from '@/lib/roles';
import { useAppStore } from '@/store/appStore';
import { gymById } from '@/store/db';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { useMyStudents } from './students';

/** The trainer panel shows only REAL data. SPOT takes no payments, so there is
 *  no income dashboard — a trainer's value here is the students who asked for
 *  them and the programs they assign. */
export default function TrainerPanel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const name = useAppStore((s) => s.profile.name) || 'Müəllim';
  const specialty = useAppStore((s) => s.profile.specialty);

  // One source of truth for the student list — the same hook the Şagirdlər
  // screen uses, so a failed fetch is a failure here too and never a "0".
  const { pending, active, loading, failed, offline, reload } = useMyStudents();
  const [busy, setBusy] = useState<string | null>(null);

  // Counts may only be printed when they really came back from the server. A
  // refresh on re-focus keeps the last numbers we actually obtained; a failure
  // or a missing server takes them away again.
  const [everLoaded, setEverLoaded] = useState(false);
  /* null = we could not read it. Never drawn as «gizli», which would tell a
     visible coach they are hidden. */
  const [listed, setListed] = useState<boolean | null>(null);
  const [listedBusy, setListedBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await getMyListing();
        if (alive) setListed(r ? r.listed : null);
      } catch {
        if (alive) setListed(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!loading && !failed && !offline) setEverLoaded(true);
  }, [loading, failed, offline]);
  const counted = !failed && !offline && (!loading || everLoaded);
  const hasRows = pending.length > 0 || active.length > 0;

  const decide = async (r: StudentRow, accept: boolean) => {
    if (busy) return;
    setBusy(r.requestId);
    try {
      await decideTrainerRequest(r.requestId, accept);
      toast(accept ? `${r.name} artıq şagirdindir` : 'Sorğu rədd edildi');
      reload();
    } catch {
      toast('Alınmadı — internet bağlantısını yoxla', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 28 }}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color={palette.tertiary}>
              Müəllim hesabı
            </AppText>
            <AppText variant="largeTitle" style={{ marginTop: 4 }} numberOfLines={1}>
              {name.split(' ')[0]}
            </AppText>
          </View>
          <PressableScale activeScale={0.94} onPress={() => showAccountSwitcher(router)} style={styles.modePill}>
            <Icon name="user" size={13} color={palette.volt} />
            <AppText style={{ color: palette.white, fontSize: 12, fontWeight: '600' }}>Hesabı dəyiş</AppText>
          </PressableScale>
        </View>

        {/* Real counters — no invented money, no invented students. A number is
            printed only when the server actually answered. */}
        <View style={styles.statRow}>
          <PressableScale activeScale={0.98} onPress={() => router.push('/trainer/students')} style={[styles.statCard, { backgroundColor: palette.ink }]}>
            <AppText style={styles.statCapVolt}>ŞAGİRD</AppText>
            <AppText style={{ color: palette.white, fontSize: 24, fontWeight: '700', marginTop: 9, letterSpacing: -0.5 }}>{counted ? active.length : '—'}</AppText>
            <AppText style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 6 }}>
              {loading && !everLoaded ? 'yüklənir…' : !counted ? 'məlum deyil' : active.length === 0 ? 'hələ yoxdur' : 'aktiv'}
            </AppText>
          </PressableScale>
          <PressableScale activeScale={0.98} onPress={() => router.push('/trainer/students')} style={[styles.statCard, { backgroundColor: palette.white }]}>
            <AppText style={styles.statCap}>YENİ SORĞU</AppText>
            <AppText style={{ fontSize: 24, fontWeight: '700', marginTop: 9, letterSpacing: -0.5, color: counted && pending.length ? palette.streak : palette.inkText }}>
              {counted ? pending.length : '—'}
            </AppText>
            <AppText style={{ color: palette.tertiary, fontSize: 11, marginTop: 6 }}>
              {loading && !everLoaded ? 'yüklənir…' : !counted ? 'məlum deyil' : pending.length ? 'cavab gözləyir' : 'gözləyən yoxdur'}
            </AppText>
          </PressableScale>
        </View>

        {/* A failed or impossible fetch is stated as such — never drawn as "0" */}
        {offline ? (
          <PanelNotice
            title="Server bağlantısı yoxdur"
            body="Şagird sorğuları serverdən gəlir. Bağlantı qurulanda sorğuların və şagirdlərin burada görünəcək."
          />
        ) : failed ? (
          <PanelNotice
            title={hasRows ? 'Siyahı yenilənmədi' : 'Yüklənmədi'}
            body={
              hasRows
                ? 'Aşağıdakılar son uğurlu yükləmədən qalıb — indi serverdən yeni məlumat gəlmədi.'
                : 'Şagird siyahısını gətirmək alınmadı. Neçə sorğun olduğunu bilmirik.'
            }
            action={{ label: 'Yenidən cəhd et', onPress: reload }}
          />
        ) : null}

        {/* Pending requests — the one genuinely actionable thing */}
        {pending.length > 0 ? (
          <View style={styles.card}>
            <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 13 }}>
              SƏNİNLƏ MƏŞQ ETMƏK İSTƏYİRLƏR
            </AppText>
            <View style={{ gap: 14 }}>
              {pending.map((r) => (
                <View key={r.requestId} style={styles.reqRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <Avatar name={r.name} size={40} />
                    <View style={{ flex: 1 }}>
                      <AppText style={{ fontSize: 15, fontWeight: '600' }}>{r.name}{r.age ? `, ${r.age}` : ''}</AppText>
                      <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 3 }}>
                        {[r.level, r.homeGymId ? gymById(r.homeGymId)?.name : null, r.preferredTime].filter(Boolean).join(' · ') || 'Profil məlumatı yoxdur'}
                      </AppText>
                    </View>
                  </View>
                  {r.note ? (
                    <AppText style={{ fontSize: 13, lineHeight: 19, color: palette.text3, marginTop: 10 }}>{r.note}</AppText>
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
                    <PressableScale activeScale={0.97} onPress={() => decide(r, false)} style={styles.declineBtn}>
                      <AppText style={{ fontSize: 13.5, fontWeight: '600', color: palette.textSecondary }}>Rədd et</AppText>
                    </PressableScale>
                    <PressableScale activeScale={0.97} onPress={() => decide(r, true)} style={styles.acceptBtn}>
                      <AppText style={{ fontSize: 13.5, fontWeight: '700', color: palette.inkText }}>
                        {busy === r.requestId ? '…' : 'Qəbul et'}
                      </AppText>
                    </PressableScale>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Active students preview */}
        {active.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <AppText variant="headline">Şagirdlərin</AppText>
              <PressableScale haptic={false} activeScale={0.95} onPress={() => router.push('/trainer/students')}>
                <AppText variant="subhead" color={palette.blue}>Hamısı</AppText>
              </PressableScale>
            </View>
            <View style={{ gap: 12 }}>
              {active.slice(0, 3).map((s) => (
                <PressableScale
                  key={s.requestId}
                  activeScale={0.98}
                  onPress={() => router.push({ pathname: '/trainer/student/[id]', params: { id: s.profileId, name: s.name } })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <Avatar name={s.name} size={38} />
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{s.name}</AppText>
                    <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 3 }}>
                      {s.programTitle ? s.programTitle : 'Proqram təyin edilməyib'}
                    </AppText>
                  </View>
                  <Icon name="chevR" size={18} color={palette.tertiary} />
                </PressableScale>
              ))}
            </View>
          </View>
        ) : null}

        {/* Honest empty state for a brand-new trainer — only when we really know */}
        {counted && !hasRows ? (
          <View style={[styles.card, { alignItems: 'center', paddingVertical: 30 }]}>
            <View style={styles.emptyIcon}>
              <Icon name="users" size={26} color={palette.voltDeep} />
            </View>
            <AppText variant="headline" style={{ marginTop: 14 }}>Hələ şagirdin yoxdur</AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, lineHeight: 21, maxWidth: 290 }}>
              Profilin Kəşf → Müəllimlər bölməsində görünür. İstifadəçi səni tapıb sorğu göndərəndə burada görəcəksən.
            </AppText>
            <PressableScale
              activeScale={0.97}
              onPress={() => router.push('/(tabs)/profile/become-trainer')}
              style={styles.emptyBtn}>
              <Icon name="edit" size={15} color={palette.inkText} />
              <AppText style={{ fontSize: 14, fontWeight: '600' }}>Profilini gücləndir</AppText>
            </PressableScale>
          </View>
        ) : null}

        {/* Whether this coach is findable at all.
            `trainers.listed` starts false and nothing in the app ever set it, so
            every trainer who signed up was invisible in Kəşf → Müəllimlər for
            good while being told their profile was created. */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <AppText variant="headline">Kəşfdə görün</AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 4, lineHeight: 18 }}>
                {listed === null
                  ? 'Vəziyyət oxunmadı — bağlantını yoxla və səhifəni yenidən aç.'
                  : listed
                    ? 'Profilin Kəşf → Müəllimlər siyahısındadır. Şagirdlər səni tapa bilər.'
                    : 'Profilin hazırda gizlidir — Kəşfdə görünmürsən və heç kim sənə sorğu göndərə bilmir.'}
              </AppText>
            </View>
            <Switch
              value={!!listed}
              disabled={listed === null || listedBusy}
              onValueChange={(v) => {
                setListedBusy(true);
                setMyListed(v)
                  .then((got) => {
                    setListed(got);
                    toast(got ? 'Profilin Kəşfdə göründü' : 'Profilin Kəşfdən gizləndi');
                  })
                  .catch(() => toast('Dəyişiklik saxlanılmadı — yenidən cəhd et', 'error'))
                  .finally(() => setListedBusy(false));
              }}
              trackColor={{ true: palette.voltDeep, false: palette.separator }}
            />
          </View>
        </View>

        {/* What a trainer can actually do here */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 13 }}>
            ALƏTLƏRİN
          </AppText>
          <View style={{ gap: 13 }}>
            <ToolRow icon="dumbbell" title="Proqramlar" sub="Şagirdə təyin edə biləcəyin proqramlar" onPress={() => router.push('/trainer/programs')} />
            <ToolRow icon="msg" title="Söhbət" sub="Şagirdlərinlə yazış" onPress={() => router.push('/trainer/chat')} />
            <ToolRow icon="verified" title="Doğrulanma" sub="Mavi nişan üçün sənədlər" onPress={() => router.push('/trainer/verify')} />
          </View>
        </View>

        {/* Honest note about money */}
        <View style={styles.note}>
          <Icon name="shield" size={15} color={palette.tertiary} />
          <AppText style={{ fontSize: 12, lineHeight: 17.5, color: palette.textSecondary, flex: 1 }}>
            SPOT ödəniş qəbul etmir. Qiymətlər yalnız məlumat üçündür — şagirdlə haqqı özünüz razılaşdırırsınız.
            {specialty ? ` İxtisasın: ${specialty}.` : ''}
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

/** States a load failure as a fact instead of letting it look like an empty list. */
function PanelNotice({ title, body, action }: { title: string; body: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.card}>
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

function ToolRow({ icon, title, sub, onPress }: { icon: 'dumbbell' | 'msg' | 'verified'; title: string; sub: string; onPress: () => void }) {
  return (
    <PressableScale activeScale={0.98} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={styles.toolIcon}>
        <Icon name={icon} size={17} color={palette.inkText} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText style={{ fontSize: 14, fontWeight: '600' }}>{title}</AppText>
        <AppText style={{ fontSize: 11.5, color: palette.tertiary, marginTop: 3 }}>{sub}</AppText>
      </View>
      <Icon name="chevR" size={18} color={palette.tertiary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.ink, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, marginTop: 6 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statCard: { flex: 1, borderRadius: 18, padding: 15 },
  statCap: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: palette.tertiary },
  statCapVolt: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: palette.volt },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  reqRow: { backgroundColor: palette.grouped, borderRadius: 14, padding: 13 },
  acceptBtn: { flex: 1, height: 42, borderRadius: 12, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { flex: 1, height: 42, borderRadius: 12, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: 'rgba(198,255,61,0.28)', alignItems: 'center', justifyContent: 'center' },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18, height: 44, paddingHorizontal: 18, borderRadius: 13, backgroundColor: palette.grouped },
  noticeBtn: { height: 38, borderRadius: 11, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center', marginTop: 14, alignSelf: 'flex-start', paddingHorizontal: 18 },
  toolIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', paddingHorizontal: 4, marginTop: 2 },
});
