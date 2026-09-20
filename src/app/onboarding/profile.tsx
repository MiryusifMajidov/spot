import { useLocalSearchParams, useRouter } from 'expo-router';
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
  const [saving, setSaving] = useState(false);
  const saveProfile = useAppStore((s) => s.saveProfile);
  const complete = useAppStore((s) => s.completeOnboarding);
  const [ageTouched, setAgeTouched] = useState(false);
  const [checking, setChecking] = useState(false);
  /* Handle we know is somebody else's. It can arrive as a param: the LAST step
     («SPOT-a başla») is where Postgres rejects a duplicate handle, and that screen
     has no field to correct — so it sends the person back here with the offending
     name, instead of asking them to retry a save that can never succeed. */
  const params = useLocalSearchParams<{ taken?: string }>();
  const rejectedHandle = typeof params.taken === 'string' ? params.taken.trim().toLowerCase() : '';
  const [taken, setTaken] = useState<string | null>(rejectedHandle || null);

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
    /* This is the last screen of registration, so the save happens here rather
       than on a recap step of its own. Everything the app used to ask before
       this — məqsəd, səviyyə, cədvəl, zal — is editable in Profil → Redaktə and
       is asked for nowhere now: demanding six answers from somebody who has not
       seen a single gym yet is the slowest possible way to lose them. */
    setSaving(true);
    const result = await saveProfile();
    setSaving(false);

    if (result === 'failed') {
      /* Two people called Aysel get the same suggested handle: the check above
         passed while it was still free (or could not run at all), and Postgres
         refused the duplicate here. That is not a connection problem, and the
         handle field is on THIS screen — so say it and stay. */
      if (useAppStore.getState().lastSaveError === 'username-taken') {
        setTaken(handle.trim().toLowerCase());
        errorFeedback();
        toast(`${USERNAME_TAKEN_MSG} — başqa istifadəçi adı seç`, 'error');
        return;
      }
      errorFeedback();
      toast('Server profili qəbul etmədi. Bir az sonra yenidən cəhd et.', 'error');
      return;
    }
    if (result === 'local') {
      // Also the offline first launch. bootstrap() sends it up on the next
      // launch that has a session, so say that instead of blocking them here.
      toast('Profil hələlik yalnız bu cihazda saxlanıldı — internet olanda göndəriləcək.', 'info');
    }
    complete();
    /* The account exists from this line on — `complete()` has already flipped
       `onboarded`, so killing the app on the next screen still lands them
       inside. That is what lets the trainer suggestion be genuinely optional:
       it is an offer after registration, not a sixth question inside it. It
       shows itself only if the server actually has people to suggest. */
    router.replace('/onboarding/trainers');
  };

  return (
    <OnboardingScaffold
      step={1}
      totalSteps={1}
      title="Səni necə çağıraq?"
      subtitle="Qalan hər şeyi sonra Profil → Redaktə-dən dəyişə bilərsən."
      onNext={next}
      nextLabel={saving ? 'Yadda saxlanılır…' : checking ? 'Yoxlanılır…' : 'SPOT-a başla'}
      nextDisabled={!!nameErr || !!handleErr || !!ageErr || checking || saving}>
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
          // Sent back here because the server refused this exact handle: put the
          // cursor in the one field that has to change.
          autoFocus={!!rejectedHandle}
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
