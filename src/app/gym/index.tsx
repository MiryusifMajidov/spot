import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconName } from '@/components/Icon';
import { PlaceholderImage } from '@/components/PlaceholderImage';
import { SpotMap } from '@/components/SpotMap';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { showAccountSwitcher } from '@/lib/accounts';
import {
  EmptyNote,
  GymGate,
  getGymRoster,
  getMyGymClaim,
  postGymAnnouncement,
  useMyGym,
  type GymClaimRow,
} from '@/lib/gymOwner';
import { getGymDayPasses, getGymOccupancy } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { useKeyboardOverlap } from '@/lib/useKeyboardOverlap';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** Hours drawn on the occupancy chart (the ones a gym is realistically open). */
const FROM_HOUR = 6;
const TO_HOUR = 23;

interface PanelData {
  members: number;
  now: number;
  today: number;
  byHour: number[];
  // Day-pass registrations are a count only. SPOT takes no money and shows no
  // money total anywhere — a summed price is an earnings figure and is banned.
  passes: { count: number };
}

const EMPTY: PanelData = { members: 0, now: 0, today: 0, byHour: new Array(24).fill(0), passes: { count: 0 } };

/** Cover photo + map pin — read straight off the gym row (not part of OwnedGym). */
interface GymMedia {
  cover: string | null;
  lat: number | null;
  lng: number | null;
}

const NO_MEDIA: GymMedia = { cover: null, lat: null, lng: null };

/** Which panel sources failed to load. A failure is NEVER drawn as a zero. */
interface PanelErrors {
  roster: boolean;
  occupancy: boolean;
  passes: boolean;
  location: boolean;
}

const NO_ERRORS: PanelErrors = { roster: false, occupancy: false, passes: false, location: false };

