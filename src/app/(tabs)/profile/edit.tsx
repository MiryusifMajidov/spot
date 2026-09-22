import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { DAYS, GOALS, LEVELS, TIME_SLOTS, WORKOUT_TYPES } from '@/data/mock';
import { USERNAME_TAKEN_MSG, displayNameError, getMyProfile, isUsernameTaken, suggestUsername, usernameError } from '@/lib/api';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { invalidateFocusCache, invalidateFocusPrefix } from '@/lib/focusFetch';
import { useGyms } from '@/lib/hooks';
import { imageTooLargeMessage, isNotSavedError, pickImage, setMyAvatar, setTrainerPhoto, shootImage } from '@/lib/images';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useT } from '@/lib/useT';
import { useAppStore } from '@/store/appStore';
import { actionSheet, toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';

/** `avatar_url` lives on the profiles row (added by schema8) — read it defensively. */
function avatarOf(row: unknown): string | null {
  return (row as { avatar_url?: string | null } | null)?.avatar_url ?? null;
}

/**
 * Carry a rename — and a new avatar — over to the person's trainer listing.
 *
 * The listing keeps its own `name` and `photo_url`, so Kəşf → Müəllimlər went on
 * showing the old name and face after a profile edit, until the trainer profile
 * happened to be saved again. Every write is proven with `.select('id')`: an
 * RLS-filtered UPDATE comes back `error: null` with zero rows.
 *
 * The photo is uploaded again as the listing's own file rather than pointing
 * `photo_url` at the avatar's: each setter deletes the object it replaces, so a
 * shared file would vanish from one row the next time the other one changed.
 */
async function syncTrainerListing(name: string, bio: string, photoLocal: string | null): Promise<'ok' | 'failed' | 'photo-failed'> {
  let primaryId: string;
  try {
    const me = await getMyProfile();
    if (!me?.id) throw new Error('no profile');
    const { data, error: readErr } = await supabase.from('trainers').select('id,name,bio').eq('owner_id', me.id);
    if (readErr) throw readErr;
    const owned = (data ?? []) as { id: string; name: string | null; bio: string | null }[];
    // No row on the server: nothing public is showing the old name.
    if (!owned.length) return 'ok';
    // «Haqqında» is one field in this app: «Müəllim profili» edits the same
    // profile.bio and writes it to the listing. Left out here, a bio edited on
    // this screen stayed old in Kəşf — and «Müəllim profili» then (rightly)
    // reported the listing as out of step with the phone.
    if (owned.some((r) => (r.name ?? '').trim() !== name || (r.bio ?? '').trim() !== bio)) {
      const { data: saved, error } = await supabase.from('trainers').update({ name, bio }).eq('owner_id', me.id).select('id');
      if (error) throw error;
      if ((saved?.length ?? 0) < owned.length) throw new Error('listing-not-saved');
    }
    // The row whose id is the profile id is the real one (see getMyTrainerId);
    // any other is a leftover of a profile merge.
    primaryId = owned.find((r) => r.id === me.id)?.id ?? owned[0].id;
  } catch {
    return 'failed';
  }
  let photoOk = true;
  if (photoLocal) {
    try {
      await setTrainerPhoto(primaryId, photoLocal);
    } catch {
      photoOk = false;
    }
  }
  // Kəşf, the trainer's own page and the gym's trainer list each cache the row.
  invalidateFocusCache('trainers');
  invalidateFocusPrefix('trainer:');
  invalidateFocusPrefix('gymTrainers:');
  return photoOk ? 'ok' : 'photo-failed';
}


export default function EditProfile() {
  const t = useT();
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  /* Opened from the trainer panel (`from=trainer`), this screen sits on a new
     member-tabs route whose profile stack holds only this screen. router.back()
     then bubbles to the tab navigator, which switches to its first tab, Kəşf:
     the trainer saved and landed in the member app instead of the panel.
     dismissTo pops back to the panel (or replaces this screen with it). */
  const leave = () => (from === 'trainer' ? router.dismissTo('/trainer') : router.back());
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const gyms = useGyms();
  const [saving, setSaving] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const isTrainer = profile.role === 'trainer';
  // A new avatar that went up in this visit and has not reached the trainer
  // listing yet. Kept until that write succeeds, so «Yadda saxla» retries it.
  const listingPhoto = useRef<string | null>(null);
  // Handles live in local state until the save actually goes through, so a person
  // who backs out never leaves a handle behind that the server does not know about.
  const [handle, setHandle] = useState(() => {
    const p = useAppStore.getState().profile;
    return p.username ?? suggestUsername(p.name);
  });
  const [taken, setTaken] = useState<string | null>(null); // handle we know is somebody else's

  // Keyboard: shrink the scroller by the overlap, then push the content up by the same
  // amount so the field that was just tapped stays exactly where it was on screen.
  const lift = useKeyboardLift();
  const scroller = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lifted = useRef(0);
  useEffect(() => {
    const delta = lift - lifted.current;
    lifted.current = lift;
    if (delta > 0) scroller.current?.scrollTo({ y: scrollY.current + delta, animated: true });
  }, [lift]);

  // The photo lives on the server, not in the local store — read the real value.
  useEffect(() => {
    if (!hasSupabaseConfig) return;
    let alive = true;
    getMyProfile()
      .then((me) => alive && setAvatar(avatarOf(me)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const upload = async (source: 'camera' | 'library') => {
    // Not during a save: a trainer's photo reaches the listing only through that
    // save, so one landing after it would never get there.
    if (uploading || saving) return;
    let local: string | null = null;
    try {
      local = source === 'camera' ? await shootImage({ square: true }) : await pickImage({ square: true });
    } catch {
      local = null;
    }
    if (!local) return; // cancelled or permission denied — nothing to say
    if (!hasSupabaseConfig) {
      toast(t('Şəkil üçün server bağlantısı lazımdır'), 'error');
      return;
    }
    const previous = avatar;
    setAvatar(local); // instant preview
    setUploading(true);
    try {
      const url = await setMyAvatar(local);
      setAvatar(url);
      listingPhoto.current = local;
      successFeedback();
      toast(t('Profil şəklin yeniləndi'));
    } catch (e) {
      setAvatar(previous); // never leave a photo on screen that was not saved
      errorFeedback();
      /* A file over the bucket ceiling fails identically every single time, so
         «yenidən cəhd et» sent people back to tap the same photo at a wall. That
         one case names itself, and only its message can say how big the file is
         and what actually fits. */
      /* A refused write is not a flaky one. The file reached storage and the
         row would not take it, so «yenidən cəhd et» would send the person back
         to tap the same photo at the same wall. */
      toast(
        imageTooLargeMessage(e) ??
          (isNotSavedError(e)
            ? t('Şəkil serverdə saxlanılmadı — profilə yazmaq alınmadı')
            : t('Şəkil yüklənmədi — yenidən cəhd et')),
        'error'
      );
    } finally {
      setUploading(false);
    }
  };

  // A trainer's avatar replaces the listing photo on save — said up front,
  // because it may overwrite a photo chosen separately on «Müəllim profili».
  const photoNote = isTrainer
    ? t('Şəklin profilində görünür; «Yadda saxla» basanda Kəşfdəki müəllim elanına da keçir.')
    : t('Şəklin profilində görünür.');

  const changePhoto = () =>
    actionSheet({
      title: t('Profil şəkli'),
      message: photoNote,
      actions: [
        { label: t('Kamera'), onPress: () => upload('camera') },
        { label: t('Qalereya'), onPress: () => upload('library') },
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });

  const gymName = gyms.find((g) => g.id === profile.homeGymId)?.name ?? t('Seçilməyib');

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const pickGym = () =>
    actionSheet({
      title: t('Əsas zalın'),
      message: t('Yoldaş uyğunluğu buna görə hesablanır.'),
      actions: [
        ...gyms.slice(0, 12).map((g) => ({ label: g.name, onPress: () => setProfile({ homeGymId: g.id }) })),
        { label: t('Zalım yoxdur'), onPress: () => setProfile({ homeGymId: null }) },
        { label: t('Ləğv et'), style: 'cancel' as const },
      ],
    });

  const save = async () => {
    // A save mid-upload would sync the listing before the new photo is known and
    // close the screen — the photo note's promise would silently not happen.
    if (saving || uploading) return;
    const nameErr = displayNameError(profile.name);
    if (nameErr) {
      toast(t(nameErr), 'error');
      return;
    }
    const handleErr = usernameError(handle);
    if (handleErr) {
      toast(t(handleErr), 'error');
      return;
    }

    setSaving(true);
    // Ask first so the person hears «tutulub» instead of watching a save fail. If the
    // check itself cannot run we do NOT claim the handle is free — the unique index
    // below has the final word either way.
    try {
      if (await isUsernameTaken(handle)) {
        setTaken(handle.trim().toLowerCase());
        setSaving(false);
        toast(t(USERNAME_TAKEN_MSG), 'error');
        return;
      }
    } catch {
      /* offline / server unreachable — fall through to the write */
    }

    const previousHandle = profile.username;
    setProfile({ username: handle.trim() });
    const result = await saveProfile();
    // saveProfile() tells us what actually happened — we never claim more than that.
    if (result === 'failed') {
      setSaving(false);
      // The server refused it, so the phone must not start showing it either — put
      // the old handle back and stay here: the edits are still in the form to retry.
      setProfile({ username: previousHandle });
      if (useAppStore.getState().lastSaveError === 'username-taken') {
        setTaken(handle.trim().toLowerCase());
        toast(t(USERNAME_TAKEN_MSG), 'error');
      } else {
        toast(t('Serverdə saxlanılmadı — internet bağlantını yoxla və yenidən cəhd et'), 'error');
      }
      return;
    }
    // Only after a real server save: 'local' means nothing reached the server,
    // and the listing must not get ahead of the profile it copies.
    if (result === 'saved' && isTrainer) {
      // The values saveProfile() just sent, read now — not the ones this
      // render closed over before the awaits above (the name field stays
      // editable while the handle check runs).
      const sent = useAppStore.getState().profile;
      const listing = await syncTrainerListing(sent.name.trim(), (sent.bio ?? '').trim(), listingPhoto.current);
      if (listing === 'ok') listingPhoto.current = null;
      else {
        setSaving(false);
        // The profile IS saved; only the listing is behind. Stay on the screen so
        // «Yadda saxla» retries it — the photo is still held for that.
        toast(
          listing === 'photo-failed'
            ? t('Profilin saxlanıldı, amma Kəşfdəki müəllim elanında şəkil yenilənmədi — «Yadda saxla» ilə yenidən cəhd et')
            : t('Profilin saxlanıldı, amma Kəşfdəki müəllim elanın yenilənmədi — «Yadda saxla» ilə yenidən cəhd et'),
          'error'
        );
        return;
      }
    }
    setSaving(false);
    toast(result === 'local' ? t('Yadda saxlanıldı — hələlik yalnız bu cihazda') : t('Profilin yadda saxlanıldı'));
    leave();
  };

  const shownHandleErr = usernameError(handle) ?? (taken === handle.trim().toLowerCase() ? USERNAME_TAKEN_MSG : null);

  return (
    <Screen>
      <NavBar
        title={t('Profili redaktə et')}
        onBack={leave}
        right={
          <PressableScale onPress={save} disabled={saving || uploading} haptic={false} activeScale={0.94}>
            <AppText variant="headline" color={saving || uploading ? palette.tertiary : palette.blue}>
              {saving ? t('Saxlanılır…') : t('Yadda saxla')}
            </AppText>
          </PressableScale>
        }
      />
      <ScrollView
        ref={scroller}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        style={{ marginBottom: lift }}>
        <View style={styles.avatarBlock}>
          <PressableScale
            activeScale={0.96}
            disabled={uploading || saving}
            accessibilityRole="button"
            accessibilityLabel={t('Profil şəklini dəyiş')}
            onPress={changePhoto}
            style={[styles.avatarWrap, uploading && { opacity: 0.6 }]}>
            <Avatar name={profile.name || t('Sən')} size={88} uri={avatar} />
            <View style={styles.camBadge}>
              <Icon name="cam" size={14} color={palette.white} />
            </View>
          </PressableScale>
          <View style={{ flex: 1 }}>
            <PressableScale
              activeScale={0.97}
              disabled={uploading || saving}
              accessibilityRole="button"
              accessibilityLabel={t('Şəkli dəyiş')}
              onPress={changePhoto}
              style={[styles.photoBtn, uploading && { opacity: 0.5 }]}>
              <AppText variant="subhead" color={palette.inkText} style={{ fontWeight: '600' }}>
                {uploading ? t('Yüklənir…') : avatar ? t('Şəkli dəyiş') : t('Şəkil əlavə et')}
              </AppText>
            </PressableScale>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 8, lineHeight: 17 }}>
              {photoNote}
            </AppText>
          </View>
        </View>

        <Label text={t('Ad')} />
        <TextInput value={profile.name} onChangeText={(name) => setProfile({ name })} placeholder={t('Adın')} placeholderTextColor={palette.caption} style={styles.input} />

        <Label text={t('İstifadəçi adı')} />
        <View style={[styles.handleRow, shownHandleErr ? styles.handleRowBad : null]}>
          <AppText variant="body" color={palette.caption}>
            @
          </AppText>
          <TextInput
            value={handle}
            onChangeText={(v) => {
              setTaken(null);
              setHandle(v.trim());
            }}
            placeholder={t('istifadeci_adi')}
            placeholderTextColor={palette.caption}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            style={styles.handleInput}
          />
        </View>
        <AppText variant="footnote" color={shownHandleErr ? palette.red : palette.caption} style={{ marginTop: 8, lineHeight: 18 }}>
          {shownHandleErr ? t(shownHandleErr) : t('Səni bu adla tapacaqlar.')}
        </AppText>

        <Label text={t('Cins')} />
        <Segmented options={[t('Kişi'), t('Qadın')]} value={profile.gender === 'qadın' ? 1 : profile.gender === 'kişi' ? 0 : -1} onChange={(i) => setProfile({ gender: i === 0 ? 'kişi' : 'qadın' })} />

        <Label text={t('Səviyyə')} />
        {/* `Math.max(0, indexOf)` painted «Başlanğıc» as chosen for somebody who
            never picked a level. The control now says so instead. */}
        <Segmented
          options={LEVELS.map((l) => t(l))}
          value={LEVELS.indexOf(profile.level as (typeof LEVELS)[number])}
          onChange={(i) => setProfile({ level: LEVELS[i] })}
        />
        {!profile.level ? (
          <AppText variant="caption" color={palette.caption} style={{ marginTop: 6 }}>
            {t('Səviyyə hələ seçilməyib — yoldaş uyğunluğunda «Səviyyə göstərilməyib» kimi görünürsən.')}
          </AppText>
        ) : null}

        <Label text={t('Əsas zal')} />
        <PressableScale activeScale={0.98} onPress={pickGym} style={styles.pickRow}>
          <View style={styles.pickIcon}>
            <Icon name="dumbbell" size={18} color={palette.textSecondary} />
          </View>
          <AppText variant="callout" style={{ flex: 1 }}>
            {gymName}
          </AppText>
          <Icon name="chevR" size={18} color={palette.tertiary} />
        </PressableScale>

        <Label text={t('Məqsəd')} />
        <View style={styles.chips}>
          {GOALS.map((g) => (
            <Chip key={g} label={t(g)} tone="card" selected={profile.goals.includes(g)} onPress={() => setProfile({ goals: toggle(profile.goals, g) })} />
          ))}
        </View>

        <Label text={t('Məşq növü')} />
        <View style={styles.chips}>
          {WORKOUT_TYPES.map((w) => (
            <Chip key={w} label={t(w)} tone="card" selected={profile.types.includes(w)} onPress={() => setProfile({ types: toggle(profile.types, w) })} />
          ))}
        </View>

        <Label text={t('Həftənin günləri')} />
        <View style={styles.chips}>
          {DAYS.map((d, i) => (
            <Chip
              key={d}
              label={t(d)}
              tone="card"
              selected={profile.days.includes(i)}
              onPress={() => setProfile({ days: profile.days.includes(i) ? profile.days.filter((x) => x !== i) : [...profile.days, i].sort((a, b) => a - b) })}
            />
          ))}
        </View>

        <Label text={t('Vaxt')} />
        <View style={styles.chips}>
          {TIME_SLOTS.map((slot) => (
            <Chip key={slot} label={t(slot)} tone="card" selected={profile.timeSlot === slot} onPress={() => setProfile({ timeSlot: slot })} />
          ))}
        </View>

        <Label text={t('Bio')} />
        <TextInput
          value={profile.bio}
          onChangeText={(bio) => setProfile({ bio })}
          placeholder={t('Özün haqqında bir neçə söz')}
          placeholderTextColor={palette.caption}
          multiline
          style={[styles.input, { height: 92, paddingTop: 12, textAlignVertical: 'top' }]}
        />

        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 14, lineHeight: 18 }}>
          {t('Zal, məqsəd, növ, gün və vaxt yoldaş uyğunluğunu hesablayan sahələrdir — dəyişsən, təkliflər də dəyişir.')}
        </AppText>
      </ScrollView>
    </Screen>
  );
}

function Label({ text }: { text: string }) {
  return (
    <AppText variant="overline" color={palette.caption} style={{ marginTop: 18, marginBottom: 10 }}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  input: { backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, height: 52, fontSize: 16, color: palette.inkText },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, height: 52 },
  handleRowBad: { borderColor: palette.red },
  handleInput: { flex: 1, height: 52, fontSize: 16, color: palette.inkText, padding: 0 },
  chips:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14 },
  pickIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: palette.element, alignItems: 'center', justifyContent: 'center' },
  avatarBlock: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
  avatarWrap: { width: 88, height: 88 },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.ink,
    borderWidth: 2,
    borderColor: palette.grouped,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBtn: { alignSelf: 'flex-start', height: 38, paddingHorizontal: 16, borderRadius: 12, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
});
