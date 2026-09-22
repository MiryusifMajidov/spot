import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PlaceholderImage } from '@/components/PlaceholderImage';
import { SpotMap } from '@/components/SpotMap';
import { HoursField, composeHours, splitHours } from '@/components/HoursField';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { errorFeedback, successFeedback, tapFeedback } from '@/lib/feedback';
import { GymGate, updateMyGym, useMyGym } from '@/lib/gymOwner';
import { addGymPhoto, imageTooLargeMessage, isNotSavedError, pickImage, removeGymPhoto, setGymCover, shootImage } from '@/lib/images';
import { supabase } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { actionSheet, confirm, toast, useUi, type UiAction } from '@/store/ui';
import { palette, spacing } from '@/theme';

type Coords = { lat: number; lng: number };

const AMENITIES = ['Sərbəst ağırlıq', 'Kardio', 'Duş', 'Parkinq', 'Hovuz', 'Sauna', 'Qadın zonası', 'Kafe'];

export default function GymEdit() {
  const t = useT();
  const router = useRouter();
  const navigation = useNavigation();
  const keyboardLift = useKeyboardLift();
  const state = useMyGym();
  const gym = state.gym;

  // This editor lives inside the gym Tabs navigator. If the tab bar stayed
  // visible, tapping «Üzvlər» would leave the form without ever running the
  // unsaved-changes guard in back() and every edit would be lost silently. The
  // bar is hidden while the editor is focused, so the chevron (which does ask)
  // is the only way out. The bar comes back by itself: it is read from the
  // focused route's options, and only THIS route sets display:'none'.
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: { display: 'none' } } as never);
  }, [navigation]);

  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  /* Structured, not free text — see components/HoursField. */
  const [hrs, setHrs] = useState({ always: false, open: '', close: '' });
  const hours = composeHours(hrs.always, hrs.open, hrs.close);
  const [about, setAbout] = useState('');
  const [monthly, setMonthly] = useState('');
  const [daypass, setDaypass] = useState('');
  const [amenities, setAmenities] = useState<string[]>([]);
  /* The owner's two gym-page switches (gyms.allow_day_pass / show_members).
     They were on OwnedGym with no control anywhere, and the public page never
     read them — two settings nobody could set, honoured by nobody. */
  const [allowDayPass, setAllowDayPass] = useState(true);
  const [showMembers, setShowMembers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Media + location live on the gym row but are not part of OwnedGym, so they
  // are read straight from the table here.
  const [cover, setCover] = useState<string | null>(null);
  /* Whether `cover` is an ANSWER. Until the read succeeds a null cover means
     «not known», and «Əsas şəkil əlavə et» over a gym that has a photo is a
     claim we never checked. */
  const [coverRead, setCoverRead] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [coverBusy, setCoverBusy] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [picked, setPicked] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  /** false when the photos/lat/lng columns are not in the database yet. */
  const [extrasOk, setExtrasOk] = useState(true);
  // The map bakes its pin in at mount, so it must remount when WE move the pin.
  const [mapKey, setMapKey] = useState(0);

  const gymId = gym?.id;

  // `dirty` in a ref so the seeding effect can read it without re-running. The
  // ref is put in step from an effect and not from the render body, because a
  // render React throws away must not be able to tell the seeding effect that
  // the form is dirty. It is declared above that effect, so in any commit where
  // both run the flag is already current by the time the seeding effect reads it.
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // Seed the form from the gym's REAL row (never from literals). A focus refetch
  // hands back a NEW gym object, so this effect re-runs while the owner is still
  // typing — it must not overwrite unsaved input with the old server values.
  useEffect(() => {
    if (!gym || dirtyRef.current) return;
    setName(gym.name);
    setDistrict(gym.district);
    setHrs(splitHours(gym.hours));
    setAbout(gym.about);
    setMonthly(gym.priceMonth ? String(gym.priceMonth) : '');
    setDaypass(gym.dayPass ? String(gym.dayPass) : '');
    setAmenities(gym.amenities);
    setAllowDayPass(gym.allowDayPass);
    setShowMembers(gym.showMembers);
    setDirty(false);
  }, [gym]);

  // Cover / gallery / pin. The gallery + coordinate columns ship with a later
  // migration, so they are read separately: a missing column must not cost us
  // the cover photo too.
  useEffect(() => {
    if (!gymId) return;
    let alive = true;
    (async () => {
      const base = await supabase.from('gyms').select('image_url').eq('id', gymId).maybeSingle();
      if (!alive) return;
      if (base.error) {
        setCoverRead('failed');
      } else {
        setCover(((base.data as { image_url?: string | null } | null)?.image_url as string) ?? null);
        setCoverRead('ok');
      }

      const extra = await supabase.from('gyms').select('photos, lat, lng').eq('id', gymId).maybeSingle();
      if (!alive) return;
      if (extra.error) {
        setExtrasOk(false);
      } else {
        const r = (extra.data ?? {}) as { photos?: string[] | null; lat?: number | null; lng?: number | null };
        setPhotos(Array.isArray(r.photos) ? r.photos : []);
        setPicked(r.lat != null && r.lng != null ? { lat: Number(r.lat), lng: Number(r.lng) } : null);
        setExtrasOk(true);
      }
      setMediaReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [gymId]);

  const mark = <T,>(setter: (v: T) => void) => (v: T) => {
    setDirty(true);
    setter(v);
  };

  const toggleAmenity = (a: string) => {
    setDirty(true);
    setAmenities((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  };

  // --- photos: uploaded the moment they are chosen (they need no «Saxla») ---
  const applyCover = async (uri: string) => {
    if (!gymId) return;
    setCoverBusy(true);
    try {
      setCover(await setGymCover(gymId, uri));
      successFeedback();
    } catch (e) {
      errorFeedback();
      /* The one failure retrying cannot fix: the file is over the bucket ceiling
         and will be over it again next time. «yenidən cəhd et» made the owner
         re-pick the same photo; this says the size and the limit instead. */
      toast(
        imageTooLargeMessage(e) ??
          (isNotSavedError(e)
            ? t('Şəkil zalın məlumatına yazılmadı — bu zalı dəyişməyə icazən yoxdur')
            : t('Şəkil yüklənmədi — yenidən cəhd et')),
        'error'
      );
    }
    setCoverBusy(false);
  };

  const chooseCover = () => {
    tapFeedback();
    const actions: UiAction[] = [
      {
        label: t('Kamera'),
        onPress: async () => {
          const uri = await shootImage();
          if (uri) applyCover(uri);
        },
      },
      {
        label: t('Qalereyadan seç'),
        onPress: async () => {
          const uri = await pickImage();
          if (uri) applyCover(uri);
        },
      },
      { label: t('Ləğv et'), style: 'cancel' },
    ];
    actionSheet({ title: t('Zalın əsas şəkli'), actions });
  };

  const addPhoto = (from: 'cam' | 'lib') => async () => {
    if (!gymId) return;
    const uri = from === 'cam' ? await shootImage() : await pickImage();
    if (!uri) return;
    setPhotoBusy(true);
    try {
      setPhotos(await addGymPhoto(gymId, uri));
      successFeedback();
    } catch (e) {
      errorFeedback();
      toast(
        imageTooLargeMessage(e) ??
          (isNotSavedError(e)
            ? t('Şəkil zalın məlumatına yazılmadı — bu zalı dəyişməyə icazən yoxdur')
            : t('Şəkil yüklənmədi — yenidən cəhd et')),
        'error'
      );
    }
    setPhotoBusy(false);
  };

  const addPhotoSheet = () => {
    tapFeedback();
    actionSheet({
      title: t('Şəkil əlavə et'),
      actions: [
        { label: t('Kamera'), onPress: addPhoto('cam') },
        { label: t('Qalereyadan seç'), onPress: addPhoto('lib') },
        { label: t('Ləğv et'), style: 'cancel' },
      ],
    });
  };

  const dropPhoto = (url: string) => {
    if (!gymId) return;
    confirm(t('Şəkli sil?'), undefined, [
      { label: t('Ləğv et'), style: 'cancel' },
      {
        label: t('Sil'),
        style: 'destructive',
        onPress: async () => {
          setPhotoBusy(true);
          try {
            setPhotos(await removeGymPhoto(gymId, url));
          } catch {
            errorFeedback();
            toast(t('Şəkil silinmədi — yenidən cəhd et'), 'error');
          }
          setPhotoBusy(false);
        },
      },
    ]);
  };

  const movePin = (p: Coords) => {
    setDirty(true);
    setPicked(p);
  };

  const useMyLocation = async () => {
    if (locating) return;
    tapFeedback();
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast(t('Məkan icazəsi verilmədi — pini xəritədə özün qoy'), 'error');
      } else {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPicked({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setDirty(true);
        setMapKey((k) => k + 1);
        successFeedback();
      }
    } catch {
      toast(t('Məkan alınmadı — xəritədə özün seç'), 'error');
    }
    setLocating(false);
  };

  // `setDirty(false)` before leaving: this screen is inside a Tabs navigator and
  // stays mounted, so a form still marked dirty kept blocking the re-seed effect —
  // coming back showed the abandoned edits as though they had been saved.
  const discardAndLeave = () => {
    setDirty(false);
    router.back();
  };

  const back = () => {
    if (!dirty) return router.back();
    confirm(t('Dəyişikliklər saxlanılmayıb'), t('Saxlamadan çıxmaq istəyirsən?'), [
      { label: t('Qal'), style: 'cancel' },
      { label: t('Çıx'), style: 'destructive', onPress: discardAndLeave },
    ]);
  };

  /* Android's hardware back never ran that guard.
   *
   * The tab bar above is hidden precisely so the chevron — which asks — is the
   * only way out, but the system back button is not a tab: bottom-tabs' default
   * `backBehavior` ('firstRoute') simply left for the Panel tab and unmounted the
   * form. An owner who had retyped the monthly price, rewritten «Haqqında» and
   * toggled three amenities pressed back out of habit and lost every one of them
   * without being asked anything.
   *
   * Registered on FOCUS, so it is added after React Navigation's own handler and
   * therefore runs before it (BackHandler fires the newest subscription first),
   * and removed again the moment the editor loses focus. */
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!dirtyRef.current) return false; // nothing to lose — let the system leave
        // While a dialog is open UiHost owns the back button; never stack a second one.
        if (useUi.getState().dialog) return true;
        confirm(t('Dəyişikliklər saxlanılmayıb'), t('Saxlamadan çıxmaq istəyirsən?'), [
          { label: t('Qal'), style: 'cancel' },
          { label: t('Çıx'), style: 'destructive', onPress: discardAndLeave },
        ]);
        return true;
      });
      return () => sub.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router])
  );

  const save = async () => {
    if (!gym || saving) return;
    if (!name.trim()) {
      toast(t('Zalın adı boş ola bilməz'), 'error');
      return;
    }
    if (!hours) {
      // An unreadable window drops the gym out of the «24 saat» filter and makes
      // check-in fall back to «saatı oxuya bilmədik» — so it is not saved half-written.
      toast(t('İş saatlarını tam yaz — məsələn 06:00 və 24:00'), 'error');
      return;
    }
    setSaving(true);
    try {
      // Only columns the app actually reads back are written — no decorative settings.
      // The two switches go only when they changed: updateMyGym writes them as a
      // separate UPDATE and proves it by row count (`extrasSaved`), so an
      // untouched switch can never turn a good save into a partial-failure toast.
      const { extrasSaved } = await updateMyGym(gym.id, {
        name: name.trim(),
        district: district.trim(),
        hours,
        about: about.trim(),
        price_month: Number(monthly) || 0,
        day_pass: Number(daypass) || 0,
        amenities,
        ...(allowDayPass !== gym.allowDayPass ? { allow_day_pass: allowDayPass } : {}),
        ...(showMembers !== gym.showMembers ? { show_members: showMembers } : {}),
      });
      // Coordinates are a separate write: they arrived with a later migration and
      // a failure here must not be reported as a successful profile save.
      let locOk = true;
      if (picked) {
        /* The row count as well as the error. `gyms_owner_update` filters
           instead of raising, so a refused write comes back `error: null` and
           «Zal profili yeniləndi» would have been said about a pin that never
           moved. */
        const { data: locRow, error } = await supabase
          .from('gyms').update({ lat: picked.lat, lng: picked.lng }).eq('id', gym.id).select('id');
        locOk = !error && !!locRow?.length;
      }
      setDirty(false);
      state.reload();
      if (locOk && extrasSaved) {
        successFeedback();
        toast(t('Zal profili yeniləndi'));
      } else {
        errorFeedback();
        toast(
          !locOk && !extrasSaved
            ? t('Profil yeniləndi, amma zalın yeri və zal səhifəsi seçimləri saxlanılmadı')
            : !locOk
              ? t('Profil yeniləndi, amma zalın yeri saxlanılmadı')
              : t('Profil yeniləndi, amma zal səhifəsi seçimləri saxlanılmadı'),
          'error'
        );
      }
      router.back();
    } catch {
      errorFeedback();
      toast(t('Saxlanılmadı — bağlantını yoxla'), 'error');
    }
    setSaving(false);
  };

  if (!gym) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.nav}>
          <PressableScale activeScale={0.9} onPress={() => router.back()}>
            <Icon name="chevL" size={26} color={palette.blue} />
          </PressableScale>
          <AppText variant="headline">{t('Zal profili')}</AppText>
          <View style={{ width: 40 }} />
        </View>
        <GymGate state={state} />
      </Screen>
    );
  }

  return (
    // The tab bar is hidden on this screen, so the bottom inset is ours to keep.
    <Screen edges={['top', 'bottom']}>
      <View style={styles.nav}>
        <PressableScale activeScale={0.9} onPress={back}>
          <Icon name="chevL" size={26} color={palette.blue} />
        </PressableScale>
        <AppText variant="headline">{t('Zal profilini redaktə et')}</AppText>
        <PressableScale activeScale={0.94} disabled={saving} onPress={save}>
          <AppText style={{ fontSize: 15, fontWeight: '600', color: saving ? palette.tertiary : palette.blue }}>
            {saving ? t('Saxlanılır…') : t('Saxla')}
          </AppText>
        </PressableScale>
      </View>

      {/* Android edge-to-edge never resizes the window, so without extra room at the
          end the last fields cannot be scrolled out from under the keyboard. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40 + keyboardLift }}>
        {/* Photos — uploaded immediately, no «Saxla» needed */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
            {t('ZALIN ŞƏKİLLƏRİ')}
          </AppText>
          <PressableScale activeScale={0.98} disabled={coverBusy} onPress={chooseCover} style={styles.coverWrap}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.cover} contentFit="cover" transition={120} />
            ) : (
              <PlaceholderImage height={160} icon="cam" style={styles.cover} />
            )}
            {/* «əlavə et» only once the read said there is no photo. After a failed
                read the tap still picks a new cover — that is the owner's choice —
                but the badge does not pretend the old one is missing. */}
            {cover || coverRead !== 'loading' ? (
              <View style={styles.coverBadge}>
                <Icon name={cover || coverRead === 'failed' ? 'edit' : 'plus'} size={13} color={palette.white} />
                <AppText style={{ color: palette.white, fontSize: 12, fontWeight: '600' }}>
                  {cover
                    ? t('Əsas şəkli dəyiş')
                    : coverRead === 'failed'
                      ? t('Şəkil oxunmadı · yenisini seç')
                      : t('Əsas şəkil əlavə et')}
                </AppText>
              </View>
            ) : null}
            {coverBusy ? (
              <View style={styles.coverBusy}>
                <ActivityIndicator color={palette.white} />
              </View>
            ) : null}
          </PressableScale>

          <AppText style={[styles.hint, { marginTop: 14, marginBottom: 8 }]}>{t('Qalereya')}</AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
            {photos.map((url) => (
              <View key={url} style={styles.thumbWrap}>
                <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" transition={120} />
                <PressableScale activeScale={0.9} onPress={() => dropPhoto(url)} style={styles.thumbX}>
                  <Icon name="x" size={12} color={palette.white} />
                </PressableScale>
              </View>
            ))}
            <PressableScale activeScale={0.95} disabled={photoBusy} onPress={addPhotoSheet} style={styles.addTile}>
              {photoBusy ? <ActivityIndicator color={palette.tertiary} /> : <Icon name="plus" size={22} color={palette.tertiary} />}
            </PressableScale>
          </ScrollView>
        </View>

        {/* Identity */}
        <View style={styles.listCard}>
          <TextRow label={t('Ad')} value={name} onChange={mark(setName)} placeholder={t('Zalın adı')} />
          <View style={styles.rowDiv} />
          <TextRow label={t('Rayon')} value={district} onChange={mark(setDistrict)} placeholder={t('Məs: Nərimanov')} />
          <View style={styles.rowDiv} />
          <HoursField
            always={hrs.always}
            open={hrs.open}
            close={hrs.close}
            onChange={mark(setHrs)}
          />
        </View>

        {/* Prices */}
        <View style={styles.listCard}>
          <PriceRow label={t('Aylıq')} value={monthly} onChange={mark(setMonthly)} />
          <View style={styles.rowDiv} />
          <PriceRow label={t('1 günlük')} value={daypass} onChange={mark(setDaypass)} />
        </View>
        <AppText style={styles.note}>
          {t('Qiymətlər yalnız məlumat üçündür — SPOT ödəniş qəbul etmir, komissiya tutmur, pul zalda ödənilir.')}
        </AppText>

        {/* What the public gym page shows. Saved with «Saxla», like the rest of the form. */}
        <View style={styles.listCard}>
          <SwitchRow label={t('Day-pass qəbul et')} value={allowDayPass} onChange={mark(setAllowDayPass)} />
          <View style={styles.rowDiv} />
          <SwitchRow label={t('«Üzvlər» bölməsini göstər')} value={showMembers} onChange={mark(setShowMembers)} />
        </View>
        <AppText style={styles.note}>
          {t('Day-pass düyməsi zal səhifəsində yalnız bu açıq olanda və 1 günlük qiymət yazılanda görünür. «Üzvlər» bağlı olanda zal səhifəsində üzv siyahısı göstərilmir.')}
        </AppText>

        {/* About */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
            {t('ZAL HAQQINDA')}
          </AppText>
          <TextInput
            value={about}
            onChangeText={mark(setAbout)}
            multiline
            placeholder={t('Bir neçə cümlə ilə zalını təsvir et.')}
            placeholderTextColor={palette.caption}
            style={styles.about}
          />
        </View>

        {/* Amenities */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
            {t('AVADANLIQ VƏ İMKANLAR')}
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[...new Set([...AMENITIES, ...amenities])].map((a) => {
              const on = amenities.includes(a);
              return (
                <PressableScale
                  key={a}
                  activeScale={0.95}
                  onPress={() => toggleAmenity(a)}
                  style={[styles.chip, on && { backgroundColor: palette.ink }]}>
                  <AppText style={{ fontSize: 12.5, fontWeight: '600', color: on ? palette.white : '#3A3A42' }}>{t(a)}</AppText>
                </PressableScale>
              );
            })}
          </View>
        </View>

        {/* Location on a live map */}
        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 6 }}>
            {t('ZALIN YERİ')}
          </AppText>
          <AppText style={[styles.hint, { marginBottom: 12 }]}>
            {gym.listed
              ? t('Pini zalın üstünə qoymaq üçün xəritəyə toxun — pini basıb sürüşdürərək dəqiqləşdirə bilərsən. Zal müştəri xəritəsində məhz bu nöqtədə görünür.')
              : t('Pini zalın üstünə qoymaq üçün xəritəyə toxun — pini basıb sürüşdürərək dəqiqləşdirə bilərsən. Zal Kəşfdə dərc olunanda müştəri xəritəsində bu nöqtədə görünəcək.')}
          </AppText>
          {mediaReady ? (
            <SpotMap
              key={mapKey}
              pickable
              picked={picked}
              center={picked ?? undefined}
              zoom={picked ? 16 : 12}
              onPick={movePin}
              style={styles.map}
            />
          ) : (
            <View style={[styles.map, styles.mapLoading]}>
              <ActivityIndicator color={palette.tertiary} />
            </View>
          )}
          <View style={{ marginTop: 10 }}>
            <Button
              title={locating ? t('Axtarılır…') : t('Mövcud yerimi istifadə et')}
              variant="secondary"
              full
              disabled={locating}
              onPress={useMyLocation}
            />
          </View>
          {picked ? (
            <View style={styles.pinRow}>
              <Icon name="pin" size={14} color={palette.voltDeep} />
              <AppText style={{ fontSize: 12.5, color: palette.textSecondary }}>
                {t('{lat}, {lng} · «Saxla» ilə yadda saxlanılır', {
                  lat: picked.lat.toFixed(5),
                  lng: picked.lng.toFixed(5),
                })}
              </AppText>
            </View>
          ) : mediaReady && extrasOk ? (
            <AppText style={[styles.hint, { marginTop: 10 }]}>
              {t('Hələ pin qoyulmayıb — koordinatı olmayan zal müştəri xəritəsində görünmür.')}
            </AppText>
          ) : null /* still reading, or the read failed (the warning below says so): «no pin» would be a guess */}
          {!extrasOk ? (
            <AppText style={styles.warn}>
              {t('Qalereya və xəritə koordinatları hazırda bazadan oxuna bilmir — dəyişiklik saxlanılmaya bilər.')}
            </AppText>
          ) : null}
        </View>

        <AppText style={[styles.note, styles.noteLast]}>
          {t('«Üzvlər» bölməsini yuxarıdakı açarla bütövlükdə gizlədə bilərsən. Siyahıda adının görünüb-görünməməsini isə hər üzv özü Məxfilik ayarlarından seçir — zal bunu dəyişə bilmir.')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

function TextRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.priceRow}>
      <AppText style={{ fontSize: 15, color: palette.tertiary, width: 92 }}>{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.caption}
        style={{ flex: 1, fontSize: 15, color: palette.inkText }}
      />
    </View>
  );
}

