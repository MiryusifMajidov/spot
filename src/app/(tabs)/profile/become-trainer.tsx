import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getMyProfile } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { isPlaceholderName } from '@/lib/authorName';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { invalidateFocusCache } from '@/lib/focusFetch';
import { imageTooLargeMessage, pickImage, setTrainerPhoto, shootImage } from '@/lib/images';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/* 'unsynced' = the read worked and there is no listing row. 'unsaved' = the last
   save did not reach the server; the row may well exist with older data, so it
   must not be described as missing. 'failed' = the status read itself failed. */
type Sync = 'unknown' | 'checking' | 'synced' | 'unsynced' | 'unsaved' | 'failed';

/**
 * Publish / update the trainer listing with real error handling.
 *
 * Every write is checked: a silent failure would leave the user believing they
 * are a trainer while the listing and the admin verification queue stay empty.
 * The verification row is created ONCE — editing the profile never queues a new
 * one (that used to flood the admin queue with a row per save).
 */
async function publishTrainer(input: { specialty: string; bio: string; priceFrom: number; name: string; homeGymId: string | null }): Promise<string> {
  // Kəşf drops a placeholder-named row (isRealTrainer in hooks.ts), so writing
  // one would publish a listing nobody can ever see. Callers stop this earlier
  // with an inline message; this is the backstop.
  if (isPlaceholderName(input.name)) throw new Error('no-name');
  const me = await getMyProfile();
  if (!me?.id) throw new Error('no profile');
  // Read BEFORE the role write below. The server's role, not the phone's, says
  // whether this save makes somebody a trainer or edits an existing trainer —
  // the phone flips to «trainer» locally before the server has agreed.
  const becoming = me.role !== 'trainer';

  /* `.select('id')`, because an RLS refusal is not an error: the statement runs,
     matches nothing, and returns `error: null`. Without the row count a profile
     whose `role` never moved off «user» could still reach «Müəllim hesabın
     hazırdır» — a listing published by an account the rest of the app does not
     treat as a trainer, so the panel it points at refuses to open. */
  const { data: pRow, error: pErr } = await supabase
    .from('profiles')
    .update({ role: 'trainer', specialty: input.specialty, price_from: input.priceFrom })
    .eq('id', me.id)
    .select('id');
  if (pErr) throw pErr;
  if (!pRow?.length) throw new Error('profile-not-saved');

  // An EDIT must never touch the admin-owned columns. The old unconditional
  // upsert reset `verified`/`verify_status`, which silently stripped an approved
  // trainer's blue badge with no way to get it back.
  const { data: existingT, error: exErr } = await supabase.from('trainers').select('id').eq('id', me.id).maybeSingle();
  if (exErr) throw exErr;

  if (existingT) {
    const { data: tRow, error: tErr } = await supabase
      .from('trainers')
      .update({
        name: input.name,
        gym_id: input.homeGymId,
        specialty: input.specialty,
        price_from: input.priceFrom,
        bio: input.bio,
        // Closing the account sets `listed` false, and becoming a trainer again
        // puts the listing back. An EDIT leaves it alone: a coach who switched
        // «Kəşfdə görün» off must not be re-listed by fixing a typo in their bio.
        ...(becoming ? { listed: true } : {}),
      })
      .eq('id', me.id)
      .select('id');
    if (tErr) throw tErr;
    if (!tRow?.length) throw new Error('listing-not-saved');
  } else {
    // `verified` and `verify_status` are withheld from clients by schema27 —
    // otherwise this insert is the one place a person could hand themselves an
    // approved badge. The row starts `unverified`, and the trigger on
    // `trainer_verifications` moves it to «pending» when the queue row below is
    // created, so the status always reflects a real queue entry.
    const { error: tErr } = await supabase.from('trainers').insert({
      id: me.id,
      name: input.name,
      gym_id: input.homeGymId,
      specialty: input.specialty,
      price_from: input.priceFrom,
      bio: input.bio,
      owner_id: me.id,
    });
    if (tErr) throw tErr;
    /* Listed at once. `listed` is not in the INSERT grant (schema53: a row must
       not publish itself), but it IS the trainer's own switch after that
       (schema73, «Kəşfdə görün»), so hidden-by-default protected nothing — it
       only broke the promise this screen makes: «İstifadəçilər səni Kəşf
       bölməsində tapıb…». A failure here is not thrown: the listing exists,
       and the panel reads the real flag and offers the switch. */
    const { data: shown, error: lErr } = await supabase.from('trainers').update({ listed: true }).eq('id', me.id).select('id');
    if (lErr || !shown?.length) console.warn('[become-trainer] listing stays hidden', lErr);
  }

  // Queue for admin verification only if this trainer has no row yet. A failed
  // read is not «no row» — taken as one, it queued a duplicate on every save.
  const { data: existing, error: exVErr } = await supabase
    .from('trainer_verifications')
    .select('id')
    .eq('user_id', me.user_id)
    .limit(1)
    .maybeSingle();
  if (exVErr) throw exVErr;
  if (!existing) {
    const { error: vErr } = await supabase
      .from('trainer_verifications')
      .insert({ trainer_id: me.id, user_id: me.user_id, status: 'pending', gym_confirm: false });
    if (vErr) throw vErr;
  }
  // Kəşf → Müəllimlər caches its list for 60 s; without this a fresh listing or
  // an edited specialty/price would not show up there.
  invalidateFocusCache('trainers');
  // The trainer row id is the profile id — the caller needs it to attach a photo.
  return me.id;
}

