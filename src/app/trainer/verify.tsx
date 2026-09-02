import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { Icon, IconName } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getMyProfile } from '@/lib/api';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { addTrainerCert, pickImage, shootImage, signedCertUrl } from '@/lib/images';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { actionSheet, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

interface VerificationRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  doc_id_url: string | null;
  doc_cert_url: string | null;
  intro_video_url: string | null;
  gym_confirm: boolean;
  reject_reason: string | null;
  sla_due_at: string | null;
  created_at: string;
}

const BENEFITS = [
  'Adının yanında mavi nişan görünür',
  'Proqramların «Doğrulanmış müəllim» kimi təqdim olunur',
  'Yeni istifadəçilər üçün daha etibarlı görünürsən',
];

function fmt(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

/**
 * Müəllim doğrulanması — the REAL state of this trainer's verification row.
 * Nothing is assumed: if no row exists the screen says so and offers to create
 * one (that row is what the admin queue sees). Certificate photos are really
 * uploaded into trainers.cert_urls; a failed upload is reported as a failure,
 * never drawn as a finished document.
 *
 * Attaching a photo to an ALREADY OPEN request is a separate, weaker promise:
 * trainer_verifications has only an admin UPDATE policy (tv_admin_update), so
 * the trainer's update is filtered out by RLS — zero rows, no error. The screen
 * therefore verifies the write with `.select('id')` and, when nothing came back,
 * says plainly that the document is stored but is NOT on the request the
 * reviewer reads. The reliable path is to upload before sending the request:
 * the INSERT carries the newest certificate and a trainer is allowed to insert.
 */
export default function Verify() {
  const [row, setRow] = useState<VerificationRow | null>(null);
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [certs, setCerts] = useState<string[]>([]);
  const [certBusy, setCertBusy] = useState(false);
  // trainers.verified is the ONLY thing that puts a badge on the public listing.
  // The verification row's status is a request state, not the badge.
  const [badge, setBadge] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig) {
        setLoading(false);
        return;
      }
      let alive = true;
      setLoading(true);
      (async () => {
        const me = await getMyProfile();
        if (!me?.user_id) return { row: null, tid: null as string | null, certs: [] as string[], badge: false };
        const { data, error } = await supabase
          .from('trainer_verifications')
          .select('*')
          .eq('user_id', me.user_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        const { data: t } = await supabase.from('trainers').select('id,verified').eq('id', me.id).maybeSingle();
        // cert_urls arrives with schema8; on an older database it is simply absent.
        let list: string[] = [];
        try {
          const cr = await supabase.from('trainers').select('cert_urls').eq('id', me.id).maybeSingle();
          list = (cr.data as { cert_urls?: string[] | null } | null)?.cert_urls ?? [];
        } catch {
          list = [];
        }
        return {
          row: (data as VerificationRow | null) ?? null,
          tid: t ? me.id : null,
          certs: list,
          badge: !!(t as { verified?: boolean } | null)?.verified,
        };
      })()
        .then((r) => {
          if (!alive) return;
          setRow(r.row);
          setTrainerId(r.tid);
          setCerts(r.certs);
          setBadge(r.badge);
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

  /** Really upload a certificate photo and attach it to the open request. */
  const addCert = async (source: 'camera' | 'library') => {
    if (certBusy) return;
    if (!hasSupabaseConfig) {
      toast('Sənəd yükləmək üçün server bağlantısı lazımdır', 'error');
      return;
    }
    if (!trainerId) {
      toast('Əvvəlcə müəllim profilini yarat', 'error');
      return;
    }
    let local: string | null = null;
    try {
      local = source === 'camera' ? await shootImage() : await pickImage();
    } catch {
      local = null;
    }
    if (!local) return; // cancelled or permission denied
    setCertBusy(true);
    try {
      const next = await addTrainerCert(trainerId, local);
      setCerts(next);
      // addTrainerCert APPENDS, so the newest evidence is the last element.
      const newest = next.length ? next[next.length - 1] : null;
      // Keep an open request pointing at the newest evidence — if the database
      // lets us. trainer_verifications currently has only an admin UPDATE policy
      // (tv_admin_update), so a trainer's write is filtered out by RLS: zero rows
      // changed and NO error. Checking `error` alone would report a success that
      // never happened, so ask for the row back and believe only that.
      if (row && row.status !== 'approved') {
        const { data: hit, error } = await supabase
          .from('trainer_verifications')
          .update({ doc_cert_url: newest })
          .eq('id', row.id)
          .select('id');
        const attached = !error && !!(hit as { id: string }[] | null)?.length;
        if (!attached) {
          // The file IS uploaded — it is in the private certs bucket under this
          // trainer. What failed is attaching it to the open request, and the
          // reviewer's queue row still shows no document. Say exactly that.
          errorFeedback();
          toast('Sertifikat saxlancda saxlanıldı, amma açıq sorğuna əlavə olunmadı — dəstəyə yaz', 'error');
          return;
        }
        setRow({ ...row, doc_cert_url: newest });
      }
      successFeedback();
      // Without an open request the file is stored but nothing is queued — say so.
      if (!row) toast('Sertifikat yükləndi — yoxlanması üçün doğrulama sorğusu göndər', 'info');
      else if (row.status === 'approved') toast('Sertifikat saxlanıldı — açıq sorğun yoxdur, ona görə növbəyə düşmür', 'info');
      else toast('Sertifikat yükləndi və sorğuna əlavə olundu');
    } catch {
      errorFeedback();
      toast('Şəkil yüklənmədi — yenidən cəhd et', 'error');
    } finally {
      setCertBusy(false);
    }
  };

  const pickCert = () =>
    actionSheet({
      title: 'Sertifikat əlavə et',
      message: 'Məşqçi sertifikatının şəklini yüklə. Sənəd qapalı saxlancda saxlanılır — yalnız SPOT komandası açır.',
      actions: [
        { label: 'Kamera', onPress: () => addCert('camera') },
        { label: 'Qalereya', onPress: () => addCert('library') },
        { label: 'Ləğv et', style: 'cancel' as const },
      ],
    });

  const submit = async () => {
    if (sending) return;
    if (!hasSupabaseConfig) {
      toast('Doğrulama üçün server bağlantısı lazımdır', 'error');
      return;
    }
    setSending(true);
    try {
      const me = await getMyProfile();
      if (!me?.user_id) throw new Error('no profile');
      const { data: t } = await supabase.from('trainers').select('id').eq('id', me.id).maybeSingle();
      if (!t) {
        toast('Əvvəlcə müəllim profilini yarat', 'error');
        return;
      }
      const { error } = await supabase
        .from('trainer_verifications')
        // The INSERT is the one write on this table a trainer is allowed, so it must
        // carry the newest certificate (addTrainerCert appends — certs[0] is the
        // oldest photo, not the evidence the reviewer should be looking at).
        .insert({
          trainer_id: me.id,
          user_id: me.user_id,
          status: 'pending',
          gym_confirm: false,
          doc_cert_url: certs.length ? certs[certs.length - 1] : null,
        });
      if (error) throw error;
      toast(certs.length ? 'Doğrulama sorğusu göndərildi — sertifikatın da əlavə olundu' : 'Doğrulama sorğusu göndərildi — sertifikat əlavə etməmisən', certs.length ? 'success' : 'info');
      setTick((n) => n + 1);
    } catch {
      toast('Sorğunu göndərmək alınmadı — internetini yoxla', 'error');
    } finally {
      setSending(false);
    }
  };

  const status = row?.status ?? null;
  // Approved on paper but the listing carries no badge — a real, reachable state
  // that used to be shown as «Təsdiqləndi · Profilin mavi nişanla görünür».
  const approvedNoBadge = status === 'approved' && !badge;
  const canApply = status === null || status === 'rejected' || approvedNoBadge;
  const statusTone =
    approvedNoBadge
      ? { bg: 'rgba(255,149,0,0.16)', fg: '#8A5A00', icon: 'shield' as IconName, label: 'Nişan aktiv deyil' }
      : status === 'approved'
      ? { bg: 'rgba(198,255,61,0.3)', fg: palette.voltDeep, icon: 'check' as IconName, label: 'Təsdiqləndi' }
      : status === 'rejected'
        ? { bg: 'rgba(255,59,48,0.1)', fg: palette.red, icon: 'x' as IconName, label: 'Rədd edildi' }
        : status === 'pending'
          ? { bg: 'rgba(255,149,0,0.16)', fg: '#8A5A00', icon: 'clock' as IconName, label: 'Yoxlanılır' }
          : { bg: palette.element, fg: palette.textSecondary, icon: 'shield' as IconName, label: 'Başlanmayıb' };

  return (
    <Screen edges={['top']}>
      <NavBar title="Müəllim doğrulanması" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 }}>
        {/* --- real status --- */}
        {loading ? (
          <View style={{ paddingVertical: 40 }}>
            <ActivityIndicator color={palette.tertiary} />
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.benefitHead}>
              <View style={[styles.badgeIcon, { backgroundColor: statusTone.bg }]}>
                <Icon name={statusTone.icon} size={22} color={statusTone.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 15.5, fontWeight: '600' }}>
                  {!hasSupabaseConfig ? 'Server bağlantısı yoxdur' : failed ? 'Status yüklənmədi' : statusTone.label}
                </AppText>
                <AppText style={{ fontSize: 12.5, color: palette.tertiary, marginTop: 4, lineHeight: 18 }}>
                  {!hasSupabaseConfig
                    ? 'Doğrulama serverdə aparılır — bağlantı olmadan status oxunmur.'
                    : failed
                      ? 'Doğrulama statusunu gətirmək alınmadı.'
                      : approvedNoBadge
                        ? 'Sorğun təsdiqlənib, amma elanında mavi nişan yoxdur. Yenidən müraciət et — sorğun yenidən yoxlamaya düşəcək.'
                        : status === 'approved'
                        ? 'Profilin mavi nişanla görünür.'
                        : status === 'rejected'
                          ? (row?.reject_reason ?? 'Səbəb göstərilməyib.')
                          : status === 'pending'
                            ? `Sorğu ${fmt(row?.created_at ?? null)} tarixində göndərildi${row?.sla_due_at ? ` · yoxlama ${fmt(row.sla_due_at)}-a qədər` : ''}.`
                            : 'Hələ doğrulama sorğusu göndərməmisən.'}
                </AppText>
              </View>
            </View>

            {failed ? (
              <PressableScale
                activeScale={0.97}
                accessibilityRole="button"
                accessibilityLabel="Yenidən cəhd et"
                onPress={() => setTick((n) => n + 1)}
                style={styles.primaryBtn}>
                <AppText style={{ color: palette.white, fontSize: 13.5, fontWeight: '600' }}>Yenidən cəhd et</AppText>
              </PressableScale>
            ) : hasSupabaseConfig && canApply ? (
              <PressableScale
                activeScale={0.97}
                disabled={sending}
                accessibilityRole="button"
                accessibilityLabel="Doğrulama sorğusu göndər"
                onPress={submit}
                style={[styles.primaryBtn, sending && { opacity: 0.5 }]}>
                <AppText style={{ color: palette.white, fontSize: 13.5, fontWeight: '600' }}>
                  {sending ? 'Göndərilir…' : status === null ? 'Doğrulamaya başla' : 'Yenidən müraciət et'}
                </AppText>
              </PressableScale>
            ) : null}
          </View>
        )}

        {/* --- what the badge actually gives --- */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
            MAVİ NİŞAN NƏ VERİR
          </AppText>
          <View style={{ gap: 9 }}>
            {BENEFITS.map((b) => (
              <View key={b} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Icon name="check" size={15} color={palette.voltDeep} />
                <AppText style={{ fontSize: 13.5, flex: 1 }}>{b}</AppText>
              </View>
            ))}
          </View>
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.caption, marginTop: 12 }}>
            Doğrulanma pulsuzdur. SPOT-da ödəniş sistemi yoxdur — nişan satış deyil, etibar üçündür.
          </AppText>
        </View>

        {/* --- real document state: certificates upload for real, the rest says the truth --- */}
        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 10 }}>
          SƏNƏDLƏR
        </AppText>
        <View style={{ gap: 11 }}>
          {/* Certificates — real uploads into trainers.cert_urls */}
          <View style={styles.certCard}>
            <View style={styles.docHead}>
              <View style={[styles.docIcon, { backgroundColor: certs.length ? 'rgba(198,255,61,0.3)' : palette.element }]}>
                <Icon name={certs.length ? 'check' : 'shield'} size={19} color={certs.length ? palette.voltDeep : palette.tertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>Məşqçi sertifikatı</AppText>
                <AppText style={{ fontSize: 12, marginTop: 4, color: certs.length ? palette.voltDeep : palette.tertiary }}>
                  {certs.length ? `${certs.length} şəkil yükləndi` : 'Hələ yüklənməyib'}
                </AppText>
              </View>
            </View>

            {certs.length > 0 ? (
              <View style={styles.thumbs}>
                {certs.map((u, i) => (
                  <CertThumb key={u} uri={u} index={i} />
                ))}
              </View>
            ) : null}

            {/* Uploaded and «in the reviewer's hands» are not the same thing. The
                open request carries exactly one document url; if it is empty the
                reviewer sees no document, however many photos are in the bucket. */}
            {certs.length > 0 && row && row.status !== 'approved' && !row.doc_cert_url ? (
              <View style={styles.warnRow}>
                <Icon name="shield" size={14} color="#8A5A00" />
                <AppText style={{ fontSize: 12, lineHeight: 17, color: '#8A5A00', flex: 1 }}>
                  Şəkillər saxlancdadır, amma açıq doğrulama sorğuna bağlanmayıb — yoxlayan onları görmür. Dəstəyə yaz ki, sorğuna əlavə etsinlər.
                </AppText>
              </View>
            ) : null}

            <PressableScale
              activeScale={0.97}
              disabled={certBusy}
              accessibilityRole="button"
              accessibilityLabel="Sertifikat şəkli əlavə et"
              onPress={pickCert}
              style={[styles.addBtn, certBusy && { opacity: 0.5 }]}>
              <Icon name={certBusy ? 'clock' : 'plus'} size={15} color={palette.inkText} />
              <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>
                {certBusy ? 'Yüklənir…' : certs.length ? 'Daha bir şəkil' : 'Sertifikat şəkli əlavə et'}
              </AppText>
            </PressableScale>

            <AppText style={{ fontSize: 11.5, lineHeight: 16, color: palette.caption, marginTop: 10 }}>
              Sənədlər qapalı saxlancdadır — yalnız SPOT komandası yoxlayır, profilində göstərilmir. Ona görə burada şəkil əvəzinə sənəd nişanı görə bilərsən.
            </AppText>
          </View>

          <DocRow title="Şəxsiyyət vəsiqəsi" done={!!row?.doc_id_url} pendingText="Tətbiqdən hələ yüklənmir — lazım olsa SPOT komandası soruşacaq" />
          <DocRow title="Təqdimat videosu · istəyə görə" done={!!row?.intro_video_url} pendingText="Tətbiqdən hələ yüklənmir" />
          {/* There is no gym-side approval surface anywhere in the app, and nothing
           *  ever writes gym_confirm = true (RLS also limits trainer_verifications
           *  writes to ops). Telling the trainer to wait on a gym admin would be
           *  waiting on a button that does not exist — so we say what really happens. */}
          <DocRow
            title="Zal təsdiqi"
            done={!!row?.gym_confirm}
            pendingText="Bu versiyada zal təsdiqi tətbiqdən alınmır — lazım olsa SPOT komandası zalla özü əlaqə saxlayır"
          />
        </View>

        <View style={styles.disclaimer}>
          <Icon name="shield" size={16} color={palette.textSecondary} />
          <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, flex: 1 }}>
            Yüklədiyin sertifikatlar qapalı saxlancda saxlanılır. Yoxlayana yalnız doğrulama sorğusuna bağlanmış sənəd çatır — ona görə sertifikatı sorğunu göndərməzdən əvvəl yüklə. Doğrulanma olmadan da profil yarada və pulsuz proqram paylaşa bilərsən; sadəcə nişansız görünürsən.
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * Certificates live in a PRIVATE bucket, so their url is not necessarily
 * viewable from the app. Rather than draw an empty box that looks like a broken
 * photo, fall back to an honest "document uploaded" tile.
 */
