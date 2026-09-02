import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { COMPAT_UNKNOWN, MISMATCH_COLOR, compatOf, splitReasons } from '@/components/PartnerRow';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { DAYS, TIME_SLOTS } from '@/data/mock';
import { getMyProfile, sendMatchRequest as apiSendMatchRequest } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { usePartner } from '@/lib/hooks';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { gymById, seedById, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { nameWithAge } from '@/lib/authorName';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JS weekday (0=Sun) → DAYS index (0=B.e / Monday). */
const dayIndex = (d: Date) => (d.getDay() + 6) % 7;

const SLOT_HOUR: Record<string, number> = {
  [TIME_SLOTS[0]]: 7,
  [TIME_SLOTS[1]]: 12,
  [TIME_SLOTS[2]]: 19,
  [TIME_SLOTS[3]]: 21,
};

function hourFromUsualTime(usual: string): number | null {
  const m = /(\d{1,2}):(\d{2})/.exec(usual);
  return m ? Number(m[1]) : null;
}

export interface Slot {
  label: string;
  iso: string;
}

/** Which calendar the offered days actually came from. The caption is written from
 *  this, so the screen can never claim an overlap it did not compute. */
type SlotBasis = 'overlap' | 'partner' | 'mine' | 'none';

/**
 * Three REAL upcoming dates drawn from a schedule somebody actually entered, at the
 * hour the partner trains. No literal "Cümə 20:00" — every option is a date that
 * exists on a day one of us said we train.
 *
 * The old fallback was the whole week [0..6], which silently DISCARDED my own
 * training days for every real (non-catalogue) partner and offered three days
 * neither side trains, under a caption saying the times were computed from my
 * calendar. When there is nothing to draw from, the honest answer is no slots at
 * all — the screen then asks for the missing days instead of inventing dates.
 */
function buildSlots(myDays: number[], partnerDays: number[], hour: number, n = 3): { slots: Slot[]; basis: SlotBasis } {
  const overlap = partnerDays.filter((d) => myDays.includes(d));
  const basis: SlotBasis = overlap.length ? 'overlap' : partnerDays.length ? 'partner' : myDays.length ? 'mine' : 'none';
  const pool = overlap.length ? overlap : partnerDays.length ? partnerDays : myDays;
  const out: Slot[] = [];
  if (!pool.length) return { slots: out, basis };
  const now = new Date();
  for (let add = 1; add <= 21 && out.length < n; add++) {
    const d = new Date(now);
    d.setDate(now.getDate() + add);
    d.setHours(hour, 0, 0, 0);
    if (!pool.includes(dayIndex(d))) continue;
    const label = add === 1 ? `Sabah ${String(hour).padStart(2, '0')}:00` : `${DAYS[dayIndex(d)]} ${d.getDate()} · ${String(hour).padStart(2, '0')}:00`;
    out.push({ label, iso: d.toISOString() });
  }
  return { slots: out, basis };
}

export default function Match() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const gate = useAuthGate();
  const profile = useAppStore((s) => s.profile);
  const partner = usePartner(id ?? '');
  const seed = seedById(id ?? '');
  const match = useDb((s) => (id ? s.matches[id] : undefined));
  const sendRequest = useDb((s) => s.sendMatchRequest);
  const [time, setTime] = useState(0);
  const [sending, setSending] = useState(false);
  /** The answer the SERVER holds for the offer I sent. Without reading it back the
   *  card below says «cavab gözlənilir» forever, even days after the other person
   *  accepted. `unknown` means the read failed — never paint that as waiting. */
  const [answer, setAnswer] = useState<'pending' | 'accepted' | 'declined' | 'gone' | 'unknown' | null>(null);
  const requested = match?.state === 'requested';

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !id || !UUID.test(id) || !requested) return;
      let alive = true;
      (async () => {
        try {
          const me = await getMyProfile();
          if (!me) throw new Error('no profile');
          const { data, error } = await supabase
            .from('match_requests')
            .select('status,created_at')
            .eq('from_profile', me.id)
            .eq('to_profile', id)
            .order('created_at', { ascending: false })
            .limit(1);
          if (error) throw error;
          if (!alive) return;
          const status = ((data ?? [])[0] as { status?: string } | undefined)?.status;
          if (status === 'accepted') {
            useDb.getState().acceptMatch(id); // the loop closes: the thread opens
            setAnswer('accepted');
          } else if (status === 'declined') {
            setAnswer('declined');
          } else if (status === 'pending') {
            setAnswer('pending');
          } else {
            setAnswer('gone');
          }
        } catch {
          if (alive) setAnswer('unknown');
        }
      })();
      return () => {
        alive = false;
      };
    }, [id, requested])
  );

  // The partner's own stored slot («Axşam 17–21») is on the Partner record — it does
  // not need the demo catalogue, which no real user is ever in.
  const partnerSlot = partner?.usualTime ?? '';
  const { slots, basis } = useMemo(() => {
    const hour =
      hourFromUsualTime(partnerSlot) ??
      SLOT_HOUR[partnerSlot] ??
      (seed ? hourFromUsualTime(seed.usualTime) : null) ??
      SLOT_HOUR[seed?.scheduleSlot ?? ''] ??
      SLOT_HOUR[profile.timeSlot] ??
      19;
    return buildSlots(profile.days ?? [], seed?.scheduleDays ?? [], hour);
  }, [partnerSlot, seed, profile.days, profile.timeSlot]);
  // Slots can shrink when the profile changes — never leave the selection dangling.
  const timeIdx = time < slots.length ? time : 0;

  if (!partner || !id) {
    return (
      <Screen edges={['top', 'bottom']} padded>
        <NavBar />
        <View style={styles.center}>
          <Icon name="users" size={28} color={palette.tertiary} />
          <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 260 }}>
            Bu yoldaş tapılmadı. Siyahıya qayıt.
          </AppText>
        </View>
      </Screen>
    );
  }

  const sent = match?.state === 'requested';
  const accepted = match?.state === 'accepted';
  const score = compatOf(partner);
  const { pros, cons } = splitReasons(partner);
  const gym = gymById(partner.gymId);
  /** True only when this request can actually travel: a real SPOT profile + a backend. */
  const deliverable = hasSupabaseConfig && UUID.test(partner.id);
  const localOnlyReason = !hasSupabaseConfig
    ? 'Server bağlantısı olmadan təklif göndərilmir — yalnız sənin cihazında saxlanılıb.'
    : `${partner.name} hələ SPOT istifadəçisi deyil — təklif yalnız sənin cihazında saxlanılıb.`;

  const propose = () => {
    const slot = slots[timeIdx];
    if (!slot) return;
    gate(async () => {
      setSending(true);
      // A deliverable request is only recorded once the row really reached the other
      // side. There is no background retry queue, so a failure must stay a failure —
      // the user retries with the button, which is still enabled.
      if (deliverable) {
        try {
          await apiSendMatchRequest(partner.id);
        } catch {
          setSending(false);
          errorFeedback();
          toast('Təklif göndərilmədi — yenidən cəhd et', 'error');
          return;
        }
      }
      sendRequest(partner.id, `Məşq təklifi: ${slot.label}${gym ? ` · ${gym.name}` : ''}`);
      setSending(false);
      successFeedback();
      toast(deliverable ? 'Təklif göndərildi' : 'Təklif cihazında qeyd olundu — hələ göndərilməyib', deliverable ? 'success' : 'info');
    }, 'Yoldaşa təklif göndərmək üçün');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <NavBar title="Məşq təklif et" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.head}>
          <Avatar name={partner.name} size={72} />
          <View style={{ flex: 1 }}>
            <AppText variant="title3">
              {nameWithAge(partner.name, partner.age)}
            </AppText>
            <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3 }}>
              {partner.level} · {partner.usualTime}
            </AppText>
            {score === null ? (
              <View style={styles.unknownPill}>
                <AppText style={{ color: palette.textSecondary, fontSize: 11.5, fontWeight: '600' }}>{COMPAT_UNKNOWN}</AppText>
              </View>
            ) : (
              <View style={styles.compatPill}>
                <AppText style={{ color: palette.volt, fontSize: 12.5, fontWeight: '700' }}>{score}% uyğun</AppText>
              </View>
            )}
          </View>
        </View>

        {/* Nothing compared = nothing to list. And a mismatch is never dressed in the
            volt chip that means «this is why you two fit». */}
        {score !== null ? (
          <View style={styles.reasons}>
            {pros.map((r) => (
              <View key={r} style={styles.reason}>
                <AppText style={{ fontSize: 11.5, fontWeight: '600', color: palette.voltText }}>{r}</AppText>
              </View>
            ))}
            {cons.slice(0, 3).map((r) => (
              <View key={r} style={[styles.reason, styles.reasonBad]}>
                <AppText style={{ fontSize: 11.5, fontWeight: '600', color: MISMATCH_COLOR }}>≠ {r}</AppText>
              </View>
            ))}
          </View>
        ) : null}

        {accepted ? (
          <View style={styles.stateCard}>
            <Icon name="check" size={18} color={palette.voltDeep} />
            <View style={{ flex: 1 }}>
              <AppText variant="headline">{partner.name} təklifi qəbul etdi</AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                Söhbət açıqdır — vaxtı və zalı orada dəqiqləşdirin.
              </AppText>
            </View>
          </View>
        ) : sent ? (
          <View style={styles.stateCard}>
            <Icon
              name={answer === 'declined' ? 'x' : answer === 'unknown' ? 'bell' : 'clock'}
              size={18}
              color={palette.textSecondary}
            />
            <View style={{ flex: 1 }}>
              <AppText variant="headline">
                {!deliverable
                  ? 'Təklif qeyd olundu'
                  : answer === 'declined'
                    ? `${partner.name} qəbul etmədi`
                    : answer === 'unknown'
                      ? 'Cavabı oxuya bilmədik'
                      : 'Təklif göndərildi'}
              </AppText>
              <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 3, lineHeight: 18 }}>
                {!deliverable
                  ? localOnlyReason
                  : answer === 'declined'
                    ? 'Bu təklif bağlandı. İstəsən sonra yenidən yaza bilərsən.'
                    : answer === 'unknown'
                      ? 'Serverlə əlaqə alınmadı — bu təklifin qəbul edilib-edilmədiyini bilmirik. Sonra yenidən yoxla.'
                      : answer === 'gone'
                        ? 'Bu təklif serverdə tapılmadı — çox güman ki, geri götürülüb.'
                        : answer === 'pending'
                          ? `${partner.name} hələ cavab verməyib. Cavab gələndə söhbət açılacaq.`
                          : `${partner.name} cavab verənə qədər söhbət açılmır. Cavab gələndə «Sorğular»da görünəcək.`}
              </AppText>
              {/* The chosen hour stays on this phone: `match_requests` carries no time
                  column, so it did not travel with the offer. Showing it without
                  saying so would make the two sides read different messages. */}
              {match?.question ? (
                <>
                  <AppText variant="footnote" color={palette.caption} style={{ marginTop: 6 }}>
                    {match.question}
                  </AppText>
                  <AppText variant="caption" color={palette.caption} style={{ marginTop: 3, lineHeight: 17 }}>
                    Bu vaxt yalnız səndə qeyd olunub — təklifin içində getmir, qəbul ediləndən sonra söhbətdə dəqiqləşdir.
                  </AppText>
                </>
              ) : null}
            </View>
          </View>
        ) : (
          <>
            <AppText variant="overline" color={palette.caption} style={{ marginTop: 24, marginBottom: 6 }}>
              İlk məşqi təklif et
            </AppText>
            {/* The caption states exactly which calendar produced the dates below —
                it is written from the basis buildSlots really used, not from a guess. */}
            {slots.length > 0 ? (
              <AppText variant="footnote" color={palette.caption} style={{ marginBottom: 4, lineHeight: 18 }}>
                {basis === 'overlap'
                  ? 'Vaxtlar sənin və onun məşq günlərinizin kəsişməsindən hesablanıb.'
                  : basis === 'partner'
                    ? 'Ortaq gün yoxdur — vaxtlar onun məşq günlərinə görə seçilib.'
                    : 'Onun cədvəli bizdə yoxdur — vaxtlar yalnız sənin məşq günlərinə görə seçilib.'}
              </AppText>
            ) : null}
            {/* Said before the choice, not after: the offer itself carries no time. */}
            {slots.length > 0 ? (
              <AppText variant="caption" color={palette.caption} style={{ marginBottom: 12, lineHeight: 17 }}>
                Seçdiyin vaxt təkliflə birlikdə getmir — yalnız səndə qeyd olunur. Dəqiq vaxtı qarşı tərəf qəbul edəndən sonra
                söhbətdə razılaşacaqsınız.
              </AppText>
            ) : null}
            {slots.length === 0 ? (
              <View style={styles.stateCard}>
                <Icon name="cal" size={18} color={palette.textSecondary} />
                <View style={{ flex: 1 }}>
                  <AppText variant="footnote" color={palette.textSecondary} style={{ lineHeight: 18 }}>
                    Məşq günü seçilməyib — nə səndə, nə onda. Vaxt təklif etmək üçün profilində məşq günlərini işarələ.
                  </AppText>
                  <PressableScale
                    activeScale={0.96}
                    onPress={() => router.push('/(tabs)/profile/edit')}
                    style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                    <AppText style={{ fontSize: 13, fontWeight: '600', color: palette.inkText }}>Məşq günlərini seç</AppText>
                  </PressableScale>
                </View>
              </View>
            ) : (
              <View style={styles.times}>
                {slots.map((s, i) => (
                  <PressableScale
                    key={s.iso}
                    activeScale={0.96}
                    onPress={() => setTime(i)}
                    style={[styles.time, timeIdx === i && styles.timeOn]}>
                    <AppText style={{ fontSize: 13, fontWeight: '600', color: timeIdx === i ? palette.white : palette.inkText }}>
                      {s.label}
                    </AppText>
                  </PressableScale>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {accepted ? (
          <Button
            title="Söhbətə keç"
            icon="msg"
            full
            onPress={() => router.replace({ pathname: '/chat/[id]', params: { id: partner.id } })}
          />
        ) : sent ? (
          <Button title="Bağla" variant="secondary" full onPress={() => router.back()} />
        ) : (
          <>
            <Button
              title={sending ? 'Göndərilir…' : 'Təklif göndər'}
              full
              notify
              disabled={sending || slots.length === 0}
              onPress={propose}
            />
            <PressableScale haptic={false} activeScale={0.97} onPress={() => router.back()} style={{ alignItems: 'center', paddingVertical: 14 }}>
              <AppText variant="body" color={palette.textSecondary}>
                Sonra
              </AppText>
            </PressableScale>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  compatPill: { alignSelf: 'flex-start', backgroundColor: palette.ink, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, marginTop: 8 },
  reasons: { flexDirection: 'row', gap: 7, marginTop: 6, flexWrap: 'wrap' },
  reason: { backgroundColor: 'rgba(198,255,61,0.30)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  reasonBad: { backgroundColor: 'rgba(255,149,0,0.16)' },
  unknownPill: { alignSelf: 'flex-start', backgroundColor: palette.grouped, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, marginTop: 8 },
  stateCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 22 },
  times: { gap: 9 },
  time: { height: 48, borderRadius: 13, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  timeOn: { backgroundColor: palette.ink, borderColor: palette.ink },
  footer: { paddingHorizontal: spacing.screen, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.separator },
});