export default function BecomeTrainer() {
  const t = useT();
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  /* Opened from the trainer panel (`from=trainer`), this screen sits on a new
     member-tabs route whose profile stack holds only this screen. router.back()
     then bubbles to the tab navigator, which switches to its first tab, Kəşf:
     the trainer saved and landed in the member app instead of the panel.
     dismissTo pops back to the panel (or replaces this screen with it). */
  const leave = () => (from === 'trainer' ? router.dismissTo('/trainer') : router.back());
  const gate = useAuthGate();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const setMode = useAppStore((s) => s.setMode);
  const alreadyTrainer = profile.role === 'trainer';
  // The same test Kəşf applies to the listing. Publishing without a real name
  // used to write «Müəllim», which the list then hides while the toast said
  // the profile was out there.
  const nameMissing = isPlaceholderName(profile.name);

  const [specialty, setSpecialty] = useState(profile.specialty ?? '');
  const [price, setPrice] = useState(profile.priceFrom ? String(profile.priceFrom) : '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [sync, setSync] = useState<Sync>('unknown');
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);
  // The real `trainers.verified` flag — the only thing that puts a badge on the listing.
  const [badge, setBadge] = useState(false);
  // photoUrl = what is actually on the server. photoLocal = picked, not uploaded yet.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLocal, setPhotoLocal] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  // Keyboard: lift the save button clear of it and push the content up by the same
  // amount, so the field that was just tapped stays exactly where it was on screen.
  const lift = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lifted = useRef(0);
  useEffect(() => {
    const delta = lift - lifted.current;
    lifted.current = lift;
    if (delta > 0) scroller.current?.scrollTo({ y: scrollY.current + delta, animated: true });
  }, [lift]);

  // Is the listing actually on the server? A trainer must be able to see the truth.
  useFocusEffect(
    useCallback(() => {
      if (!alreadyTrainer || !hasSupabaseConfig) return;
      let alive = true;
      setSync('checking');
      (async () => {
        const me = await getMyProfile();
        if (!me?.id) return { listed: false, st: null as null | 'pending' | 'approved' | 'rejected', photo: null as string | null, badge: false };
        // Read the photo separately: on a database without schema8 this column is
        // missing, and that must not make the listing look unsynced.
        let photo: string | null = null;
        try {
          const pr = await supabase.from('trainers').select('photo_url').eq('id', me.id).maybeSingle();
          photo = (pr.data as { photo_url?: string | null } | null)?.photo_url ?? null;
        } catch {
          photo = null;
        }
        const [{ data: t, error: tErr }, { data: v, error: vErr }] = await Promise.all([
          supabase.from('trainers').select('id,verified,name,specialty,price_from,bio').eq('id', me.id).maybeSingle(),
          supabase
            .from('trainer_verifications')
            .select('status')
            .eq('user_id', me.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        // An unanswered read is not «no listing» / «not started»: both would send
        // the trainer to fix a listing that may be perfectly fine.
        if (tErr) throw tErr;
        if (vErr) throw vErr;
        /* «The row exists» is not «the row says what you saved». save() writes
           the phone first, so a save whose server write failed left the
           'unsaved' card only until the screen was left; the next visit read
           the row, found it, and called stale data «synced». Compare what the
           listing says with what this phone holds instead. */
        const row = t as { name?: string | null; specialty?: string | null; price_from?: number | null; bio?: string | null } | null;
        const local = useAppStore.getState().profile;
        const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim();
        const differs =
          !!row &&
          (!same(row.name, local.name) ||
            !same(row.specialty, local.specialty) ||
            !same(row.bio, local.bio) ||
            (row.price_from || 0) !== (local.priceFrom || 0));
        return {
          differs,
          listed: !!t,
          st: ((v as { status: 'pending' | 'approved' | 'rejected' } | null)?.status ?? null),
          photo,
          // The blue badge comes from trainers.verified, NOT from the request row.
          badge: !!(t as { verified?: boolean } | null)?.verified,
        };
      })()
        .then((r) => {
          if (!alive) return;
          setSync(r.listed ? (r.differs ? 'unsaved' : 'synced') : 'unsynced');
          setStatus(r.st);
          setPhotoUrl(r.photo);
          setBadge(r.badge);
        })
        .catch(() => alive && setSync('failed'));
      return () => {
        alive = false;
      };
    }, [alreadyTrainer])
  );

  /**
   * Pick a trainer photo. If the trainer row is not on the server yet the photo
   * is only held locally and uploaded right after the listing is created — we
   * never tell the user it is uploaded before it is.
   */
  const choosePhoto = async (source: 'camera' | 'library') => {
    if (photoBusy) return;
    let local: string | null = null;
    try {
      local = source === 'camera' ? await shootImage({ square: true }) : await pickImage({ square: true });
    } catch {
      local = null;
    }
    if (!local) return; // cancelled or permission denied
    if (!hasSupabaseConfig) {
      setPhotoLocal(local);
      toast(t('Şəkil cihazda seçildi — server bağlantısı olmadan yüklənmir'), 'info');
      return;
    }
    setPhotoBusy(true);
    try {
      const me = await getMyProfile();
      if (!me?.id) throw new Error('no profile');
      const { data: row } = await supabase.from('trainers').select('id').eq('id', me.id).maybeSingle();
      if (!row) {
        // No row to attach to yet — hold it until «Müəllim profilini yarat».
        setPhotoLocal(local);
        toast(t('Şəkil seçildi — müəllim profilini yaradanda yüklənəcək'), 'info');
        return;
      }
      const url = await setTrainerPhoto(me.id, local);
      setPhotoUrl(url);
      setPhotoLocal(null);
      successFeedback();
      toast(t('Profil şəklin yeniləndi'));
    } catch (e) {
      errorFeedback();
      /* «yenidən cəhd et» is a lie about a file over the 5 MB avatars ceiling —
         the same photo fails the same way forever. That case names itself and
         carries the real numbers; everything else keeps the retry wording. */
      toast(imageTooLargeMessage(e) ?? t('Şəkil yüklənmədi — yenidən cəhd et'), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const changePhoto = () =>
    actionSheet({
      title: t('Profil şəkli'),
      message: t('Şəklin Kəşf → Müəllimlər siyahısında və profilində görünür.'),
      actions: [
        { label: t('Kamera'), onPress: () => choosePhoto('camera') },
        { label: t('Qalereya'), onPress: () => choosePhoto('library') },
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });

  const save = () =>
    gate(async () => {
      if (!specialty.trim() || saving) return;
      if (nameMissing) {
        toast(t('Əvvəlcə adını yaz'), 'error');
        return;
      }
      setSaving(true);
      const priceFrom = Number(price) || 0;
      const payload = { specialty: specialty.trim(), bio: bio.trim(), priceFrom, name: profile.name.trim(), homeGymId: profile.homeGymId };

      // Local-first: the panel works on this device no matter what the server says.
      setProfile({ role: 'trainer', specialty: payload.specialty, priceFrom, bio: payload.bio });

      let serverOk = false;
      /* The whole message for a photo that did not go up with the profile, or
         null when it did. It used to be a boolean, which could only ever produce
         «yenidən cəhd et» — including for a file the bucket refuses every time. */
      let photoFailMsg: string | null = null;
      if (hasSupabaseConfig) {
        try {
          const trainerId = await publishTrainer(payload);
          serverOk = true;
          setSync('synced');
          // A photo picked before the listing existed is uploaded now.
          if (photoLocal) {
            try {
              const url = await setTrainerPhoto(trainerId, photoLocal);
              setPhotoUrl(url);
              setPhotoLocal(null);
            } catch (e) {
              const why = imageTooLargeMessage(e);
              photoFailMsg = why
                ? t('Profil saxlanıldı, amma şəkil yüklənmədi. {why}', { why })
                : t('Profil saxlanıldı, amma şəkil yüklənmədi — yenidən cəhd et');
            }
          }
        } catch {
          setSync('unsaved');
        }
      }
      setSaving(false);

      if (!hasSupabaseConfig) {
        toast(t('Cihazda saxlanıldı — server bağlantısı olmadan başqaları səni görmür'), 'info');
      } else if (serverOk && photoFailMsg) {
        toast(photoFailMsg, 'error');
      } else if (serverOk) {
        toast(alreadyTrainer ? t('Müəllim profilin yeniləndi') : t('Müəllim profilin yaradıldı'));
      } else {
        toast(t('Serverə yazmaq alınmadı — cihazda saxlanıldı, sonra «Yenidən sinxronla» ilə cəhd et'), 'error');
      }

      if (alreadyTrainer) {
        // Closing the screen on a failed write would take away the very
        // «Yenidən sinxronla» button the error toast points at.
        if (serverOk || !hasSupabaseConfig) leave();
      } else {
        setMode('trainer');
        router.replace('/trainer');
      }
    }, t('Müəllim hesabı üçün'));

  const resync = async () => {
    if (saving) return;
    if (nameMissing) {
      toast(t('Əvvəlcə adını yaz'), 'error');
      return;
    }
    setSaving(true);
    try {
      const trainerId = await publishTrainer({ specialty: specialty.trim(), bio: bio.trim(), priceFrom: Number(price) || 0, name: profile.name.trim(), homeGymId: profile.homeGymId });
      setSync('synced');
      // A photo picked while the first save was failing is still only on this device.
      if (photoLocal) {
        try {
          setPhotoUrl(await setTrainerPhoto(trainerId, photoLocal));
          setPhotoLocal(null);
        } catch (e) {
          const why = imageTooLargeMessage(e);
          // «Yenidən sinxronla» retries this same held photo, so telling the user
          // to retry a file the bucket refuses would loop them here forever.
          toast(
            why ? t('Profil sinxronlaşdı, amma şəkil yüklənmədi. {why}', { why }) : t('Profil sinxronlaşdı, amma şəkil yüklənmədi — yenidən cəhd et'),
            'error'
          );
          return;
        }
      }
      toast(t('Serverlə sinxronlaşdırıldı'));
    } catch {
      setSync('unsaved');
      toast(t('Sinxronlaşma alınmadı — internetini yoxla'), 'error');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Closing the trainer account. The app does all three things itself now:
   * it ends the open student requests, and it takes the public listing down by
   * clearing `trainers.listed` — the column schema10 added for exactly this, and
   * the one `useTrainers()` filters Kəşf → Müəllimlər on. No moderation ticket is
   * filed for work the client can do. Each write is verified with `.select('id')`
   * because an RLS-filtered UPDATE returns zero rows and NO error, and reporting
   * that as success would be the same lie in a new place.
   */
  const closeAccount = () =>
    confirm(
      t('Müəllim hesabını bağlamaq?'),
      t('Müəllim paneli bağlanacaq, elanın Kəşf bölməsindən dərhal çıxarılacaq və cavabsız şagird sorğuların bitmiş kimi işarələnəcək.'),
      [
        { label: t('Ləğv et'), style: 'cancel' },
        {
          label: t('Bağla'),
          style: 'destructive',
          onPress: async () => {
            setProfile({ role: 'user' });
            setMode('user');
            if (!hasSupabaseConfig) {
              toast(t('Müəllim hesabı bu cihazda bağlandı — serverdə elanın toxunulmadı'), 'info');
              router.replace('/(tabs)/profile');
              return;
            }
            let requestsClosed = false;
            let unlisted = false;
            try {
              const me = await getMyProfile();
              if (!me?.id) throw new Error('no profile');
              /* Same rule on the way out. If the role does not come back to
                 «user» the account keeps a trainer's panel and a trainer's
                 navigation while the person has been told it is closed. */
              const { data: rRow, error: rErr } = await supabase
                .from('profiles').update({ role: 'user' }).eq('id', me.id).select('id');
              if (rErr) throw rErr;
              if (!rRow?.length) throw new Error('role-not-restored');

              const { data: t } = await supabase.from('trainers').select('id').eq('owner_id', me.id).maybeSingle();
              const trainerId = (t as { id: string } | null)?.id ?? me.id;

              /* Take the listing down for real. `trainers_update` is owner-scoped, so a
                 legacy row with a null owner_id is filtered out by RLS and comes back as
                 zero rows with no error — hence `.select('id')` and a length check rather
                 than trusting `error`. owner_id is deliberately LEFT in place: clearing it
                 would break owns_trainer() for the requests we are about to end. */
              const { data: un } = await supabase
                .from('trainers')
                .update({ listed: false })
                .eq('id', trainerId)
                .select('id');
              unlisted = !!(un as { id: string }[] | null)?.length;
              // Kəşf → Müəllimlər caches its list for 60 s; without this the closed
              // trainer keeps being served from the cache.
              if (unlisted) invalidateFocusCache('trainers');

              // Students must not keep waiting for a trainer who no longer has a panel.
              const { error: reqErr } = await supabase
                .from('trainer_requests')
                .update({ status: 'ended', decided_at: new Date().toISOString() })
                .eq('trainer_id', trainerId)
                .in('status', ['pending', 'accepted']);
              requestsClosed = !reqErr;
            } catch {
              // Every branch below states exactly what did and did not happen.
            }
            if (unlisted && requestsClosed) {
              toast(t('Müəllim hesabı bağlandı — elanın Kəşfdən çıxarıldı, açıq sorğular bitirildi'));
            } else if (unlisted) {
              toast(t('Elanın Kəşfdən çıxarıldı, amma şagird sorğuları bağlanmadı — dəstəyə yaz'), 'error');
            } else {
              toast(t('Hesab bu cihazda bağlandı, amma elanın hələ Kəşfdə görünür — yenidən cəhd et'), 'error');
            }
            router.replace('/(tabs)/profile');
          },
        },
      ]
    );

  const syncBad = sync === 'unsynced' || sync === 'unsaved' || sync === 'failed';

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={alreadyTrainer ? t('Müəllim profili') : t('Müəllim ol')} onBack={leave} />
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}>
        <AppText variant="body" color={palette.textSecondary} style={{ lineHeight: 21, marginBottom: 20 }}>
          {alreadyTrainer
            ? t('Burada yazdıqların Kəşfdəki müəllim profilində görünür. Qiymət yalnız məlumat üçündür — SPOT ödəniş qəbul etmir.')
            : t('Öz təlim xidmətini yarat. İstifadəçilər səni Kəşf bölməsində tapıb məşq sorğusu göndərə biləcək. Qiymət yalnız məlumat üçündür — SPOT ödəniş qəbul etmir.')}
        </AppText>

        {/* Why the save button is off. The name is edited on the profile, not
            here, so the card leads straight there — saving it there also renames
            an existing listing. */}
        {nameMissing ? (
          <View style={styles.statusCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="user" size={17} color={palette.red} />
              <AppText style={{ fontSize: 14, fontWeight: '600', flex: 1 }}>{t('Əvvəlcə adını yaz')}</AppText>
            </View>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 8 }}>
              {t('Adı olmayan müəllim Kəşf → Müəllimlər siyahısında göstərilmir — şagirdlər səni tapa bilməz. Adını profilində yaz, sonra buraya qayıt.')}
            </AppText>
            <PressableScale
              activeScale={0.97}
              accessibilityRole="button"
              accessibilityLabel={t('Adını yaz')}
              onPress={() => router.push('/(tabs)/profile/edit')}
              style={[styles.smallBtn, { backgroundColor: palette.ink, alignSelf: 'flex-start', marginTop: 12 }]}>
              <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{t('Adını yaz')}</AppText>
            </PressableScale>
          </View>
        ) : null}

        {alreadyTrainer ? (
          <View style={styles.statusCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon
                name={syncBad ? 'shield' : status === 'approved' && badge ? 'verified' : 'clock'}
                size={17}
                color={syncBad ? palette.red : status === 'approved' && badge ? palette.blue : '#FF9500'}
              />
              <AppText style={{ fontSize: 14, fontWeight: '600', flex: 1 }}>
                {!hasSupabaseConfig
                  ? t('Yalnız bu cihazda')
                  : sync === 'checking'
                    ? t('Yoxlanılır…')
                    : sync === 'failed'
                      ? t('Yüklənmədi')
                      : sync === 'unsynced' || sync === 'unsaved'
                        ? t('Serverlə sinxronlaşdırılmayıb')
                        : status === 'approved'
                          ? badge
                            ? t('Doğrulanmış müəllim')
                            : t('Nişan profilində görünmür')
                          : status === 'rejected'
                            ? t('Doğrulama rədd edilib')
                            : status === 'pending'
                              ? t('Doğrulama yoxlanılır')
                              : t('Doğrulama başlanmayıb')}
              </AppText>
            </View>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 8 }}>
              {!hasSupabaseConfig
                ? t('Server bağlantısı yoxdur — müəllim elanın hələ başqalarına görünmür.')
                : sync === 'failed'
                  ? t('Vəziyyət oxunmadı — bağlantını yoxla və səhifəni yenidən aç.')
                  : sync === 'unsaved'
                    ? t('Serverə yazmaq alınmadı — cihazda saxlanıldı, sonra «Yenidən sinxronla» ilə cəhd et')
                    : sync === 'unsynced'
                      ? t('Elanın serverdə yoxdur, ona görə istifadəçilər səni tapa bilmir. Yenidən sinxronla.')
                      : status === 'approved' && !badge
                        ? t('Doğrulama sorğun təsdiqlənib, amma elanında mavi nişan yoxdur. Müəllim doğrulanması səhifəsindən yenidən müraciət et.')
                        : t('Doğrulama statusunu və sənədləri Müəllim doğrulanması səhifəsində görə bilərsən.')}
            </AppText>
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
              {(sync === 'unsynced' || sync === 'unsaved') && hasSupabaseConfig ? (
                <PressableScale
                  activeScale={0.97}
                  accessibilityRole="button"
                  accessibilityLabel={t('Yenidən sinxronla')}
                  disabled={saving}
                  onPress={resync}
                  style={[styles.smallBtn, { backgroundColor: palette.ink }, saving && { opacity: 0.5 }]}>
                  <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{t('Yenidən sinxronla')}</AppText>
                </PressableScale>
              ) : null}
              <PressableScale
                activeScale={0.97}
                accessibilityRole="button"
                accessibilityLabel={t('Müəllim doğrulanmasını aç')}
                onPress={() => router.push('/trainer/verify')}
                style={[styles.smallBtn, { backgroundColor: palette.element }]}>
                <AppText style={{ color: palette.inkText, fontSize: 13, fontWeight: '600' }}>{t('Doğrulanma')}</AppText>
              </PressableScale>
            </View>
          </View>
        ) : null}

        {/* --- trainer photo: the single biggest trust signal in the list --- */}
        <View style={styles.photoCard}>
          <PressableScale
            activeScale={0.96}
            disabled={photoBusy}
            accessibilityRole="button"
            accessibilityLabel={t('Profil şəklini seç')}
            onPress={changePhoto}
            style={[styles.photoWrap, photoBusy && { opacity: 0.6 }]}>
            <Avatar name={profile.name || 'Müəllim'} size={76} uri={photoLocal ?? photoUrl} />
            <View style={styles.camBadge}>
              <Icon name="cam" size={13} color={palette.white} />
            </View>
          </PressableScale>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{t('Profil şəkli')}</AppText>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 4 }}>
              {photoLocal
                ? t('Şəkil seçildi — «Yadda saxla» ilə yüklənəcək.')
                : t('Kəşf → Müəllimlər siyahısında və profilində bu şəkil görünür. Üzü aydın görünən şəkil daha çox sorğu gətirir.')}
            </AppText>
            <PressableScale
              activeScale={0.97}
              disabled={photoBusy}
              accessibilityRole="button"
              accessibilityLabel={t('Şəkli dəyiş')}
              onPress={changePhoto}
              style={[styles.photoBtn, photoBusy && { opacity: 0.5 }]}>
              <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>
                {photoBusy ? t('Yüklənir…') : photoLocal || photoUrl ? t('Şəkli dəyiş') : t('Şəkil əlavə et')}
              </AppText>
            </PressableScale>
          </View>
        </View>

        <Field label={t('İxtisas *')} value={specialty} onChangeText={setSpecialty} placeholder={t('Məs: Güc və hipertrofiya, Funksional…')} />
        <Field label={t('Sessiya qiyməti (₼, məlumat üçün)')} value={price} onChangeText={setPrice} placeholder={t('Məs: 30')} keyboardType="numeric" />
        <Field label={t('Haqqında')} value={bio} onChangeText={setBio} placeholder={t('Təcrübən, yanaşman, kimlərlə işləyirsən…')} multiline />

        {alreadyTrainer ? (
          <PressableScale
            activeScale={0.98}
            accessibilityRole="button"
            accessibilityLabel={t('Müəllim hesabını bağla')}
            onPress={closeAccount}
            style={styles.dangerRow}>
            <Icon name="x" size={17} color={palette.red} />
            <AppText style={{ fontSize: 14.5, fontWeight: '600', color: palette.red }}>{t('Müəllim hesabını bağla')}</AppText>
          </PressableScale>
        ) : null}
      </ScrollView>
      {/* The scroller shrinks to whatever this row leaves it, so lifting the row by the
          keyboard overlap carries the whole form with it. */}
      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 8, marginBottom: lift }}>
        <Button
          title={alreadyTrainer ? t('Yadda saxla') : t('Müəllim profilini yarat')}
          variant="volt"
          full
          disabled={!specialty.trim() || saving || nameMissing}
          onPress={save}
        />
      </View>
    </Screen>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: { label: string; value: string; onChangeText: (t: string) => void; placeholder: string; keyboardType?: 'numeric'; multiline?: boolean }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 8, fontWeight: '600' }}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.caption}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 24 },
  input: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: palette.inkText, borderWidth: 1, borderColor: palette.separator },
  statusCard: { backgroundColor: palette.white, borderRadius: 16, padding: 15, marginBottom: 20 },
  smallBtn: { height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.white, borderRadius: 14, padding: 15, marginTop: 6 },
  photoCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: palette.white, borderRadius: 16, padding: 15, marginBottom: 20 },
  photoWrap: { width: 76, height: 76 },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: palette.ink,
    borderWidth: 2,
    borderColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtn: { alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, borderRadius: 10, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
});
