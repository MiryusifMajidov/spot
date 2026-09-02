import { useRouter } from 'expo-router';
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
import { useGyms } from '@/lib/hooks';
import { pickImage, setMyAvatar, shootImage } from '@/lib/images';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { actionSheet, toast } from '@/store/ui';
import { palette, radius, spacing } from '@/theme';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';

/** `avatar_url` lives on the profiles row (added by schema8) — read it defensively. */
function avatarOf(row: unknown): string | null {
  return (row as { avatar_url?: string | null } | null)?.avatar_url ?? null;
}


export default function EditProfile() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const gyms = useGyms();
  const [saving, setSaving] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
    if (uploading) return;
    let local: string | null = null;
    try {
      local = source === 'camera' ? await shootImage({ square: true }) : await pickImage({ square: true });
    } catch {
      local = null;
    }
    if (!local) return; // cancelled or permission denied — nothing to say
    if (!hasSupabaseConfig) {
      toast('Şəkil üçün server bağlantısı lazımdır', 'error');
      return;
    }
    const previous = avatar;
    setAvatar(local); // instant preview
    setUploading(true);
    try {
      const url = await setMyAvatar(local);
      setAvatar(url);
      successFeedback();
      toast('Profil şəklin yeniləndi');
    } catch {
      setAvatar(previous); // never leave a photo on screen that was not saved
      errorFeedback();
      toast('Şəkil yüklənmədi — yenidən cəhd et', 'error');
    } finally {
      setUploading(false);
    }
  };

  const changePhoto = () =>
    actionSheet({
      title: 'Profil şəkli',
      message: 'Şəklin profilində görünür.',
      actions: [
        { label: 'Kamera', onPress: () => upload('camera') },
        { label: 'Qalereya', onPress: () => upload('library') },
        { label: 'Ləğv et', style: 'cancel' as const },
      ],
    });

  const gymName = gyms.find((g) => g.id === profile.homeGymId)?.name ?? 'Seçilməyib';

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const pickGym = () =>
    actionSheet({
      title: 'Əsas zalın',
      message: 'Yoldaş uyğunluğu buna görə hesablanır.',
      actions: [
        ...gyms.slice(0, 12).map((g) => ({ label: g.name, onPress: () => setProfile({ homeGymId: g.id }) })),
        { label: 'Zalım yoxdur', onPress: () => setProfile({ homeGymId: null }) },
        { label: 'Ləğv et', style: 'cancel' as const },
      ],
    });

  const save = async () => {
    if (saving) return;
    const nameErr = displayNameError(profile.name);
    if (nameErr) {
      toast(nameErr, 'error');
      return;
    }
    const handleErr = usernameError(handle);
    if (handleErr) {
      toast(handleErr, 'error');
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
        toast(USERNAME_TAKEN_MSG, 'error');
        return;
      }
    } catch {
      /* offline / server unreachable — fall through to the write */
    }

    const previousHandle = profile.username;
    setProfile({ username: handle.trim() });
    const result = await saveProfile();
    setSaving(false);
    // saveProfile() tells us what actually happened — we never claim more than that.
    if (result === 'failed') {
      // The server refused it, so the phone must not start showing it either — put
      // the old handle back and stay here: the edits are still in the form to retry.
      setProfile({ username: previousHandle });
      if (useAppStore.getState().lastSaveError === 'username-taken') {
        setTaken(handle.trim().toLowerCase());
        toast(USERNAME_TAKEN_MSG, 'error');
      } else {
        toast('Serverdə saxlanılmadı — internet bağlantını yoxla və yenidən cəhd et', 'error');
      }
      return;
    }
    toast(result === 'local' ? 'Yadda saxlanıldı — hələlik yalnız bu cihazda' : 'Profilin yadda saxlanıldı');
    router.back();
  };

  const shownHandleErr = usernameError(handle) ?? (taken === handle.trim().toLowerCase() ? USERNAME_TAKEN_MSG : null);

  return (
    <Screen>
      <NavBar
        title="Profili redaktə et"
        right={
          <PressableScale onPress={save} disabled={saving} haptic={false} activeScale={0.94}>
            <AppText variant="headline" color={saving ? palette.tertiary : palette.blue}>
              {saving ? 'Saxlanılır…' : 'Yadda saxla'}
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
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Profil şəklini dəyiş"
            onPress={changePhoto}
            style={[styles.avatarWrap, uploading && { opacity: 0.6 }]}>
            <Avatar name={profile.name || 'Sən'} size={88} uri={avatar} />
            <View style={styles.camBadge}>
              <Icon name="cam" size={14} color={palette.white} />
            </View>
          </PressableScale>
          <View style={{ flex: 1 }}>
            <PressableScale
              activeScale={0.97}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Şəkli dəyiş"
              onPress={changePhoto}
              style={[styles.photoBtn, uploading && { opacity: 0.5 }]}>
              <AppText variant="subhead" color={palette.inkText} style={{ fontWeight: '600' }}>
                {uploading ? 'Yüklənir…' : avatar ? 'Şəkli dəyiş' : 'Şəkil əlavə et'}
              </AppText>
            </PressableScale>
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 8, lineHeight: 17 }}>
              Şəklin profilində görünür.
            </AppText>
          </View>
        </View>

        <Label text="Ad" />
        <TextInput value={profile.name} onChangeText={(name) => setProfile({ name })} placeholder="Adın" placeholderTextColor={palette.caption} style={styles.input} />

        <Label text="İstifadəçi adı" />
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
            placeholder="istifadeci_adi"
            placeholderTextColor={palette.caption}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            style={styles.handleInput}
          />
        </View>
        <AppText variant="footnote" color={shownHandleErr ? palette.red : palette.caption} style={{ marginTop: 8, lineHeight: 18 }}>
          {shownHandleErr ?? 'Səni bu adla tapacaqlar.'}
        </AppText>

        <Label text="Cins" />
        <Segmented options={['Kişi', 'Qadın']} value={profile.gender === 'qadın' ? 1 : 0} onChange={(i) => setProfile({ gender: i === 0 ? 'kişi' : 'qadın' })} />

        <Label text="Səviyyə" />
        <Segmented options={[...LEVELS]} value={Math.max(0, LEVELS.indexOf(profile.level as (typeof LEVELS)[number]))} onChange={(i) => setProfile({ level: LEVELS[i] })} />

        <Label text="Əsas zal" />
        <PressableScale activeScale={0.98} onPress={pickGym} style={styles.pickRow}>
          <View style={styles.pickIcon}>
            <Icon name="dumbbell" size={18} color={palette.textSecondary} />
          </View>
          <AppText variant="callout" style={{ flex: 1 }}>
            {gymName}
          </AppText>
          <Icon name="chevR" size={18} color={palette.tertiary} />
        </PressableScale>

        <Label text="Məqsəd" />
        <View style={styles.chips}>
          {GOALS.map((g) => (
            <Chip key={g} label={g} tone="card" selected={profile.goals.includes(g)} onPress={() => setProfile({ goals: toggle(profile.goals, g) })} />
          ))}
        </View>

        <Label text="Məşq növü" />
        <View style={styles.chips}>
          {WORKOUT_TYPES.map((t) => (
            <Chip key={t} label={t} tone="card" selected={profile.types.includes(t)} onPress={() => setProfile({ types: toggle(profile.types, t) })} />
          ))}
        </View>

        <Label text="Həftənin günləri" />
        <View style={styles.chips}>
          {DAYS.map((d, i) => (
            <Chip
              key={d}
              label={d}
              tone="card"
              selected={profile.days.includes(i)}
              onPress={() => setProfile({ days: profile.days.includes(i) ? profile.days.filter((x) => x !== i) : [...profile.days, i].sort((a, b) => a - b) })}
            />
          ))}
        </View>

        <Label text="Vaxt" />
        <View style={styles.chips}>
          {TIME_SLOTS.map((t) => (
            <Chip key={t} label={t} tone="card" selected={profile.timeSlot === t} onPress={() => setProfile({ timeSlot: t })} />
          ))}
        </View>

        <Label text="Bio" />
        <TextInput
          value={profile.bio}
          onChangeText={(bio) => setProfile({ bio })}
          placeholder="Özün haqqında bir neçə söz"
          placeholderTextColor={palette.caption}
          multiline
          style={[styles.input, { height: 92, paddingTop: 12, textAlignVertical: 'top' }]}
        />

        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 14, lineHeight: 18 }}>
          Zal, məqsəd, növ, gün və vaxt yoldaş uyğunluğunu hesablayan sahələrdir — dəyişsən, təkliflər də dəyişir.
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
