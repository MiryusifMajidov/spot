import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PlaceholderImage } from '@/components/PlaceholderImage';
import { SpotMap } from '@/components/SpotMap';
import { HoursField, composeHours } from '@/components/HoursField';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { createGym } from '@/lib/api';
import { errorFeedback, successFeedback, tapFeedback } from '@/lib/feedback';
import { addGymPhoto, pickImage, removeGymPhoto, setGymCover, shootImage } from '@/lib/images';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { actionSheet, confirm, toast, type UiAction } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';

const AMENITIES = ['Sərbəst ağırlıq', 'Kardio', 'Duş', 'Park', 'Sauna', 'Hovuz', 'Qadın zonası', 'Kafe'];

type Coords = { lat: number; lng: number };


export default function CreateGym() {
  const router = useRouter();
  const setOwnsGym = useAppStore((s) => s.setOwnsGym);
  const setMode = useAppStore((s) => s.setMode);
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  /* Structured, not free text: both the check-in screen and the server parse
     this string to decide whether the gym is open, and «Kəşf» filters on it. */
  const [hrs, setHrs] = useState({ always: false, open: '08:00', close: '24:00' });
  const hours = composeHours(hrs.always, hrs.open, hrs.close);
  const [priceMonth, setPriceMonth] = useState('');
  const [dayPass, setDayPass] = useState('');
  const [amenities, setAmenities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Cover photo: held locally until there is a gym row to attach it to.
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  // Location — required: a gym with no coordinates cannot appear on the customer map.
  const [picked, setPicked] = useState<Coords | null>(null);
  /* A pin is required — but only while the map can actually be used. If Leaflet or
     the OSM tiles never load, refusing to register the gym would leave the owner
     with no way in at all, so the requirement lifts and the pin is set later from
     the panel. */
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const locationBlocks = mapStatus !== 'failed' && !picked;
  const [locating, setLocating] = useState(false);
  // Bumped only when WE move the pin (GPS): the map bakes its pin in at mount,
  // so it must remount to show a pin the user did not place by hand.
  const [mapKey, setMapKey] = useState(0);

  // After the row exists: the gym id, its gallery, and whether the pin got saved.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [locSaved, setLocSaved] = useState(true);

  // Keyboard: lift the register button clear of it and push the content up by the same
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

  const toggle = (a: string) => setAmenities((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

  const chooseCover = () => {
    tapFeedback();
    const actions: UiAction[] = [
      {
        label: 'Kamera',
        onPress: async () => {
          const uri = await shootImage();
          if (uri) setCoverUri(uri);
        },
      },
      {
        label: 'Qalereyadan seç',
        onPress: async () => {
          const uri = await pickImage();
          if (uri) setCoverUri(uri);
        },
      },
    ];
    if (coverUri) actions.push({ label: 'Şəkli sil', style: 'destructive', onPress: () => setCoverUri(null) });
    actions.push({ label: 'Ləğv et', style: 'cancel' });
    actionSheet({ title: 'Zalın şəkli', message: 'Zalın içindən çəkilmiş bir şəkil müştəriyə ən çox məlumat verir.', actions });
  };

  /** Retry a cover upload that failed after the gym row was already created. */
  const retryCover = async () => {
    if (!createdId || !coverUri || coverBusy) return;
    setCoverBusy(true);
    try {
      await setGymCover(createdId, coverUri);
      setCoverFailed(false);
      successFeedback();
    } catch {
      errorFeedback();
      toast('Şəkil yüklənmədi — yenidən cəhd et', 'error');
    }
    setCoverBusy(false);
  };

  const useMyLocation = async () => {
    if (locating) return;
    tapFeedback();
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        toast('Məkan icazəsi verilmədi — pini xəritədə özün qoy', 'error');
      } else {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setPicked({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMapKey((k) => k + 1);
        successFeedback();
      }
    } catch {
      toast('Məkan alınmadı — xəritədə özün seç', 'error');
    }
    setLocating(false);
  };

  const addPhoto = (from: 'cam' | 'lib') => async () => {
    if (!createdId) return;
    const uri = from === 'cam' ? await shootImage() : await pickImage();
    if (!uri) return;
    setPhotoBusy(true);
    try {
      setPhotos(await addGymPhoto(createdId, uri));
      successFeedback();
    } catch {
      errorFeedback();
      toast('Şəkil yüklənmədi — yenidən cəhd et', 'error');
    }
    setPhotoBusy(false);
  };

  const addPhotoSheet = () => {
    tapFeedback();
    actionSheet({
      title: 'Zal şəkli əlavə et',
      actions: [
        { label: 'Kamera', onPress: addPhoto('cam') },
        { label: 'Qalereyadan seç', onPress: addPhoto('lib') },
        { label: 'Ləğv et', style: 'cancel' },
      ],
    });
  };

  const dropPhoto = (url: string) => {
    if (!createdId) return;
    confirm('Şəkli sil?', undefined, [
      { label: 'Ləğv et', style: 'cancel' },
      {
        label: 'Sil',
        style: 'destructive',
        onPress: async () => {
          setPhotoBusy(true);
          try {
            setPhotos(await removeGymPhoto(createdId, url));
          } catch {
            errorFeedback();
            toast('Şəkil silinmədi — yenidən cəhd et', 'error');
          }
          setPhotoBusy(false);
        },
      },
    ]);
  };

  /**
   * A gym account is a server-side account: the `gyms` row (owner_id) is what makes
   * someone an owner. So we never flip `ownsGym` without a real gym id — a gym
   * panel with no gym behind it would have nothing honest to show. Ownership
   * verification is NOT filed here: the gym starts `unclaimed` and the owner sends
   * the VÖEN application himself from /gym/claim.
   */
  const save = async () => {
    if (!name.trim() || locationBlocks || saving) return;
    if (!hasSupabaseConfig) {
      toast('Zal qeydiyyatı üçün internet bağlantısı lazımdır', 'error');
      return;
    }
    if (!hours) {
      // Refused rather than stored half-written: an unreadable window silently
      // drops the gym out of the «24 saat» filter and breaks check-in.
      toast('İş saatlarını tam yaz — məsələn 06:00 və 24:00', 'error');
      return;
    }
    setSaving(true);
    let gymId: string;
    try {
      gymId = await createGym({
        name: name.trim(),
        district: district.trim(),
        hours,
        priceMonth: Number(priceMonth) || 0,
        dayPass: Number(dayPass) || 0,
        amenities,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : '';
      errorFeedback();
      setSaving(false);
      if (reason === 'gym-exists') {
        // The row is already there — a second one would brick the panel. Send the
        // owner into the gym he already has instead of asking him to try again.
        toast('Bu hesabda artıq zal var', 'error');
        setOwnsGym(true);
        setMode('gym_admin');
        router.replace('/gym');
        return;
      }
      if (reason === 'no profile') {
        toast('Hesab profilin oxunmadı — çıxış edib yenidən daxil ol', 'error');
        return;
      }
      toast('Zal qeydiyyata alınmadı — bağlantını yoxlayıb yenidən cəhd et', 'error');
      return;
    }
    if (!gymId) {
      errorFeedback();
      toast('Zal qeydiyyata alınmadı — yenidən cəhd et', 'error');
      setSaving(false);
      return;
    }

    // Coordinates live on the gym row; a trigger syncs the PostGIS column the
    // customer map queries. If the column is missing we say so — never pretend.
    if (picked) {
      const { error: locError } = await supabase.from('gyms').update({ lat: picked.lat, lng: picked.lng }).eq('id', gymId);
      setLocSaved(!locError);
    } else {
      setLocSaved(false); // map never loaded — the owner sets the pin from the panel
    }

    if (coverUri) {
      setCoverBusy(true);
      try {
        await setGymCover(gymId, coverUri);
        setCoverFailed(false);
      } catch {
        setCoverFailed(true);
      }
      setCoverBusy(false);
    }

    // Only now is there a real gym to administer: open the gym account and switch in.
    // Every gym screen resolves this gym again from the server (gyms.owner_id).
    setOwnsGym(true);
    setMode('gym_admin');
    setCreatedId(gymId);
    setSaving(false);
    successFeedback();
  };

  // ------------------------------------------------------------ created ----
  if (createdId) {
    return (
      <Screen edges={['top', 'bottom']}>
        <NavBar title="Zal yaradıldı" />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.doneCard}>
            <Icon name="check" size={22} color={palette.voltDeep} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 15, fontWeight: '600' }}>{name.trim()} qeydə alındı</AppText>
              <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.tertiary, marginTop: 3 }}>
                Zal panelin açıqdır — amma zal HƏLƏ Kəşfdə görünmür. Tətbiqdən yaradılan zallar moderator baxandan sonra siyahıya düşür; bu, spam və saxta zalların qarşısını alır. Sahiblik təsdiqi ayrı addımdır — VÖEN-i özün göndərməlisən.
              </AppText>
            </View>
          </View>

          <PressableScale
            activeScale={0.98}
            accessibilityRole="button"
            accessibilityLabel="Sahiblik təsdiqini göndər"
            onPress={() => {
              tapFeedback();
              router.push('/gym/claim');
            }}
            style={styles.claimRow}>
            <Icon name="shield" size={18} color={palette.inkText} />
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 14, fontWeight: '600' }}>Sahiblik təsdiqini göndər</AppText>
              <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.tertiary, marginTop: 2 }}>
                VÖEN və ya qeydiyyat nömrəsini yaz — admin komandası yoxlayacaq.
              </AppText>
            </View>
            <Icon name="chevR" size={16} color={palette.tertiary} />
          </PressableScale>

          {!locSaved ? (
            <AppText style={styles.warn}>
              Xəritədəki yer saxlanılmadı — zal panelindən «Profil → Zalın yeri» ilə pini yenidən qoy, əks halda zal
              müştəri xəritəsində görünməyəcək.
            </AppText>
          ) : null}

          <AppText variant="footnote" color={palette.caption} style={styles.sectionLabel}>
            Zalın şəkli
          </AppText>
          <View style={styles.coverWrap}>
            {coverUri ? (
              <Image source={{ uri: coverUri }} style={styles.cover} contentFit="cover" transition={120} />
            ) : (
              <PlaceholderImage height={168} icon="cam" style={styles.cover} />
            )}
            {coverBusy ? (
              <View style={styles.coverBusy}>
                <ActivityIndicator color={palette.white} />
              </View>
            ) : null}
          </View>
          {coverFailed ? (
            <View style={{ marginTop: 8 }}>
              <AppText style={styles.warn}>Şəkil yüklənmədi — yenidən cəhd et.</AppText>
              <Button title={coverBusy ? 'Yüklənir…' : 'Şəkli yenidən yüklə'} variant="secondary" disabled={coverBusy} onPress={retryCover} />
            </View>
          ) : null}

          <AppText variant="footnote" color={palette.caption} style={[styles.sectionLabel, { marginTop: 22 }]}>
            Daha çox şəkil
          </AppText>
          <AppText style={styles.hint}>Zalın zalları, avadanlıq, duş — nə qədər çox real şəkil, o qədər çox üzv.</AppText>
          <Gallery photos={photos} busy={photoBusy} onAdd={addPhotoSheet} onRemove={dropPhoto} />

          <View style={{ height: 20 }} />
          <Button
            title="Zal panelinə keç"
            variant="volt"
            full
            onPress={() => {
              tapFeedback();
              router.replace('/gym');
            }}
          />
          <AppText style={[styles.hint, { marginTop: 12, textAlign: 'center' }]}>
            Şəkilləri və yeri sonra da zal profilindən dəyişə bilərsən.
          </AppText>
        </ScrollView>
      </Screen>
    );
  }

  // ---------------------------------------------------------- the form ----
  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Zal əlavə et" />
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}>
        {/* Cover photo */}
        <AppText variant="footnote" color={palette.caption} style={styles.sectionLabel}>
          Zalın şəkli
        </AppText>
        <PressableScale activeScale={0.98} onPress={chooseCover} style={styles.coverWrap}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.cover} contentFit="cover" transition={120} />
          ) : (
            <PlaceholderImage height={168} icon="cam" style={styles.cover} />
          )}
          <View style={styles.coverBadge}>
            <Icon name={coverUri ? 'edit' : 'plus'} size={13} color={palette.white} />
            <AppText style={{ color: palette.white, fontSize: 12, fontWeight: '600' }}>
              {coverUri ? 'Şəkli dəyiş' : 'Şəkil əlavə et'}
            </AppText>
          </View>
        </PressableScale>
        <AppText style={styles.hint}>Şəkil zal yaradıldıqdan sonra yüklənir. Qalereyanı da o zaman əlavə edəcəksən.</AppText>

        <View style={{ height: 20 }} />
        <Field label="Zalın adı *" value={name} onChangeText={setName} placeholder="Məs: Titan Fitness" />
        <Field label="Rayon / ünvan" value={district} onChangeText={setDistrict} placeholder="Məs: Nərimanov" />
        <HoursField always={hrs.always} open={hrs.open} close={hrs.close} onChange={setHrs} />
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Aylıq (₼)" value={priceMonth} onChangeText={setPriceMonth} placeholder="45" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Günlük (₼)" value={dayPass} onChangeText={setDayPass} placeholder="5" keyboardType="numeric" />
          </View>
        </View>

        {/* Location — required */}
        <AppText variant="footnote" color={palette.caption} style={styles.sectionLabel}>
          Zalın yeri *
        </AppText>
        <AppText style={[styles.hint, { marginBottom: 10 }]}>
          Xəritəyə toxunub pini zalın üstünə qoy — pini basıb sürüşdürərək dəqiqləşdirə bilərsən.
        </AppText>
        <SpotMap
          key={mapKey}
          pickable
          picked={picked}
          center={picked ?? undefined}
          zoom={picked ? 16 : 12}
          onPick={setPicked}
          onStatus={setMapStatus}
          style={styles.map}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              title={locating ? 'Axtarılır…' : 'Mövcud yerimi istifadə et'}
              variant="secondary"
              full
              disabled={locating}
              onPress={useMyLocation}
            />
          </View>
        </View>
        {picked ? (
          <View style={styles.pinRow}>
            <Icon name="pin" size={14} color={palette.voltDeep} />
            <AppText style={{ fontSize: 12.5, color: palette.textSecondary }}>
              Pin qoyuldu · {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
            </AppText>
          </View>
        ) : (
          <AppText style={[styles.hint, { marginTop: 10 }]}>
            {mapStatus === 'failed'
              ? 'Xəritə açılmadı, ona görə yeri indi seçmək olmur. Zalı indi qeydiyyata ala bilərsən — pini sonra zal panelindən qoyarsan. Pin qoyulana qədər zal müştəri xəritəsində görünməyəcək.'
              : 'Pin qoyulmadan zalı qeydiyyata almaq olmur — koordinatı olmayan zal müştəri xəritəsində görünmür.'}
          </AppText>
        )}

        <View style={{ height: 22 }} />
        <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 10, fontWeight: '600' }}>
          İmkanlar
        </AppText>
        <View style={styles.chips}>
          {AMENITIES.map((a) => {
            const on = amenities.includes(a);
            return (
              <PressableScale key={a} activeScale={0.95} onPress={() => toggle(a)} style={[styles.chip, on && styles.chipOn]}>
                <AppText style={{ fontSize: 13, fontWeight: '600', color: on ? palette.inkText : palette.textSecondary }}>{a}</AppText>
              </PressableScale>
            );
          })}
        </View>
      </ScrollView>
      {/* The scroller shrinks to whatever this block leaves it, so lifting the block by
          the keyboard overlap carries the whole form with it. */}
      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 8, marginBottom: lift }}>
        <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 10, lineHeight: 17 }}>
          Qiymətlər yalnız məlumat üçündür — SPOT ödəniş qəbul etmir və komissiya tutmur. Qeydiyyatdan sonra zal
          paneli açılır; sahiblik təsdiqi ayrıca addımdır və onu sonra özün göndərirsən.
        </AppText>
        <Button
          title={saving ? 'Göndərilir…' : 'Zalı qeydiyyata al'}
          variant="volt"
          full
          disabled={!name.trim() || locationBlocks || saving}
          onPress={save}
        />
      </View>
    </Screen>
  );
}