function CertThumb({ uri, index }: { uri: string; index: number }) {
  const [broken, setBroken] = useState(!/^https?:\/\//i.test(uri));
  if (broken) {
    return (
      <View style={[styles.thumb, styles.thumbFallback]}>
        <Icon name="shield" size={18} color={palette.tertiary} />
        <AppText style={{ fontSize: 10.5, color: palette.tertiary, marginTop: 4 }}>{index + 1}. sənəd</AppText>
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.thumb} contentFit="cover" transition={150} onError={() => setBroken(true)} />;
}

function DocRow({ title, done, pendingText }: { title: string; done: boolean; pendingText?: string }) {
  return (
    <View style={styles.docCardRow}>
      <View style={[styles.docIcon, { backgroundColor: done ? 'rgba(198,255,61,0.3)' : palette.element }]}>
        <Icon name={done ? 'check' : 'clock'} size={19} color={done ? palette.voltDeep : palette.tertiary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{title}</AppText>
        <AppText style={{ fontSize: 12, marginTop: 4, color: done ? palette.voltDeep : palette.tertiary }}>
          {done ? 'Təsdiqləndi' : (pendingText ?? 'Hələ yüklənməyib')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 17, marginBottom: 14 },
  benefitHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { height: 42, borderRadius: 12, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  docCardRow: { backgroundColor: palette.white, borderRadius: 16, padding: 15, flexDirection: 'row', gap: 13, alignItems: 'center' },
  certCard: { backgroundColor: palette.white, borderRadius: 16, padding: 15 },
  docHead: { flexDirection: 'row', gap: 13, alignItems: 'center' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  thumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: palette.element },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 40, borderRadius: 12, backgroundColor: palette.element, marginTop: 13 },
  docIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: palette.element, borderRadius: 14, padding: 14, marginTop: 16 },
  warnRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: 'rgba(255,149,0,0.16)', borderRadius: 12, padding: 11, marginTop: 12 },
});