function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.priceRow}>
      <AppText style={{ flex: 1, fontSize: 15, color: palette.inkText }}>{label}</AppText>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: palette.voltDeep, false: palette.separator }} />
    </View>
  );
}

function PriceRow({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  return (
    <View style={styles.priceRow}>
      <AppText style={{ fontSize: 15, color: palette.tertiary, width: 92 }}>{label}</AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={palette.caption}
        style={{ flex: 1, fontSize: 15, color: palette.inkText }}
      />
      <AppText style={{ fontSize: 15, color: palette.textSecondary }}>₼</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  listCard: { backgroundColor: palette.white, borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  priceRow: { flexDirection: 'row', alignItems: 'center', height: 50, paddingHorizontal: 15, gap: 12 },
  rowDiv: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(60,60,67,0.12)', marginLeft: 15 },
  card: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 12 },
  about: { fontSize: 14.5, lineHeight: 21, color: palette.inkText, minHeight: 90, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F0F0F3' },
  note: { fontSize: 11.5, lineHeight: 16, color: palette.tertiary, marginTop: -4, marginBottom: 14, paddingHorizontal: 4 },
  noteLast: { marginTop: 2 },
  hint: { fontSize: 12, lineHeight: 17, color: palette.tertiary },
  warn: { fontSize: 12, lineHeight: 17, color: '#FF9500', fontWeight: '500', marginTop: 10 },
  coverWrap: { borderRadius: 14, overflow: 'hidden', backgroundColor: palette.grouped },
  cover: { width: '100%', height: 160 },
  coverBadge: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(11,11,14,0.72)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  coverBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,11,14,0.45)' },
  thumbWrap: { width: 88, height: 88, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.grouped },
  thumb: { width: '100%', height: '100%' },
  thumbX: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,11,14,0.7)' },
  addTile: { width: 88, height: 88, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.grouped, borderWidth: 1, borderColor: palette.separator, borderStyle: 'dashed' },
  map: { height: 240, borderRadius: 14 },
  mapLoading: { alignItems: 'center', justifyContent: 'center', backgroundColor: palette.grouped },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
});