/** Resolve a promise into a result we can tell apart from an empty answer. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await p };
  } catch {
    return { ok: false };
  }
}

export default function GymPanel() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Android edge-to-edge does not resize the window, so the announcement sheet
  // has to lift itself clear of the IME by the measured overlap.
  const kb = useKeyboardOverlap();
  const state = useMyGym();
  const gym = state.gym;

  const [data, setData] = useState<PanelData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const [sending, setSending] = useState(false);
  const [media, setMedia] = useState<GymMedia>(NO_MEDIA);
  const [errors, setErrors] = useState<PanelErrors>(NO_ERRORS);
  const [claim, setClaim] = useState<GymClaimRow | null>(null);
  /** false = we could not read the ownership claim, so we assert nothing about it. */
  const [claimKnown, setClaimKnown] = useState(false);

  const load = useCallback(async (gymId: string) => {
    const [roster, occ, passes, claimRow] = await Promise.all([
      settle(getGymRoster(gymId)),
      settle(getGymOccupancy(gymId)),
      settle(getGymDayPasses(gymId)),
      settle(getMyGymClaim(gymId)),
    ]);
    // A failed query is reported as a failure below — never as 0 members, 0
    // check-ins or "bugün check-in yoxdur".
    setData({
      members: roster.ok ? roster.value.length : 0,
      now: occ.ok ? occ.value.now : 0,
      today: occ.ok ? occ.value.today : 0,
      byHour: occ.ok ? occ.value.byHour : new Array(24).fill(0),
      passes: passes.ok ? { count: passes.value.count } : { count: 0 },
    });
    setClaim(claimRow.ok ? claimRow.value : null);
    setClaimKnown(claimRow.ok);

    // Cover and coordinates are read separately: `lat`/`lng` arrive with a later
    // migration, and a missing column must not cost us the cover photo as well.
    const base = await supabase.from('gyms').select('image_url').eq('id', gymId).maybeSingle();
    const geo = await supabase.from('gyms').select('lat, lng').eq('id', gymId).maybeSingle();
    const g = (geo.error ? null : (geo.data as { lat?: number | null; lng?: number | null } | null)) ?? null;
    setMedia({
      cover: ((base.data as { image_url?: string | null } | null)?.image_url as string) ?? null,
      lat: g?.lat != null ? Number(g.lat) : null,
      lng: g?.lng != null ? Number(g.lng) : null,
    });
    setErrors({ roster: !roster.ok, occupancy: !occ.ok, passes: !passes.ok, location: !!geo.error });
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (gym) load(gym.id);
  }, [gym, load]);

  const refresh = async () => {
    if (!gym) return;
    setRefreshing(true);
    state.reload();
    await load(gym.id);
    setRefreshing(false);
  };

  const sendAnnouncement = async () => {
    const body = announceText.trim();
    if (!gym || !body || sending) return;
    setSending(true);
    try {
      await postGymAnnouncement(gym.name, body);
      setAnnounce(false);
      setAnnounceText('');
      toast('Elan icmaya göndərildi');
    } catch {
      toast('Elan göndərilmədi — bağlantını yoxla', 'error');
    }
    setSending(false);
  };

  if (!gym) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.grouped, paddingTop: insets.top }}>
        <GymGate state={state} />
      </View>
    );
  }

  const slice = data.byHour.slice(FROM_HOUR, TO_HOUR + 1);
  const peak = Math.max(...slice);
  const peakHour = peak > 0 ? slice.indexOf(peak) + FROM_HOUR : null;
  const hasToday = data.today > 0;

  // The gym row can be flagged `pending` the moment it is registered, so it is
  // not proof that the owner ever sent a VÖEN. Only a claim row that really
  // carries one is an application; anything else still needs to be submitted,
  // and if we could not read the claim we promise nothing about it.
  const claimRow = !claimKnown
    ? { title: 'Sahiblik təsdiqi', sub: 'Müraciətinin statusuna bax' }
    : claim?.status === 'pending' && claim.voen
      ? { title: 'Sahiblik təsdiqi gözlənilir', sub: 'Müraciətinə bax' }
      : claim?.status === 'rejected'
        ? { title: 'Müraciət qəbul olunmadı', sub: 'Səbəbə bax və yenidən göndər' }
        : { title: 'Sahibliyi təsdiqlə', sub: 'VÖEN göndər · idarəni öz əlinə al' };

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.tertiary} />}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: spacing.screen, paddingBottom: 24 }}>
        {/* The gym's own cover photo — a placeholder until the owner uploads one. */}
        <PressableScale activeScale={0.98} onPress={() => router.push('/gym/edit')} style={styles.coverWrap}>
          {media.cover ? (
            <Image source={{ uri: media.cover }} style={styles.cover} contentFit="cover" transition={140} />
          ) : (
            <>
              <PlaceholderImage height={148} icon="cam" style={styles.cover} />
              <View style={styles.coverBadge}>
                <Icon name="plus" size={13} color={palette.white} />
                <AppText style={{ color: palette.white, fontSize: 12, fontWeight: '600' }}>Zalın şəklini əlavə et</AppText>
              </View>
            </>
          )}
        </PressableScale>

        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <AppText variant="caption" color={palette.tertiary}>
              Zal paneli · admin
            </AppText>
            <AppText variant="largeTitle" numberOfLines={2} style={{ marginTop: 4 }}>
              {gym.name}
            </AppText>
            {gym.district ? (
              <AppText variant="caption" color={palette.tertiary} style={{ marginTop: 4 }}>
                {gym.district}
              </AppText>
            ) : null}
          </View>
          <PressableScale activeScale={0.94} onPress={() => showAccountSwitcher(router)} style={styles.modePill}>
            <Icon name="user" size={13} color={palette.volt} />
            <AppText style={{ color: palette.white, fontSize: 12, fontWeight: '600' }}>Hesabı dəyiş</AppText>
          </PressableScale>
        </View>

        <View style={styles.statRow}>
          <View style={[styles.statCard, { backgroundColor: palette.ink }]}>
            <AppText style={styles.statCapVolt}>İNDİ ZALDA</AppText>
            <AppText style={styles.statBigDark}>{errors.occupancy || !loaded ? '—' : data.now}</AppText>
            <AppText style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 6 }}>
              {errors.occupancy
                ? 'check-in məlumatı yüklənmədi'
                : !loaded
                  ? 'yüklənir…'
                  : hasToday
                    ? `bugün ${data.today} check-in`
                    : 'bugün check-in yoxdur'}
            </AppText>
          </View>
          <View style={[styles.statCard, { backgroundColor: palette.white }]}>
            <AppText style={styles.statCap}>ÜZVLƏR</AppText>
            <AppText style={styles.statBig}>{errors.roster || !loaded ? '—' : data.members}</AppText>
            <AppText style={{ color: palette.tertiary, fontSize: 11, marginTop: 6 }}>
              {errors.roster ? 'üzv siyahısı yüklənmədi' : !loaded ? 'yüklənir…' : 'SPOT-da bu zalı seçib'}
            </AppText>
          </View>
        </View>

        {/* Occupancy — drawn only from today's real check-ins */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <AppText variant="headline">Saat üzrə doluluq</AppText>
            <AppText variant="caption" color={palette.tertiary}>
              bugün
            </AppText>
          </View>
          {errors.occupancy ? (
            <EmptyNote
              inset
              title="Doluluq yüklənmədi"
              body="Bu, «check-in yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və səhifəni aşağı çəkib yenilə."
            />
          ) : hasToday ? (
            <>
              <View style={styles.chart}>
                {slice.map((n, i) => (
                  <View
                    key={i}
                    style={[
                      styles.bar,
                      {
                        height: `${peak ? Math.max(6, Math.round((n / peak) * 100)) : 4}%`,
                        backgroundColor: n === peak && n > 0 ? palette.ink : n > 0 ? palette.volt : '#DCDCE1',
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.chartLabels}>
                {['06:00', '12:00', '18:00', '23:00'].map((l) => (
                  <AppText key={l} style={{ fontSize: 10.5, fontWeight: '500', color: '#A0A0A8' }}>
                    {l}
                  </AppText>
                ))}
              </View>
              {peakHour != null ? (
                <View style={styles.tip}>
                  <AppText style={{ fontSize: 12.5, lineHeight: 18, color: '#3F5500', fontWeight: '500' }}>
                    Ən sıx saat: {String(peakHour).padStart(2, '0')}:00 · {peak} check-in. Rəqəmlər yalnız bugünkü real
                    check-in-lərdən hesablanır.
                  </AppText>
                </View>
              ) : null}
            </>
          ) : (
            <EmptyNote
              inset
              title={loaded ? 'Bugün hələ check-in yoxdur' : 'Yüklənir…'}
              body={
                loaded
                  ? 'Doluluq üzv öz telefonundan SPOT-un «Check-in» ekranından check-in edəndə dolur. Zal kodu check-in-i işə salmır — SPOT-da zalını seçən üzvlərə check-in etməyi xatırlat.'
                  : 'Bugünkü check-in-lər oxunur.'
              }
            />
          )}
        </View>

        {/* Day-pass — informational only. SPOT charges nothing and holds no money. */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <AppText variant="headline">Day-pass</AppText>
            <AppText variant="caption" color={palette.tertiary}>
              ümumi qeydiyyat
            </AppText>
          </View>
          {errors.passes ? (
            <EmptyNote
              inset
              title="Day-pass məlumatı yüklənmədi"
              body="Bu, «day-pass yoxdur» demək deyil — sorğu alınmadı. Bağlantını yoxla və səhifəni aşağı çəkib yenilə."
            />
          ) : data.passes.count > 0 ? (
            <View style={{ gap: 10 }}>
              <Row label="Qeydə alınan day-pass" value={`${data.passes.count}`} />
              <View style={styles.divider} />
              <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.tertiary }}>
                SPOT ödəniş qəbul etmir və komissiya tutmur — pul zalda ödənilir. Ona görə burada yalnız qeydiyyat
                sayı göstərilir.
              </AppText>
            </View>
          ) : (
            <EmptyNote
              inset
              title={loaded ? 'Hələ day-pass qeydə alınmayıb' : 'Yüklənir…'}
              body={
                loaded
                  ? 'Üzv olmayan biri zalını day-pass ilə seçəndə burada görünəcək. SPOT ödəniş qəbul etmir — pul zalda ödənilir.'
                  : 'Day-pass qeydiyyatı oxunur.'
              }
            />
          )}
        </View>

        {/* Where customers find this gym on the map */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <AppText variant="headline">Zalın yeri</AppText>
            <PressableScale activeScale={0.94} onPress={() => router.push('/gym/edit')}>
              <AppText style={{ fontSize: 13.5, fontWeight: '600', color: palette.blue }}>Yeri dəyiş</AppText>
            </PressableScale>
          </View>
          {errors.location ? (
            <EmptyNote
              inset
              title="Zalın yeri oxuna bilmədi"
              body="Koordinatlar bazadan gəlmədi — pin qoyulub-qoyulmadığını deyə bilmirik. Bağlantını yoxla və səhifəni aşağı çəkib yenilə."
            />
          ) : media.lat != null && media.lng != null ? (
            <>
              <SpotMap
                markers={[{ id: gym.id, lat: media.lat, lng: media.lng, title: gym.name, subtitle: gym.district || undefined, active: true }]}
                center={{ lat: media.lat, lng: media.lng }}
                zoom={16}
                style={styles.map}
              />
              <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.tertiary, marginTop: 10 }}>
                Müştərilər zalı xəritədə məhz bu nöqtədə görür.
              </AppText>
            </>
          ) : (
            <EmptyNote
              inset
              title={loaded ? 'Zalın yeri xəritədə qeyd olunmayıb' : 'Yüklənir…'}
              body={
                loaded
                  ? 'Koordinat olmadan zal müştəri xəritəsində görünmür. «Yeri dəyiş» ilə pini zalın üstünə qoy.'
                  : 'Zalın koordinatları oxunur.'
              }
            />
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <QuickCard icon="qr" title="Zal kodu" sub="Kodu göstər" onPress={() => router.push('/gym/qr')} />
          <QuickCard icon="bell" title="Elan" sub="İcmaya yaz" onPress={() => setAnnounce(true)} />
          <QuickCard icon="edit" title="Profil" sub="Redaktə et" onPress={() => router.push('/gym/edit')} />
        </View>

        {gym.claimStatus === 'claimed' ? (
          <View style={[styles.card, styles.claimRow, { marginTop: 14 }]}>
            <Icon name="verified" size={20} color={palette.voltDeep} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 14, fontWeight: '600' }}>Sahiblik təsdiqlənib</AppText>
              <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 3 }}>
                Zalın idarəsi tam səndədir
              </AppText>
            </View>
          </View>
        ) : (
          <PressableScale
            activeScale={0.98}
            onPress={() => router.push('/gym/claim')}
            style={[styles.card, styles.claimRow, { marginTop: 14 }]}>
            <Icon name="shield" size={20} color={palette.voltDeep} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 14, fontWeight: '600' }}>{claimRow.title}</AppText>
              <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 3 }}>{claimRow.sub}</AppText>
            </View>
            <Icon name="chevR" size={18} color={palette.tertiary} />
          </PressableScale>
        )}

        {loaded && !errors.roster && !errors.occupancy && data.members === 0 && !hasToday ? (
          <View style={{ marginTop: 14 }}>
            <EmptyNote
              title="Panel hələ boşdur — bu normaldır"
              body="Bütün rəqəmlər real check-in və real üzvlərdən gəlir. Zal profilini tamamla — üzvlər SPOT-da zalını seçib öz telefonlarından check-in etdikcə panel özü dolacaq."
            />
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={announce} animationType="slide" transparent onRequestClose={() => setAnnounce(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: (kb > 0 ? kb : insets.bottom) + 16 }]}>
            <AppText variant="headline">Elan yaz</AppText>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 6 }}>
              Elan SPOT icma lentinə {gym.name} adından yerləşdirilir. Push bildiriş göndərilmir.
            </AppText>
            <TextInput
              value={announceText}
              onChangeText={setAnnounceText}
              multiline
              placeholder="Məs: Bazar günü zal 09:00–18:00 işləyir."
              placeholderTextColor={palette.caption}
              style={styles.input}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <View style={{ flex: 1 }}>
                <Button title="Ləğv et" variant="secondary" full onPress={() => setAnnounce(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title={sending ? 'Göndərilir…' : 'Göndər'}
                  variant="primary"
                  full
                  disabled={!announceText.trim() || sending}
                  onPress={sendAnnouncement}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.breakdownRow}>
      <AppText style={{ fontSize: 13.5, color: palette.textSecondary }}>{label}</AppText>
      <AppText style={{ fontSize: 13.5, fontWeight: '600', color: palette.inkText }}>{value}</AppText>
    </View>
  );
}

