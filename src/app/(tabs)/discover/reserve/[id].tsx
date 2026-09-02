import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { DAYS } from '@/data/mock';
import { useAuthGate } from '@/lib/authGate';
import { useTrainer } from '@/lib/hooks';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { getMyRequestTo, requestTrainer, type TrainerRequestRow } from '@/lib/roles';
import { hasSupabaseConfig } from '@/lib/supabase';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

const SLOTS = ['09:00', '10:00', '11:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

/** JS weekday (0=Sun) → DAYS index (0=B.e). */
const dayIndex = (d: Date) => (d.getDay() + 6) % 7;

const STATE_TITLE: Record<TrainerRequestRow['status'], string> = {
  pending: 'Sorğu göndərildi',
  accepted: 'Müəllim qəbul etdi',
  declined: 'Müəllim rədd etdi',
  ended: 'Əməkdaşlıq bitib',
};

export default function Reserve() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const gate = useAuthGate();
  const trainer = useTrainer(id);
  /* Android edge-to-edge (SDK 54+) never resizes the window, so `adjustResize` and
     KeyboardAvoidingView both do nothing here — the note field and the «Sorğu göndər»
     footer used to sit under the IME with no way to scroll them out. The measured
     overlap is the only figure that works; the tab scene already reserves
     `insets.bottom`, and the keyboard eats that strip first.

     iOS is left to KeyboardAvoidingView, which measures the same overlap itself and
     in sync with the keyboard animation — adding the lift on top of its padding would
     raise the footer a second time and leave it floating mid-screen. */
  const measuredLift = useKeyboardLift(8);
  const lift = Platform.OS === 'android' ? measuredLift : 0;
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState<string | null>('19:00');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [request, setRequest] = useState<TrainerRequestRow | null>(null);

  // Real upcoming dates, generated from today — never a fixed 18…23 strip.
  const days = useMemo(() => {
    const out: { label: string; num: string; date: Date }[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      out.push({ label: i === 0 ? 'Bu gün' : DAYS[dayIndex(d)], num: String(d.getDate()), date: d });
    }
    return out;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !id) return;
      let alive = true;
      getMyRequestTo(id)
        .then((r) => alive && setRequest(r))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [id])
  );

  if (!trainer) {
    return (
      /* No 'bottom' edge: this screen lives inside the tab scene, whose padding
         already carries the floating bar's footprint — and that footprint includes
         the bottom safe-area inset. Adding it again would push the CTA up twice. */
      <Screen edges={['top']}>
        <NavBar title="Rezervasiya" />
        <View style={styles.missing}>
          <Icon name="user" size={28} color={palette.tertiary} />
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10 }}>
            Müəllim tapılmadı.
          </AppText>
          <Button title="Geri" variant="secondary" onPress={() => router.back()} style={{ marginTop: 16, height: 44, paddingHorizontal: 24 }} />
        </View>
      </Screen>
    );
  }

  const chosen = days[day];
  const preferred = chosen && slot ? `${chosen.label} ${chosen.num} · ${slot}` : '';

  const submit = () => {
    if (!slot || !chosen) return;
    gate(async () => {
      if (!hasSupabaseConfig) {
        toast('Sorğu göndərilmədi — internet bağlantısı lazımdır', 'error');
        return;
      }
      setSending(true);
      try {
        // Real row: this is exactly what appears in the trainer's «Şagirdlər» panel.
        await requestTrainer(trainer.id, note.trim(), preferred);
        const fresh = await getMyRequestTo(trainer.id).catch(() => null);
        setRequest(fresh ?? { id: '', trainer_id: trainer.id, from_profile: '', note: note.trim(), preferred_time: preferred, status: 'pending', created_at: new Date().toISOString() });
        toast('Sorğu müəllimə göndərildi');
      } catch (e) {
        // An ownerless trainer row can never read or answer the request, so no row
        // is written — saying «göndərildi» would leave the user waiting forever.
        if (e instanceof Error && e.message === 'trainer-inactive') {
          toast('Bu müəllim hesabı hələ aktiv deyil — sorğu göndərmək mümkün deyil', 'error');
        } else {
          toast('Sorğu göndərilmədi — yenidən cəhd et', 'error');
        }
      } finally {
        setSending(false);
      }
    }, 'Müəllimə sorğu göndərmək üçün');
  };

  return (
    /* 'top' only — the tab scene's padding already clears the floating bar and the
       home indicator (the native tab bar folds the bottom inset in). */
    <Screen edges={['top']}>
      <NavBar title="Müəllimlə məşq" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: 24 + lift }]}
          keyboardShouldPersistTaps="handled">
          <View style={styles.trainer}>
            <Avatar name={trainer.name} size={48} />
            <View style={{ flex: 1 }}>
              <AppText variant="headline">{trainer.name}</AppText>
              <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>
                {trainer.specialty}
              </AppText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="title3">{trainer.priceFrom} ₼</AppText>
              <AppText variant="caption" color={palette.caption}>
                1 məşq · məlumat
              </AppText>
            </View>
          </View>

          {request ? (
            <>
              <View style={styles.stateCard}>
                <Icon name={request.status === 'accepted' ? 'check' : request.status === 'declined' ? 'x' : 'clock'} size={20} color={request.status === 'accepted' ? palette.voltDeep : palette.textSecondary} />
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{STATE_TITLE[request.status]}</AppText>
                  <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 4, lineHeight: 18 }}>
                    {request.status === 'pending'
                      ? `${trainer.name} sorğunu görür və cavab verəndə burada yenilənəcək.`
                      : request.status === 'accepted'
                        ? 'Vaxtı və zalı müəllimlə söhbətdə dəqiqləşdir.'
                        : request.status === 'declined'
                          ? 'Başqa müəllimə baxa bilərsən.'
                          : 'Yenidən sorğu göndərə bilərsən.'}
                  </AppText>
                  {request.preferred_time ? (
                    <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6 }}>
                      İstədiyin vaxt: {request.preferred_time}
                    </AppText>
                  ) : null}
                  {request.note ? (
                    <AppText variant="footnote" color={palette.caption} style={{ marginTop: 3 }}>
                      Qeyd: {request.note}
                    </AppText>
                  ) : null}
                </View>
              </View>
              <AppText variant="caption" color={palette.caption} style={{ marginTop: 14, lineHeight: 17 }}>
                SPOT ödəniş qəbul etmir. Qiymət və ödəniş şərtləri birbaşa müəllimlə razılaşdırılır.
              </AppText>
            </>
          ) : (
            <>
              <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 12 }}>
                Tarix
              </AppText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 9 }}
                style={{ marginHorizontal: -spacing.screen, paddingHorizontal: spacing.screen }}>
                {days.map((dd, i) => (
                  <PressableScale key={dd.date.toISOString()} activeScale={0.94} onPress={() => setDay(i)} style={[styles.day, day === i && styles.dayOn]}>
                    <AppText style={{ fontSize: 12, fontWeight: '600', color: day === i ? palette.white : palette.caption }}>{dd.label}</AppText>
                    <AppText style={{ fontSize: 18, fontWeight: '700', color: day === i ? palette.white : palette.inkText, marginTop: 4 }}>{dd.num}</AppText>
                  </PressableScale>
                ))}
              </ScrollView>

              <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 12 }}>
                İstədiyin saat
              </AppText>
              <View style={styles.slots}>
                {SLOTS.map((s) => (
                  <PressableScale key={s} activeScale={0.94} onPress={() => setSlot(s)} style={[styles.slot, slot === s && styles.slotOn]}>
                    <AppText style={{ fontSize: 14, fontWeight: '600', color: slot === s ? palette.white : palette.inkText }}>{s}</AppText>
                  </PressableScale>
                ))}
              </View>
              <AppText variant="caption" color={palette.caption} style={{ marginTop: 10, lineHeight: 17 }}>
                Bu, istəyindir — müəllimin boş saatlarını görmürük. Son vaxt müəllim təsdiqləyəndən sonra dəqiqləşəcək.
              </AppText>

              <AppText variant="overline" color={palette.caption} style={{ marginTop: 22, marginBottom: 10 }}>
                Qeyd (məcburi deyil)
              </AppText>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Məqsədin, təcrübən, travma varsa yaz…"
                placeholderTextColor={palette.caption}
                multiline
                style={styles.noteInput}
              />

              <AppText variant="caption" color={palette.caption} style={{ marginTop: 14, lineHeight: 17 }}>
                Bu rezervasiya deyil — müəllimə sorğudur. SPOT ödəniş qəbul etmir; qiymət yalnız məlumat üçündür.
              </AppText>
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { marginBottom: lift }]}>
          {request && request.status !== 'declined' && request.status !== 'ended' ? (
            <Button title="Müəllimə mesaj yaz" icon="msg" full onPress={() => router.push({ pathname: '/chat/[id]', params: { id: trainer.id } })} />
          ) : (
            <>
              <View style={styles.footerInfo}>
                <AppText variant="footnote" color={palette.caption}>
                  {preferred || 'Vaxt seç'}
                </AppText>
              </View>
              <Button
                title={sending ? 'Göndərilir…' : 'Sorğu göndər'}
                onPress={submit}
                disabled={!slot || sending}
                style={{ flex: 1 }}
                notify
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  trainer: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 16, padding: 14 },
  stateCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 18 },
  day: { width: 62, height: 70, borderRadius: 14, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  slot: { width: '22%', height: 44, borderRadius: 12, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  slotOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  noteInput: { minHeight: 80, borderRadius: 12, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, padding: 12, fontSize: 15, color: palette.inkText, textAlignVertical: 'top' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
  footerInfo: { flex: 0 },
});
