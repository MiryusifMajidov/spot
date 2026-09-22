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
import { dayAndMonth } from '@/lib/format';
import { addTrainerCert, imageTooLargeMessage, pickImage, shootImage, signedCertUrl } from '@/lib/images';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { actionSheet, confirm, toast } from '@/store/ui';
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
  return dayAndMonth(new Date(iso));
}

/**
 * Müəllim doğrulanması — the REAL state of this trainer's verification row.
 * Nothing is assumed: if no row exists the screen says so and offers to create
 * one (that row is what the admin queue sees). Certificate photos are really
 * uploaded into the private `certs` bucket and listed in trainers.cert_urls; a
 * failed upload is reported as a failure, never drawn as a finished document.
 *
 * Which request a new certificate reaches is decided by the database, not by
 * this screen: tv_own_evidence (schema55) lets a trainer point their OWN request
 * at new evidence only while it is `pending`. A decided request — rejected, or
 * approved without a badge — is frozen, so the photo goes into the NEW request
 * that «Yenidən müraciət et» inserts (the INSERT carries the newest certificate).
 * Every write is verified with `.select('id')`: an RLS-filtered UPDATE is
 * `error: null` with zero rows, and that must never read as «attached».
 */
export default function Verify() {
  const t = useT();
  const [row, setRow] = useState<VerificationRow | null>(null);
  const [loading, setLoading] = useState(hasSupabaseConfig);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [certs, setCerts] = useState<string[]>([]);
  const [certBusy, setCertBusy] = useState(false);
  const [attaching, setAttaching] = useState(false);
  // trainers.verified is the ONLY thing that puts a badge on the public listing.
  // The verification row's status is a request state, not the badge.
  const [badge, setBadge] = useState(false);

  /* One loader, run on focus AND called directly by «Yenidən cəhd et» and after
     a new request is sent. Both used to bump a `tick` the effect listed but never
     read — the compiler may drop such a dependency, and then the retry did
     nothing and a request sent a second ago still showed «Rədd edildi». */
  const load = useCallback(() => {
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
        /* Named columns, not `*`. schema70 took `internal_note` out of the
           column grant — it is the moderator's working note, and
           `tv_admin_read` lets the applicant read their own row, so a grant
           meant the trainer being judged read every word about themselves. A
           `select('*')` that touches an ungranted column is refused outright,
           which would have made this screen say the request does not exist. */
        .select(
          'id,trainer_id,user_id,status,doc_id_url,doc_cert_url,gym_confirm,intro_video_url,reject_reason,sla_due_at,created_at'
        )
        .eq('user_id', me.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      /* Both reads now REPORT failure. The error used to be destructured away
         (supabase-js resolves, it does not throw), so a dropped connection
         came back as «no trainer row»: a verified coach was told «Nişan aktiv
         deyil — elanında mavi nişan yoxdur» and invited to re-apply, which
         filed a duplicate request. And a failed certificate read drew
         «Hələ yüklənməyib» over certificates that were there.
         By owner_id, the same key roles.ts uses: rows whose id is not the
         profile id exist in the live database, and `.eq('id', me.id)` could
         never find them. */
      const tr = await supabase.from('trainers').select('id,verified,cert_urls').eq('owner_id', me.id).maybeSingle();
      if (tr.error) throw tr.error;
      const trow = tr.data as { id: string; verified?: boolean | null; cert_urls?: string[] | null } | null;
      return {
        row: (data as VerificationRow | null) ?? null,
        tid: trow ? trow.id : null,
        certs: trow?.cert_urls ?? [],
        badge: !!trow?.verified,
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
  }, []);

  useFocusEffect(load);

  const status = row?.status ?? null;
  // Approved on paper but the listing carries no badge — a real, reachable state
  // that used to be shown as «Təsdiqləndi · Profilin mavi nişanla görünür».
  const approvedNoBadge = status === 'approved' && !badge;
  const canApply = status === null || status === 'rejected' || approvedNoBadge;

  /** Point the open request at `path`. True only when the database hands the row
   *  back — a request decided in the meantime is filtered out by RLS with no error. */
  const attach = async (req: VerificationRow, path: string) => {
    try {
      const { data: hit, error } = await supabase
        .from('trainer_verifications')
        .update({ doc_cert_url: path })
        .eq('id', req.id)
        .select('id');
      if (error || !(hit as { id: string }[] | null)?.length) return false;
    } catch {
      return false;
    }
    setRow({ ...req, doc_cert_url: path });
    return true;
  };

  // The file IS stored; only the link to the request failed. Zero rows means the
  // request is no longer what this screen drew (most likely decided meanwhile), so
  // re-read it rather than send anyone to support: a rejected request then shows
  // «Yenidən müraciət et», and that new request carries this certificate.
  const notAttached = () => {
    errorFeedback();
    toast(t('Sertifikat saxlanıldı, amma sorğuna əlavə olunmadı — sorğunun vəziyyəti yenidən yoxlanılır'), 'error');
    load();
  };

  /** File a new request carrying `cert` — by default the newest upload
   *  (addTrainerCert appends, so certs[0] is the oldest photo, not the evidence
   *  the reviewer should be looking at). */
  const submit = async (cert?: string) => {
    if (sending) return;
    if (!hasSupabaseConfig) {
      toast(t('Doğrulama üçün server bağlantısı lazımdır'), 'error');
      return;
    }
    // The listing the loader found by owner_id. trainer_verifications.trainer_id
    // references trainers(id); the old re-read by profile id told a trainer whose
    // listing id differs to «create a profile» they already had.
    if (!trainerId) {
      toast(t('Əvvəlcə müəllim profilini yarat'), 'error');
      return;
    }
    const doc = cert ?? (certs.length ? certs[certs.length - 1] : null);
    setSending(true);
    try {
      const me = await getMyProfile();
      if (!me?.user_id) throw new Error('no profile');
      const { error } = await supabase
        .from('trainer_verifications')
        // The INSERT is the one write a trainer may make once a request is
        // decided, so the evidence travels with it.
        .insert({
          trainer_id: trainerId,
          user_id: me.user_id,
          status: 'pending',
          gym_confirm: false,
          doc_cert_url: doc,
        });
      if (error) throw error;
      toast(doc ? t('Doğrulama sorğusu göndərildi — sertifikatın da əlavə olundu') : t('Doğrulama sorğusu göndərildi — sertifikat əlavə etməmisən'), doc ? 'success' : 'info');
      load();
    } catch {
      toast(t('Sorğunu göndərmək alınmadı — internetini yoxla'), 'error');
    } finally {
      setSending(false);
    }
  };

  /** Really upload a certificate photo, then put it where a reviewer will see it. */
  const addCert = async (source: 'camera' | 'library') => {
    // Not while a request is being filed either — see the top button.
    if (certBusy || sending) return;
    if (!hasSupabaseConfig) {
      toast(t('Sənəd yükləmək üçün server bağlantısı lazımdır'), 'error');
      return;
    }
    // After a failed read trainerId is simply unknown, not absent — «create your
    // trainer profile first» would be a claim about a listing nobody has read.
    if (failed) {
      toast(t('Doğrulama statusunu gətirmək alınmadı.'), 'error');
      return;
    }
    if (!trainerId) {
      toast(t('Əvvəlcə müəllim profilini yarat'), 'error');
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
      const newest = next[next.length - 1];
      if (row?.status === 'pending') {
        if (!(await attach(row, newest))) {
          notAttached();
          return;
        }
        successFeedback();
        toast(t('Sertifikat yükləndi və sorğuna əlavə olundu'));
        return;
      }
      successFeedback();
      if (row && canApply) {
        // A decided request is frozen, so the photo cannot join it — it joins the
        // new one. Offer that step right here instead of leaving the trainer to
        // work out that the button at the top is the way.
        confirm(t('Sertifikat yükləndi'), t('Köhnə sorğuna artıq baxılıb — ona sənəd əlavə olunmur. Bu sertifikatla yeni sorğu göndərilsin?'), [
          { label: t('Sonra'), style: 'cancel' },
          { label: t('Yenidən müraciət et'), style: 'primary', onPress: () => void submit(newest) },
        ]);
      } else if (!row) toast(t('Sertifikat yükləndi — yoxlanması üçün doğrulama sorğusu göndər'), 'info');
      else toast(t('Sertifikat saxlanıldı — açıq sorğun yoxdur, ona görə növbəyə düşmür'), 'info');
    } catch (e) {
      errorFeedback();
      /* A diploma photographed at full resolution is routinely over the 10 MB
         `certs` ceiling, and «yenidən cəhd et» kept a trainer re-uploading the
         same file while their verification sat undocumented. Name the limit. */
      toast(imageTooLargeMessage(e) ?? t('Şəkil yüklənmədi — yenidən cəhd et'), 'error');
    } finally {
      setCertBusy(false);
    }
  };

  /** A pending request whose document link is empty: fixable from here. */
  const attachNewest = async () => {
    if (attaching || row?.status !== 'pending' || !certs.length) return;
    setAttaching(true);
    try {
      if (await attach(row, certs[certs.length - 1])) {
        successFeedback();
        toast(t('Sertifikat sorğuna əlavə olundu'));
      } else notAttached();
    } finally {
      setAttaching(false);
    }
  };

  const pickCert = () =>
    actionSheet({
      title: t('Sertifikat əlavə et'),
      message: t('Məşqçi sertifikatının şəklini yüklə. Sənəd qapalı saxlancda saxlanılır — onu yalnız sən və SPOT komandası görür.'),
      actions: [
        { label: t('Kamera'), onPress: () => addCert('camera') },
        { label: t('Qalereya'), onPress: () => addCert('library') },
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });

  const statusTone =
    approvedNoBadge
      ? { bg: 'rgba(255,149,0,0.16)', fg: '#8A5A00', icon: 'shield' as IconName, label: t('Nişan aktiv deyil') }
      : status === 'approved'
      ? { bg: 'rgba(198,255,61,0.3)', fg: palette.voltDeep, icon: 'check' as IconName, label: t('Təsdiqləndi') }
      : status === 'rejected'
        ? { bg: 'rgba(255,59,48,0.1)', fg: palette.red, icon: 'x' as IconName, label: t('Rədd edildi') }
        : status === 'pending'
          ? { bg: 'rgba(255,149,0,0.16)', fg: '#8A5A00', icon: 'clock' as IconName, label: t('Yoxlanılır') }
          : { bg: palette.element, fg: palette.textSecondary, icon: 'shield' as IconName, label: t('Başlanmayıb') };

  return (
    <Screen edges={['top']}>
      <NavBar title={t('Müəllim doğrulanması')} />
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
                  {!hasSupabaseConfig ? t('Server bağlantısı yoxdur') : failed ? t('Status yüklənmədi') : statusTone.label}
                </AppText>
                <AppText style={{ fontSize: 12.5, color: palette.tertiary, marginTop: 4, lineHeight: 18 }}>
                  {!hasSupabaseConfig
                    ? t('Doğrulama serverdə aparılır — bağlantı olmadan status oxunmur.')
                    : failed
                      ? t('Doğrulama statusunu gətirmək alınmadı.')
                      : approvedNoBadge
                        ? t('Sorğun təsdiqlənib, amma elanında mavi nişan yoxdur. Yenidən müraciət et — sorğun yenidən yoxlamaya düşəcək.')
                        : status === 'approved'
                        ? t('Profilin mavi nişanla görünür.')
                        : status === 'rejected'
                          ? (row?.reject_reason ?? t('Səbəb göstərilməyib.'))
                          : status === 'pending'
                            ? row?.sla_due_at
                              ? t('Sorğu {date} tarixində göndərildi · yoxlamanın son tarixi: {due}.', { date: fmt(row?.created_at ?? null), due: fmt(row.sla_due_at) })
                              : t('Sorğu {date} tarixində göndərildi.', { date: fmt(row?.created_at ?? null) })
                            : t('Hələ doğrulama sorğusu göndərməmisən.')}
                </AppText>
              </View>
            </View>

            {failed ? (
              <PressableScale
                activeScale={0.97}
                accessibilityRole="button"
                accessibilityLabel={t('Yenidən cəhd et')}
                onPress={() => void load()}
                style={styles.primaryBtn}>
                <AppText style={{ color: palette.white, fontSize: 13.5, fontWeight: '600' }}>{t('Yenidən cəhd et')}</AppText>
              </PressableScale>
            ) : hasSupabaseConfig && canApply ? (
              <PressableScale
                activeScale={0.97}
                /* Not during an upload: addCert picks «attach» or «new request»
                   from the request it saw when the upload started, and a request
                   filed meanwhile made it offer a second one. */
                disabled={sending || certBusy}
                accessibilityRole="button"
                accessibilityLabel={t('Doğrulama sorğusu göndər')}
                onPress={() => void submit()}
                style={[styles.primaryBtn, (sending || certBusy) && { opacity: 0.5 }]}>
                <AppText style={{ color: palette.white, fontSize: 13.5, fontWeight: '600' }}>
                  {sending ? t('Göndərilir…') : status === null ? t('Doğrulamaya başla') : t('Yenidən müraciət et')}
                </AppText>
              </PressableScale>
            ) : null}
          </View>
        )}

        {/* --- what the badge actually gives --- */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
            {t('MAVİ NİŞAN NƏ VERİR')}
          </AppText>
          <View style={{ gap: 9 }}>
            {BENEFITS.map((b) => (
              <View key={b} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Icon name="check" size={15} color={palette.voltDeep} />
                <AppText style={{ fontSize: 13.5, flex: 1 }}>{t(b)}</AppText>
              </View>
            ))}
          </View>
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.caption, marginTop: 12 }}>
            {t('Doğrulanma pulsuzdur. SPOT-da ödəniş sistemi yoxdur — nişan satış deyil, etibar üçündür.')}
          </AppText>
        </View>

        {/* --- real document state: certificates upload for real, the rest says the truth --- */}
        <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 10 }}>
          {t('SƏNƏDLƏR')}
        </AppText>
        <View style={{ gap: 11 }}>
          {/* Certificates — real uploads into trainers.cert_urls */}
          <View style={styles.certCard}>
            <View style={styles.docHead}>
              <View style={[styles.docIcon, { backgroundColor: certs.length ? 'rgba(198,255,61,0.3)' : palette.element }]}>
                <Icon name={certs.length ? 'check' : 'shield'} size={19} color={certs.length ? palette.voltDeep : palette.tertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{t('Məşqçi sertifikatı')}</AppText>
                {/* «Hələ yüklənməyib» is a claim about trainers.cert_urls, so it waits
                    for a read that came back — while loading, or after a failed
                    read, the empty list is only the initial state. */}
                <AppText style={{ fontSize: 12, marginTop: 4, color: certs.length ? palette.voltDeep : palette.tertiary }}>
                  {certs.length
                    ? t('{n} şəkil yükləndi', { n: certs.length, count: certs.length })
                    : !hasSupabaseConfig
                      ? t('Server bağlantısı yoxdur')
                      : failed
                        ? t('Doğrulama statusunu gətirmək alınmadı.')
                        : loading
                          ? t('Yüklənir…')
                          : t('Hələ yüklənməyib')}
                </AppText>
              </View>
            </View>

            {certs.length > 0 ? (
              <View style={styles.thumbs}>
                {certs.map((u, i) => (
                  <CertThumb key={u} path={u} index={i} />
                ))}
              </View>
            ) : null}

            {/* Uploaded and «in the reviewer's hands» are not the same thing. The
                request carries exactly one document url; if it is empty the
                reviewer sees no document, however many photos are in the bucket.
                A pending request can still be pointed at one, so the fix is a
                button here — not a message telling the trainer to write to support. */}
            {certs.length > 0 && row?.status === 'pending' && row.doc_cert_url !== certs[certs.length - 1] ? (
              <View style={styles.warnRow}>
                <Icon name="shield" size={14} color="#8A5A00" />
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontSize: 12, lineHeight: 17, color: '#8A5A00' }}>
                    {row.doc_cert_url
                      ? t('Sorğuna köhnə şəkil bağlıdır — yoxlayan ən son yüklədiyin sertifikatı görmür.')
                      : t('Şəkillər saxlancdadır, amma açıq doğrulama sorğuna bağlanmayıb — yoxlayan onları görmür.')}
                  </AppText>
                  <PressableScale
                    activeScale={0.97}
                    disabled={attaching}
                    accessibilityRole="button"
                    accessibilityLabel={t('Ən son şəkli sorğuna əlavə et')}
                    onPress={() => void attachNewest()}
                    style={[styles.warnBtn, attaching && { opacity: 0.5 }]}>
                    <AppText style={{ fontSize: 12.5, fontWeight: '600', color: palette.inkText }}>
                      {attaching ? t('Əlavə olunur…') : t('Ən son şəkli sorğuna əlavə et')}
                    </AppText>
                  </PressableScale>
                </View>
              </View>
            ) : null}

            {/* A decided request is frozen (tv_own_evidence covers `pending` only).
                Say where a new photo goes instead of letting an upload look like
                it reached the old request. */}
            {row && canApply ? (
              <View style={styles.noteRow}>
                <Icon name="shield" size={14} color={palette.textSecondary} />
                <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.textSecondary, flex: 1 }}>
                  {t('Baxılmış sorğuya sənəd əlavə olunmur. Ən son yüklədiyin şəkil «Yenidən müraciət et» ilə göndərilən yeni sorğuya əlavə olunur.')}
                </AppText>
              </View>
            ) : null}

            {/* Not while the first read is in flight: trainerId is still empty then,
                and addCert would answer «Əvvəlcə müəllim profilini yarat». */}
            <PressableScale
              activeScale={0.97}
              disabled={certBusy || loading}
              accessibilityRole="button"
              accessibilityLabel={t('Sertifikat şəkli əlavə et')}
              onPress={pickCert}
              style={[styles.addBtn, (certBusy || loading) && { opacity: 0.5 }]}>
              <Icon name={certBusy ? 'clock' : 'plus'} size={15} color={palette.inkText} />
              <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>
                {certBusy ? t('Yüklənir…') : certs.length ? t('Daha bir şəkil') : t('Sertifikat şəkli əlavə et')}
              </AppText>
            </PressableScale>

            <AppText style={{ fontSize: 11.5, lineHeight: 16, color: palette.caption, marginTop: 10 }}>
              {t('Sənədlər qapalı saxlancdadır — onları yalnız sən və SPOT komandası görür, profilində göstərilmir.')}
            </AppText>
          </View>

          <DocRow title={t('Şəxsiyyət vəsiqəsi')} done={!!row?.doc_id_url} pendingText={t('Tətbiqdən hələ yüklənmir — lazım olsa SPOT komandası soruşacaq')} />
          <DocRow title={t('Təqdimat videosu · istəyə görə')} done={!!row?.intro_video_url} pendingText={t('Tətbiqdən hələ yüklənmir')} />
          {/* There is no gym-side approval surface anywhere in the app, and nothing
           *  ever writes gym_confirm = true (RLS also limits trainer_verifications
           *  writes to ops). Telling the trainer to wait on a gym admin would be
           *  waiting on a button that does not exist — so we say what really happens. */}
          <DocRow
            title={t('Zal təsdiqi')}
            done={!!row?.gym_confirm}
            pendingText={t('Bu versiyada zal təsdiqi tətbiqdən alınmır — lazım olsa SPOT komandası zalla özü əlaqə saxlayır')}
          />
        </View>

        <View style={styles.disclaimer}>
          <Icon name="shield" size={16} color={palette.textSecondary} />
          <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, flex: 1 }}>
            {t('Yüklədiyin sertifikatlar qapalı saxlancda saxlanılır. Yoxlayan sorğuna bağlanmış ən son sertifikatı görür — açıq sorğun varsa, yeni yüklədiyin şəkil ona özü əlavə olunur. Doğrulanma olmadan da profil yarada və pulsuz proqram paylaşa bilərsən; sadəcə nişansız görünürsən.')}
          </AppText>
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * One uploaded certificate, drawn from the PRIVATE `certs` bucket. cert_urls
 * holds storage paths, so the picture needs a short-lived signed link — the
 * bucket's read policy lets the uploader sign their own objects. When no link can
 * be made (offline, object gone) or the image will not load, the tile says just
 * that: the document IS uploaded, only its preview did not open, and a tap asks
 * again. An empty box would look like a broken upload; a blank, like none at all.
 */
