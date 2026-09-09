import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { toast } from '@/store/ui';
import { gymById } from '@/store/db';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { USERNAME_TAKEN_MSG } from '@/lib/api';
import { errorFeedback } from '@/lib/feedback';
import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

export default function Done() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const complete = useAppStore((s) => s.completeOnboarding);
  const saveProfile = useAppStore((s) => s.saveProfile);

  const [saving, setSaving] = useState(false);

  /* `getGym` searched the four seed rows, so a person who had just picked a real
     gym was told on this very screen that they train at home. */
  const homeGym = profile.homeGymId ? (gymById(profile.homeGymId) ?? null) : null;

  const start = async () => {
    if (saving) return;
    setSaving(true);
    const result = await saveProfile();
    setSaving(false);

    // Tell the truth about where the profile ended up — never claim a save that didn't happen.
    if (result === 'failed') {
      /* One message used to cover every failure — «İnternet bağlantını yoxla» —
         including the one failure the store can name. Two people called Aysel get
         the same suggested handle; the step-5 check passed while it was still free
         (or could not run at all and said so), and Postgres then refused the
         duplicate here. The person was told to check a connection that was working,
         on a screen with no handle field, so pressing the button again could never
         succeed. Send them back to the step that owns the field, with the handle
         already marked as taken. */
      if (useAppStore.getState().lastSaveError === 'username-taken') {
        errorFeedback();
        toast(`${USERNAME_TAKEN_MSG} — başqa istifadəçi adı seç`, 'error');
        router.replace({
          pathname: '/onboarding/profile',
          params: { taken: profile.username ?? '' },
        });
        return;
      }
      // Not a connection problem either: 'failed' now means the server answered
      // and refused (saveProfile returns 'local' when nothing could be sent).
      toast('Server profili qəbul etmədi. Bir az sonra yenidən cəhd et.', 'error');
      return; // stay here so the user can retry
    }
    if (result === 'local') {
      /* This is also the offline first launch now. It used to be reported as
         'failed', which left the person stuck on this screen retrying a save that
         could not work — bootstrap() sends the profile up on the next launch that
         has a session, so say exactly that instead of blocking them here. */
      toast('Profil hələlik yalnız bu cihazda saxlanıldı — internet olanda göndəriləcək.', 'info');
    }
    complete();
    router.replace('/(tabs)/discover');
  };

  return (
    <Screen edges={['top', 'bottom']} padded>
      <View style={styles.center}>
        <Animated.View entering={FadeInDown.duration(300)} style={styles.disc}>
          <Icon name="check" size={40} color={palette.inkText} />
        </Animated.View>
        <AppText variant="title" style={{ marginTop: 24 }} center>
          Hər şey hazırdır
        </AppText>
        <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, maxWidth: 300 }}>
          Profilin quruldu. İndi zalını, yoldaşını və proqramlarını kəşf et.
        </AppText>

        <View style={styles.recap}>
          {/* «Evdə məşq» is only true when step 4's «zalım yoxdur» was chosen, which
              is what a null homeGymId means. A gym id we cannot resolve — the
              catalogue read failed, or it has not been fetched on this launch — is
              a missing NAME, not a person who trains at home. */}
          <RecapRow
            icon="pin"
            label="Zal"
            value={homeGym ? homeGym.name : profile.homeGymId ? 'Ad yüklənmədi' : 'Evdə məşq'}
          />
          <View style={styles.sep} />
          <RecapRow icon="target" label="Məqsəd" value={profile.goals[0] ?? 'Seçilməyib'} />
          <View style={styles.sep} />
          <RecapRow icon="flame" label="Səviyyə" value={profile.level || 'seçilməyib'} />
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          title={saving ? 'Yadda saxlanılır…' : 'SPOT-a başla'}
          onPress={start}
          disabled={saving}
          notify
          full
        />
      </View>
    </Screen>
  );
}

function RecapRow({ icon, label, value }: { icon: 'pin' | 'target' | 'flame'; label: string; value: string }) {
  return (
    <View style={styles.recapRow}>
      <View style={styles.recapIcon}>
        <Icon name={icon} size={17} color={palette.voltDeep} />
      </View>
      <AppText variant="body" color={palette.textSecondary} style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText variant="headline" style={{ flexShrink: 1 }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: { width: 96, height: 96, borderRadius: 48, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  recap: { alignSelf: 'stretch', backgroundColor: palette.grouped, borderRadius: 16, paddingHorizontal: 16, marginTop: 32 },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  recapIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: palette.separator },
  footer: { gap: 10, paddingBottom: 6 },
});
