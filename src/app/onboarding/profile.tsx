import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { OnboardingScaffold } from '@/components/onboarding/OnboardingScaffold';
import { AppText } from '@/components/ui/AppText';
import { Segmented } from '@/components/ui/Segmented';
import { USERNAME_TAKEN_MSG, displayNameError, isUsernameTaken, suggestUsername, usernameError } from '@/lib/api';
import { errorFeedback } from '@/lib/feedback';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, radius } from '@/theme';

export default function ProfileStep() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);

  // Only follow the typed name while the person has not written their own handle.
  const [handleTouched, setHandleTouched] = useState(() => !!useAppStore.getState().profile.username);
  const [nameTouched, setNameTouched] = useState(false);
  const [ageTouched, setAgeTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  const [taken, setTaken] = useState<string | null>(null); // handle we know is somebody else's

  const handle = profile.username ?? '';
  const nameErr = displayNameError(profile.name);
  const handleErr = usernameError(handle);

  /* Age, and the 16+ gate.
     It was never asked anywhere in the app — not here, not in profile edit —
     while the partner cards printed «Ad, yaş» and the terms say 16+. So the age
     shown on a card came from nowhere, the age filter had nothing to filter on,
     and nothing stopped a 13-year-old from being sent to meet strangers in a
     gym. Asked once, here, and required. */
  const [ageText, setAgeText] = useState(profile.age != null ? String(profile.age) : '');
  const ageNum = Number(ageText);
  const ageErr =
    ageText.trim() === ''
      ? 'Yaşını yaz'
      : !Number.isFinite(ageNum) || !Number.isInteger(ageNum)
        ? 'Yalnız rəqəm yaz'
        : ageNum < 16
          ? 'SPOT 16 yaşdan yuxarı istifadəçilər üçündür'
          : ageNum > 100
            ? 'Yaşı yoxla'
            : null;

  useEffect(() => {
    if (handleTouched) return;
    setProfile({ username: suggestUsername(profile.name) });
  }, [profile.name, handleTouched, setProfile]);

  const shownHandleErr = handleTouched || handle ? handleErr ?? (taken === handle.trim().toLowerCase() ? USERNAME_TAKEN_MSG : null) : null;

  const next = async () => {
    if (nameErr || handleErr || ageErr || checking) return;
    setProfile({ age: ageNum });
    setChecking(true);
    try {
      if (await isUsernameTaken(handle)) {
        setTaken(handle.trim().toLowerCase());
        errorFeedback();
        toast(USERNAME_TAKEN_MSG, 'error');
        return;
      }
    } catch {
      // We could not reach the server to check — say so instead of implying the
      // handle is free. The database's unique index still decides when we save.
      toast('İstifadəçi adını indi yoxlaya bilmədik — yadda saxlayanda yoxlanacaq', 'info');
    } finally {
      setChecking(false);
    }
    router.push('/onboarding/privacy');
  };

  return (
    <OnboardingScaffold
      step={5}
      totalSteps={6}
      title="Profilini yarat"
      subtitle="Bu, yoldaşların səni tanıması üçündür. Adını və bio-nu sonra da dəyişə bilərsən."
      onNext={next}
      nextLabel={checking ? 'Yoxlanılır…' : 'Davam et'}
      nextDisabled={!!nameErr || !!handleErr || !!ageErr || checking}>
      <AppText variant="overline" color={palette.caption} style={styles.label}>
        Ad
      </AppText>
      <TextInput
        value={profile.name}
        onChangeText={(name) => {
          setNameTouched(true);
          setProfile({ name });
        }}
        placeholder="Adın"
        placeholderTextColor={palette.caption}
        style={styles.input}
      />
      {/* The name is public. Without this gate a person walked out of onboarding
          nameless and the app printed its «Sən» placeholder on their public card. */}
      {nameTouched && nameErr ? <Hint text={nameErr} bad /> : null}

      <AppText variant="overline" color={palette.caption} style={styles.label}>
        İstifadəçi adı
      </AppText>
      <View style={[styles.handleRow, shownHandleErr ? styles.handleRowBad : null]}>
        <AppText variant="body" color={palette.caption}>
          @
        </AppText>
        <TextInput
          value={handle}
          onChangeText={(v) => {
            setHandleTouched(true);
            setTaken(null);
            setProfile({ username: v.trim() });
          }}
          placeholder="istifadeci_adi"
          placeholderTextColor={palette.caption}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          style={styles.handleInput}
        />
      </View>
      <Hint text={shownHandleErr ?? 'Səni bu adla tapacaqlar. Sonra dəyişə bilərsən.'} bad={!!shownHandleErr} />

      <AppText variant="overline" color={palette.caption} style={styles.label}>
        Yaş
      </AppText>
      <TextInput
        value={ageText}
        onChangeText={(v) => {
          setAgeTouched(true);
          setAgeText(v.replace(/\D/g, '').slice(0, 3));
        }}
        placeholder="Məsələn 24"
        placeholderTextColor={palette.caption}
        keyboardType="number-pad"
        maxLength={3}
        style={styles.input}
      />
      <Hint
        text={ageTouched && ageErr ? ageErr : 'Yaşın yoldaş kartında görünür. SPOT 16 yaşdan yuxarı istifadəçilər üçündür.'}
        bad={ageTouched && !!ageErr}
      />

      <AppText variant="overline" color={palette.caption} style={styles.label}>
        Cins
      </AppText>
      <Segmented
        options={['Kişi', 'Qadın']}
        value={profile.gender === 'qadın' ? 1 : 0}
        onChange={(i) => setProfile({ gender: i === 0 ? 'kişi' : 'qadın' })}
      />

      <AppText variant="overline" color={palette.caption} style={styles.label}>
        Bio
      </AppText>
      <TextInput
        value={profile.bio}
        onChangeText={(bio) => setProfile({ bio })}
        placeholder="Məsələn: Səhər məşqlərini sevirəm, powerlifting üzərində işləyirəm."
        placeholderTextColor={palette.caption}
        multiline
        style={[styles.input, { height: 92, paddingTop: 12, textAlignVertical: 'top' }]}
      />
    </OnboardingScaffold>
  );
}

function Hint({ text, bad }: { text: string; bad?: boolean }) {
  return (
    <AppText variant="footnote" color={bad ? palette.red : palette.caption} style={styles.hint}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 18, marginBottom: 10 },
  input: { backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, height: 52, fontSize: 16, color: palette.inkText },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.white, borderRadius: radius.field, borderWidth: 1, borderColor: palette.separator, paddingHorizontal: 14, height: 52 },
  handleRowBad: { borderColor: palette.red },
  handleInput: { flex: 1, height: 52, fontSize: 16, color: palette.inkText, padding: 0 },
  hint: { marginTop: 8, lineHeight: 18 },
});
