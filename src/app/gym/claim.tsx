import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { KeyboardLift } from '@/components/ui/KeyboardLift';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { GymGate, getMyGymClaim, submitGymClaim, useMyGym, type GymClaimRow } from '@/lib/gymOwner';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** What approval REALLY changes.
 *
 *  The old list promised that price/hours/equipment editing, the check-in code and
 *  day-pass registration, occupancy statistics and official review replies «open
 *  after approval». None of them is gated on the claim — the whole panel works the
 *  moment the gym row is created (claim_status 'unclaimed'), so the list described a
 *  permission boundary the app does not enforce. Approval is about identity, not
 *  capability, and that is all we may say here. */
const APPROVAL_MEANS = [
  'Zalın bu hesaba aid olduğu rəsmi olaraq təsdiqlənir',
  'Zalın adını başqası öz üstünə qeydiyyata ala bilmir',
  'Paneldə «Sahiblik təsdiqlənib» statusu görünür',
];

export default function GymClaim() {
  const router = useRouter();
  const state = useMyGym();
  const gym = state.gym;

  const [claim, setClaim] = useState<GymClaimRow | null>(null);
  const [checked, setChecked] = useState(false);
  /** The claim row could not be read — we do NOT know the status, so we say so. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [voen, setVoen] = useState('');
  const [sending, setSending] = useState(false);

  const gymId = gym?.id;

  const loadClaim = useCallback(async (id: string) => {
    setChecked(false);
    setLoadFailed(false);
    try {
      setClaim(await getMyGymClaim(id));
    } catch {
      setLoadFailed(true);
    }
    setChecked(true);
  }, []);

  useEffect(() => {
    if (gymId) loadClaim(gymId);
  }, [gymId, loadClaim]);

  if (!gym) {
    return (
      <Screen edges={['top', 'bottom']}>
        <NavBar title="Sahiblik təsdiqi" />
        <GymGate state={state} />
      </Screen>
    );
  }

  const submit = async () => {
    if (sending) return;
    if (!voen.trim()) {
      toast('VÖEN və ya qeydiyyat nömrəsini yaz', 'error');
      return;
    }
    setSending(true);
    try {
      const sent = voen.trim();
      await submitGymClaim({ gymId: gym.id, voen: sent });
      const fresh = await getMyGymClaim(gym.id).catch(() => null);
      // The write DID succeed, so never fall back to "not submitted" just because
      // the re-read failed — reflect what we actually sent.
      setClaim(
        fresh ?? {
          id: 'local',
          gym_id: gym.id,
          voen: sent,
          status: 'pending',
          reject_reason: null,
          sla_due_at: null,
          created_at: new Date().toISOString(),
        }
      );
      setLoadFailed(false);
      state.reload();
      toast('Müraciətin göndərildi — 2 iş günü içində cavab veriləcək');
    } catch {
      // This row MUST reach the admin panel. Never fake a success.
      toast('Müraciət göndərilmədi — bağlantını yoxlayıb yenidən cəhd et', 'error');
    }
    setSending(false);
  };

  // A `pending` row with no VÖEN was never filled in by the owner (it can be
  // pre-filed when the gym is registered). Only a row that actually carries a
  // VÖEN counts as a submitted application — otherwise the form must stay open.
  const submitted = claim?.status === 'pending' && !!claim.voen;
  const approved = claim?.status === 'approved' || gym.claimStatus === 'claimed';
  const rejected = claim?.status === 'rejected';
  const showForm = checked && !loadFailed && !approved && !submitted;

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Sahiblik təsdiqi" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 16 }}>
        <View style={styles.gymCard}>
          <View style={{ flexDirection: 'row', gap: 13, alignItems: 'center', marginBottom: 14 }}>
            <View style={styles.gymIcon}>
              <Icon name="dumbbell" size={24} color="rgba(255,255,255,0.4)" />
            </View>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontSize: 18, fontWeight: '700', color: palette.white }}>{gym.name}</AppText>
              <AppText style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.55)', marginTop: 5 }}>
                {gym.district || 'Ünvan yazılmayıb'}
              </AppText>
            </View>
          </View>
          <AppText style={{ fontSize: 13.5, lineHeight: 20, color: 'rgba(255,255,255,0.7)' }}>
            Bu zalı SPOT-da sən qeydiyyata almısan. Sahibliyi rəsmi təsdiqləmək üçün admin komandası VÖEN-i yoxlayır.
          </AppText>
        </View>

        {approved ? (
          <StatusCard
            icon="verified"
            tone="ok"
            title="Sahiblik təsdiqlənib"
            body="Zalın bu hesaba aid olduğu rəsmi olaraq təsdiqləndi. Panel əvvəlki kimi tam açıqdır."
          />
        ) : !checked ? (
          <StatusCard icon="clock" tone="wait" title="Yüklənir…" body="Müraciətinin statusu oxunur." />
        ) : loadFailed ? (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', gap: 11, alignItems: 'flex-start', marginBottom: 12 }}>
              <Icon name="x" size={18} color="#D14A15" />
              <View style={{ flex: 1 }}>
                <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>Müraciətin statusu yüklənmədi</AppText>
                <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 5 }}>
                  Bağlantını yoxla və yenidən cəhd et. Statusu bilmədən yeni müraciət göndərmirik ki, təkrar müraciət
                  yaranmasın.
                </AppText>
              </View>
            </View>
            <Button title="Yenidən cəhd et" variant="secondary" full onPress={() => gymId && loadClaim(gymId)} />
          </View>
        ) : submitted ? (
          <StatusCard
            icon="clock"
            tone="wait"
            title="Baxılır"
            body={`Müraciətin admin komandasındadır — 2 iş günü ərzində yoxlanılır · VÖEN: ${claim?.voen}`}
          />
        ) : (
          <>
            {rejected ? (
              <StatusCard
                icon="x"
                tone="bad"
                title="Müraciət qəbul olunmadı"
                body={claim?.reject_reason ? claim.reject_reason : 'Sənədləri yenidən yoxlayıb təkrar göndərə bilərsən.'}
              />
            ) : null}

            <View style={styles.card}>
              <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 12 }}>
                VÖEN VƏ YA QEYDİYYAT NÖMRƏSİ
              </AppText>
              <TextInput
                value={voen}
                onChangeText={setVoen}
                placeholder="Məs: 1234567891"
                placeholderTextColor={palette.caption}
                autoCapitalize="characters"
                style={styles.input}
              />
              <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.tertiary, marginTop: 10 }}>
                Admin komandası nömrəni rəsmi reyestrdə yoxlayır. Lazım olsa zalın nömrəsinə zəng edirlər. Sənəd
                yükləmə və selfie yoxlaması bu versiyada yoxdur — yalnız VÖEN tələb olunur.
              </AppText>
            </View>
          </>
        )}

        <View style={styles.card}>
          <AppText variant="overline" color={palette.tertiary} style={{ marginBottom: 13 }}>
            TƏSDİQ NƏ DEYİR
          </AppText>
          <View style={{ gap: 10 }}>
            {APPROVAL_MEANS.map((u) => (
              <View key={u} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Icon name="check" size={15} color="#5B7F00" />
                <AppText style={{ fontSize: 13.5, flex: 1 }}>{u}</AppText>
              </View>
            ))}
          </View>
          <AppText style={{ fontSize: 12, lineHeight: 17, color: palette.tertiary, marginTop: 12 }}>
            Panel indidən tam açıqdır: qiymət, saat və avadanlıq, zal kodu və day-pass, doluluq statistikası,
            rəylərə rəsmi cavab — hamısı təsdiqi gözləmədən işləyir. Təsdiq bunları açmır, zalın kimə aid
            olduğunu təsdiqləyir.
          </AppText>
        </View>

        <View style={styles.disclaimer}>
          <Icon name="shield" size={16} color="#D14A15" />
          <AppText style={{ fontSize: 12.5, lineHeight: 18, color: '#8A4A25', flex: 1 }}>
            Sahib rəyləri silə BİLMİR — yalnız cavab yaza bilər. Bu qayda dəyişməzdir, əks halda reytinq mənasını
            itirir.
          </AppText>
        </View>
      </ScrollView>

      {showForm ? (
        // Android edge-to-edge does not resize the window, so this fixed footer would
        // sit under the IME the whole time the VÖEN is being typed.
        <KeyboardLift style={{ paddingHorizontal: spacing.screen, paddingBottom: 8, paddingTop: 8 }}>
          <PressableScale
            activeScale={0.98}
            disabled={sending}
            onPress={submit}
            style={[styles.confirmBtn, sending && { opacity: 0.5 }]}>
            <AppText style={{ color: palette.white, fontSize: 16, fontWeight: '600' }}>
              {sending ? 'Göndərilir…' : 'Sahibliyi təsdiqlə'}
            </AppText>
          </PressableScale>
        </KeyboardLift>
      ) : (
        <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 8, paddingTop: 8 }}>
          <PressableScale activeScale={0.98} onPress={() => router.back()} style={styles.secondaryBtn}>
            <AppText style={{ fontSize: 16, fontWeight: '600', color: palette.inkText }}>Panelə qayıt</AppText>
          </PressableScale>
        </View>
      )}
    </Screen>
  );
}

function StatusCard({
  icon,
  tone,
  title,
  body,
}: {
  icon: 'verified' | 'clock' | 'x';
  tone: 'ok' | 'wait' | 'bad';
  title: string;
  body: string;
}) {
  const color = tone === 'ok' ? '#5B7F00' : tone === 'wait' ? '#0A84FF' : '#D14A15';
  const bg = tone === 'ok' ? 'rgba(198,255,61,0.18)' : tone === 'wait' ? 'rgba(10,132,255,0.08)' : 'rgba(255,107,53,0.1)';
  return (
    <View style={[styles.status, { backgroundColor: bg }]}>
      <Icon name={icon} size={18} color={color} />
      <View style={{ flex: 1 }}>
        <AppText style={{ fontSize: 14.5, fontWeight: '600' }}>{title}</AppText>
        <AppText style={{ fontSize: 12.5, lineHeight: 18, color: palette.textSecondary, marginTop: 5 }}>{body}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gymCard: { backgroundColor: palette.ink, borderRadius: 20, padding: 18, marginBottom: 14 },
  gymIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: '#3A3A42', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: palette.white, borderRadius: 18, padding: 17, marginBottom: 14 },
  status: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', borderRadius: 16, padding: 15, marginBottom: 14 },
  input: { backgroundColor: palette.grouped, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: palette.inkText },
  disclaimer: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(255,107,53,0.1)', borderRadius: 14, padding: 14 },
  confirmBtn: { height: 50, borderRadius: 14, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  secondaryBtn: { height: 50, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
});