function CertThumb({ path, index }: { path: string; index: number }) {
  const t = useT();
  // undefined while signing, null when no link could be made.
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [broken, setBroken] = useState(false);

  const sign = useCallback(() => {
    let alive = true;
    signedCertUrl(path).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => sign(), [sign]);

  // Calls the signer itself — not a counter the effect would have to notice.
  const retry = () => {
    setSrc(undefined);
    setBroken(false);
    sign();
  };

  if (src === undefined) {
    return (
      <View style={[styles.thumb, styles.thumbFallback]}>
        <ActivityIndicator size="small" color={palette.tertiary} />
      </View>
    );
  }
  if (src === null || broken) {
    return (
      <PressableScale
        activeScale={0.95}
        accessibilityRole="button"
        accessibilityLabel={t('{n}. sənədin önizləməsi açılmadı — yenidən cəhd et', { n: index + 1 })}
        onPress={retry}
        style={[styles.thumb, styles.thumbFallback]}>
        <Icon name="shield" size={18} color={palette.tertiary} />
        <AppText style={{ fontSize: 10.5, color: palette.tertiary, marginTop: 4 }}>{t('{n}. sənəd', { n: index + 1 })}</AppText>
        <AppText style={{ fontSize: 9.5, color: palette.caption, marginTop: 1 }}>{t('Açılmadı')}</AppText>
      </PressableScale>
    );
  }
  return (
    <Image
      // Cached by the object path, not the link: every signing mints a new token,
      // and keying by it would download the same diploma again on every visit.
      source={{ uri: src, cacheKey: `cert:${path}` }}
      accessibilityLabel={t('{n}. sənəd', { n: index + 1 })}
      style={styles.thumb}
      contentFit="cover"
      transition={150}
      onError={() => setBroken(true)}
    />
  );
}

function DocRow({ title, done, pendingText }: { title: string; done: boolean; pendingText?: string }) {
  const t = useT();
  return (
    <View style={styles.docCardRow}>
      <View style={[styles.docIcon, { backgroundColor: done ? 'rgba(198,255,61,0.3)' : palette.element }]}>
        <Icon name={done ? 'check' : 'clock'} size={19} color={done ? palette.voltDeep : palette.tertiary} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{title}</AppText>
        <AppText style={{ fontSize: 12, marginTop: 4, color: done ? palette.voltDeep : palette.tertiary }}>
          {done ? t('Təsdiqləndi') : (pendingText ?? t('Hələ yüklənməyib'))}
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
  warnBtn: { alignSelf: 'flex-start', height: 32, paddingHorizontal: 12, borderRadius: 10, backgroundColor: palette.white, justifyContent: 'center', marginTop: 9 },
  noteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: palette.element, borderRadius: 12, padding: 11, marginTop: 12 },
});