function QuickCard({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <PressableScale activeScale={0.96} onPress={onPress} style={styles.quick}>
      <Icon name={icon} size={19} color={palette.textSecondary} />
      <AppText style={{ fontSize: 13.5, fontWeight: '600', marginTop: 9 }}>{title}</AppText>
      <AppText style={{ fontSize: 11.5, color: palette.tertiary, marginTop: 3 }}>{sub}</AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  coverWrap: { borderRadius: 18, overflow: 'hidden', backgroundColor: palette.grouped, marginBottom: 14 },
  cover: { width: '100%', height: 148 },
  coverBadge: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(11,11,14,0.72)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  map: { height: 170, borderRadius: 14 },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.ink, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, marginTop: 6 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: { flex: 1, borderRadius: 18, padding: 15 },
  statCap: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: palette.tertiary },
  statCapVolt: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: palette.volt },
  statBig: { fontSize: 26, fontWeight: '700', marginTop: 9, letterSpacing: -0.7 },
  statBigDark: { color: palette.white, fontSize: 26, fontWeight: '700', marginTop: 9, letterSpacing: -0.7 },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 78 },
  bar: { flex: 1, borderRadius: 3 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  tip: { backgroundColor: 'rgba(198,255,61,0.18)', borderRadius: 12, padding: 12, marginTop: 13 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.12)' },
  quick: { flex: 1, backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalBg: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.grouped, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  input: { backgroundColor: palette.white, borderRadius: 14, padding: 14, fontSize: 15, color: palette.inkText, minHeight: 110, textAlignVertical: 'top', marginTop: 14, borderWidth: 1, borderColor: palette.separator },
});
