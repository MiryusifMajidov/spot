import { useFocusEffect, useRouter } from 'expo-router';
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
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { invalidateFocusCache } from '@/lib/focusFetch';
import { imageTooLargeMessage, pickImage, setTrainerPhoto, shootImage } from '@/lib/images';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { actionSheet, confirm, toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

type Sync = 'unknown' | 'checking' | 'synced' | 'unsynced';

/**
 * Publish / update the trainer listing with real error handling.
 *
 * Every write is checked: a silent failure would leave the user believing they
 * are a trainer while the listing and the admin verification queue stay empty.
 * The verification row is created ONCE — editing the profile never queues a new
 * one (that used to flood the admin queue with a row per save).
 */
async function publishTrainer(input: { specialty: string; bio: string; priceFrom: number; name: string; homeGymId: string | null }): Promise<string> {
  const me = await getMyProfile();
  if (!me?.id) throw new Error('no profile');

  const { error: pErr } = await supabase
    .from('profiles')
    .update({ role: 'trainer', specialty: input.specialty, price_from: input.priceFrom })
    .eq('id', me.id);
  if (pErr) throw pErr;

  // An EDIT must never touch the admin-owned columns. The old unconditional
  // upsert reset `verified`/`verify_status`, which silently stripped an approved
  // trainer's blue badge with no way to get it back.
  const { data: existingT, error: exErr } = await supabase.from('trainers').select('id').eq('id', me.id).maybeSingle();
  if (exErr) throw exErr;

  if (existingT) {
    const { error: tErr } = await supabase
      .from('trainers')
      .update({
        name: input.name || me.name || 'Müəllim',
        gym_id: input.homeGymId,
        specialty: input.specialty,
        price_from: input.priceFrom,
        bio: input.bio,
        // Closing the account sets `listed` false. Re-publishing must put the
        // listing back, otherwise the screen says «yayımlandı» about a row that
        // useTrainers() still filters out of Kəşf → Müəllimlər.
        listed: true,
      })
      .eq('id', me.id);
    if (tErr) throw tErr;
  } else {
    // `verified` and `verify_status` are withheld from clients by schema27 —
    // otherwise this insert is the one place a person could hand themselves an
    // approved badge. The row starts `unverified`, and the trigger on
    // `trainer_verifications` moves it to «pending» when the queue row below is
    // created, so the status always reflects a real queue entry.
    const { error: tErr } = await supabase.from('trainers').insert({
      id: me.id,
      name: input.name || me.name || 'Müəllim',
      gym_id: input.homeGymId,
      specialty: input.specialty,
      price_from: input.priceFrom,
      bio: input.bio,
      owner_id: me.id,
    });
    if (tErr) throw tErr;
  }

  // Queue for admin verification only if this trainer has no row yet.
  const { data: existing } = await supabase
    .from('trainer_verifications')
    .select('id')
    .eq('user_id', me.user_id)
    .limit(1)
    .maybeSingle();
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
  const router = useRouter();
  const gate = useAuthGate();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const setMode = useAppStore((s) => s.setMode);
  const alreadyTrainer = profile.role === 'trainer';

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
        const [{ data: t }, { data: v }] = await Promise.all([
          supabase.from('trainers').select('id,verified').eq('id', me.id).maybeSingle(),
          supabase
            .from('trainer_verifications')
            .select('status')
            .eq('user_id', me.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        return {
          listed: !!t,
          st: ((v as { status: 'pending' | 'approved' | 'rejected' } | null)?.status ?? null),
          photo,
          // The blue badge comes from trainers.verified, NOT from the request row.
          badge: !!(t as { verified?: boolean } | null)?.verified,
        };
      })()
        .then((r) => {
          if (!alive) return;
          setSync(r.listed ? 'synced' : 'unsynced');
          setStatus(r.st);
          setPhotoUrl(r.photo);
          setBadge(r.badge);
        })
        .catch(() => alive && setSync('unsynced'));
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
      toast('Şəkil cihazda seçildi — server bağlantısı olmadan yüklənmir', 'info');
      return;
    }
    setPhotoBusy(true);
    try {
      const me = await getMyProfile();
      if (!me?.id) throw new Error('no profile');
      const { data: t } = await supabase.from('trainers').select('id').eq('id', me.id).maybeSingle();
      if (!t) {
        // No row to attach to yet — hold it until «Müəllim profilini yarat».
        setPhotoLocal(local);
        toast('Şəkil seçildi — müəllim profilini yaradanda yüklənəcək', 'info');
        return;
      }
      const url = await setTrainerPhoto(me.id, local);
      setPhotoUrl(url);
      setPhotoLocal(null);
      successFeedback();
      toast('Profil şəklin yeniləndi');
    } catch (e) {
      errorFeedback();
      /* «yenidən cəhd et» is a lie about a file over the 5 MB avatars ceiling —
         the same photo fails the same way forever. That case names itself and
         carries the real numbers; everything else keeps the retry wording. */
      toast(imageTooLargeMessage(e) ?? 'Şəkil yüklənmədi — yenidən cəhd et', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const changePhoto = () =>
    actionSheet({
      title: 'Profil şəkli',
      message: 'Şəklin Kəşf → Müəllimlər siyahısında və profilində görünür.',
      actions: [
        { label: 'Kamera', onPress: () => choosePhoto('camera') },
        { label: 'Qalereya', onPress: () => choosePhoto('library') },
        { label: 'Ləğv et', style: 'cancel' as const },
      ],
    });

  const save = () =>
    gate(async () => {
      if (!specialty.trim() || saving) return;
      setSaving(true);
      const priceFrom = Number(price) || 0;
      const payload = { specialty: specialty.trim(), bio: bio.trim(), priceFrom, name: profile.name || 'Müəllim', homeGymId: profile.homeGymId };

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
                ? `Profil saxlanıldı, amma şəkil yüklənmədi. ${why}`
                : 'Profil saxlanıldı, amma şəkil yüklənmədi — yenidən cəhd et';
            }
          }
        } catch {
          setSync('unsynced');
        }
      }
      setSaving(false);

      if (!hasSupabaseConfig) {
        toast('Cihazda saxlanıldı — server bağlantısı olmadan başqaları səni görmür', 'info');
      } else if (serverOk && photoFailMsg) {
        toast(photoFailMsg, 'error');
      } else if (serverOk) {
        toast(alreadyTrainer ? 'Müəllim profilin yeniləndi' : 'Müəllim profilin yaradıldı');
      } else {
        toast('Serverə yazmaq alınmadı — cihazda saxlanıldı, sonra «Yenidən sinxronla» ilə cəhd et', 'error');
      }

      if (alreadyTrainer) {
        // Closing the screen on a failed write would take away the very
        // «Yenidən sinxronla» button the error toast points at.
        if (serverOk || !hasSupabaseConfig) router.back();
      } else {
        setMode('trainer');
        router.replace('/trainer');
      }
    }, 'Müəllim hesabı üçün');

  const resync = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const trainerId = await publishTrainer({ specialty: specialty.trim(), bio: bio.trim(), priceFrom: Number(price) || 0, name: profile.name || 'Müəllim', homeGymId: profile.homeGymId });
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
            why ? `Profil sinxronlaşdı, amma şəkil yüklənmədi. ${why}` : 'Profil sinxronlaşdı, amma şəkil yüklənmədi — yenidən cəhd et',
            'error'
          );
          return;
        }
      }
      toast('Serverlə sinxronlaşdırıldı');
    } catch {
      setSync('unsynced');
      toast('Sinxronlaşma alınmadı — internetini yoxla', 'error');
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
      'Müəllim hesabını bağlamaq?',
      'Müəllim paneli bağlanacaq, elanın Kəşf bölməsindən dərhal çıxarılacaq və cavabsız şagird sorğuların bitmiş kimi işarələnəcək.',
      [
        { label: 'Ləğv et', style: 'cancel' },
        {
          label: 'Bağla',
          style: 'destructive',
          onPress: async () => {
            setProfile({ role: 'user' });
            setMode('user');
            if (!hasSupabaseConfig) {
              toast('Müəllim hesabı bu cihazda bağlandı — serverdə elanın toxunulmadı', 'info');
              router.replace('/(tabs)/profile');
              return;
            }
            let requestsClosed = false;
            let unlisted = false;
            try {
              const me = await getMyProfile();
              if (!me?.id) throw new Error('no profile');
              const { error: rErr } = await supabase.from('profiles').update({ role: 'user' }).eq('id', me.id);
              if (rErr) throw rErr;

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
              toast('Müəllim hesabı bağlandı — elanın Kəşfdən çıxarıldı, açıq sorğular bitirildi');
            } else if (unlisted) {
              toast('Elanın Kəşfdən çıxarıldı, amma şagird sorğuları bağlanmadı — dəstəyə yaz', 'error');
            } else {
              toast('Hesab bu cihazda bağlandı, amma elanın hələ Kəşfdə görünür — yenidən cəhd et', 'error');
            }
            router.replace('/(tabs)/profile');
          },
        },
      ]
    );

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title={alreadyTrainer ? 'Müəllim profili' : 'Müəllim ol'} />
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
          Öz təlim xidmətini yarat. İstifadəçilər səni Kəşf bölməsində tapıb məşq sorğusu göndərə biləcək. Qiymət yalnız məlumat üçündür — SPOT ödəniş qəbul etmir.
        </AppText>

        {alreadyTrainer ? (
          <View style={styles.statusCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon
                name={sync === 'unsynced' ? 'shield' : status === 'approved' && badge ? 'verified' : 'clock'}
                size={17}
                color={sync === 'unsynced' ? palette.red : status === 'approved' && badge ? palette.blue : '#FF9500'}
              />
              <AppText style={{ fontSize: 14, fontWeight: '600', flex: 1 }}>
                {!hasSupabaseConfig
                  ? 'Yalnız bu cihazda'
                  : sync === 'checking'
                    ? 'Yoxlanılır…'
                    : sync === 'unsynced'
                      ? 'Serverlə sinxronlaşdırılmayıb'
                      : status === 'approved'
                        ? badge
                          ? 'Doğrulanmış müəllim'
                          : 'Nişan profilində görünmür'
                        : status === 'rejected'
                          ? 'Doğrulama rədd edilib'
                          : status === 'pending'
                            ? 'Doğrulama yoxlanılır'
                            : 'Doğrulama başlanmayıb'}
              </AppText>
            </View>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 8 }}>
              {!hasSupabaseConfig
                ? 'Server bağlantısı yoxdur — müəllim elanın hələ başqalarına görünmür.'
                : sync === 'unsynced'
                  ? 'Elanın serverdə yoxdur, ona görə istifadəçilər səni tapa bilmir. Yenidən sinxronla.'
                  : status === 'approved' && !badge
                    ? 'Doğrulama sorğun təsdiqlənib, amma elanında mavi nişan yoxdur. Müəllim doğrulanması səhifəsindən yenidən müraciət et.'
                    : 'Doğrulama statusunu və sənədləri Müəllim doğrulanması səhifəsində görə bilərsən.'}
            </AppText>
            <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
              {sync === 'unsynced' && hasSupabaseConfig ? (
                <PressableScale
                  activeScale={0.97}
                  accessibilityRole="button"
                  accessibilityLabel="Yenidən sinxronla"
                  disabled={saving}
                  onPress={resync}
                  style={[styles.smallBtn, { backgroundColor: palette.ink }, saving && { opacity: 0.5 }]}>
                  <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>Yenidən sinxronla</AppText>
                </PressableScale>
              ) : null}
              <PressableScale
                activeScale={0.97}
                accessibilityRole="button"
                accessibilityLabel="Müəllim doğrulanmasını aç"
                onPress={() => router.push('/trainer/verify')}
                style={[styles.smallBtn, { backgroundColor: palette.element }]}>
                <AppText style={{ color: palette.inkText, fontSize: 13, fontWeight: '600' }}>Doğrulanma</AppText>
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
            accessibilityLabel="Profil şəklini seç"
            onPress={changePhoto}
            style={[styles.photoWrap, photoBusy && { opacity: 0.6 }]}>
            <Avatar name={profile.name || 'Müəllim'} size={76} uri={photoLocal ?? photoUrl} />
            <View style={styles.camBadge}>
              <Icon name="cam" size={13} color={palette.white} />
            </View>
          </PressableScale>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">Profil şəkli</AppText>
            <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 4 }}>
              {photoLocal
                ? 'Şəkil seçildi — «Yadda saxla» ilə yüklənəcək.'
                : 'Kəşf → Müəllimlər siyahısında və profilində bu şəkil görünür. Üzü aydın görünən şəkil daha çox sorğu gətirir.'}
            </AppText>
            <PressableScale
              activeScale={0.97}
              disabled={photoBusy}
              accessibilityRole="button"
              accessibilityLabel="Şəkli dəyiş"
              onPress={changePhoto}
              style={[styles.photoBtn, photoBusy && { opacity: 0.5 }]}>
              <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>
                {photoBusy ? 'Yüklənir…' : photoLocal || photoUrl ? 'Şəkli dəyiş' : 'Şəkil əlavə et'}
              </AppText>
            </PressableScale>
          </View>
        </View>

        <Field label="İxtisas *" value={specialty} onChangeText={setSpecialty} placeholder="Məs: Güc və hipertrofiya, Funksional…" />
        <Field label="Sessiya qiyməti (₼, məlumat üçün)" value={price} onChangeText={setPrice} placeholder="Məs: 30" keyboardType="numeric" />
        <Field label="Haqqında" value={bio} onChangeText={setBio} placeholder="Təcrübən, yanaşman, kimlərlə işləyirsən…" multiline />

        {alreadyTrainer ? (
          <PressableScale
            activeScale={0.98}
            accessibilityRole="button"
            accessibilityLabel="Müəllim hesabını bağla"
            onPress={closeAccount}
            style={styles.dangerRow}>
            <Icon name="x" size={17} color={palette.red} />
            <AppText style={{ fontSize: 14.5, fontWeight: '600', color: palette.red }}>Müəllim hesabını bağla</AppText>
          </PressableScale>
        ) : null}
      </ScrollView>
      {/* The scroller shrinks to whatever this row leaves it, so lifting the row by the
          keyboard overlap carries the whole form with it. */}
      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 8, marginBottom: lift }}>
        <Button
          title={alreadyTrainer ? 'Yadda saxla' : 'Müəllim profilini yarat'}
          variant="volt"
          full
          disabled={!specialty.trim() || saving}
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