/** Horizontal thumbnails + a «+» tile. Each photo is already on the server. */
function Gallery({
  photos,
  busy,
  onAdd,
  onRemove,
}: {
  photos: string[];
  busy: boolean;
  onAdd: () => void;
  onRemove: (url: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
      {photos.map((url) => (
        <View key={url} style={styles.thumbWrap}>
          <Image source={{ uri: url }} style={styles.thumb} contentFit="cover" transition={120} />
          <PressableScale activeScale={0.9} onPress={() => onRemove(url)} style={styles.thumbX}>
            <Icon name="x" size={12} color={palette.white} />
          </PressableScale>
        </View>
      ))}
      <PressableScale activeScale={0.95} disabled={busy} onPress={onAdd} style={styles.addTile}>
        {busy ? <ActivityIndicator color={palette.tertiary} /> : <Icon name="plus" size={22} color={palette.tertiary} />}
      </PressableScale>
    </ScrollView>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType }: { label: string; value: string; onChangeText: (t: string) => void; placeholder: string; keyboardType?: 'numeric' }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 8, fontWeight: '600' }}>
        {label}
      </AppText>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={palette.caption} keyboardType={keyboardType} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 24 },
  input: { backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: palette.inkText, borderWidth: 1, borderColor: palette.separator },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: { backgroundColor: palette.white, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: palette.separator },
  chipOn: { backgroundColor: palette.volt, borderColor: palette.volt },
  sectionLabel: { marginBottom: 8, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17, color: palette.tertiary, marginTop: 8 },
  warn: { fontSize: 12.5, lineHeight: 18, color: '#FF9500', marginBottom: 10, fontWeight: '500' },
  coverWrap: { borderRadius: 16, overflow: 'hidden', backgroundColor: palette.grouped },
  cover: { width: '100%', height: 168 },
  coverBadge: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(11,11,14,0.72)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  coverBusy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,11,14,0.45)' },
  map: { height: 240, borderRadius: 16 },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  thumbWrap: { width: 92, height: 92, borderRadius: 12, overflow: 'hidden', backgroundColor: palette.grouped },
  thumb: { width: '100%', height: '100%' },
  thumbX: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(11,11,14,0.7)' },
  addTile: { width: 92, height: 92, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, borderStyle: 'dashed' },
  doneCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14, marginBottom: 18 },
  claimRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14, marginBottom: 18 },
});
