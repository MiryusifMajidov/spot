import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { successFeedback, tapFeedback } from '@/lib/feedback';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { Icon } from '@/components/Icon';
import { azUpper } from '@/lib/az';
import { COMPAT_UNKNOWN_SHORT, MISMATCH_COLOR, compatOf, splitReasons } from '@/components/PartnerRow';
import { AppText } from '@/components/ui/AppText';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Partner } from '@/data/types';
import { useAuthGate } from '@/lib/authGate';
import { usePartnerDeck, usePartnersPhase } from '@/lib/hooks';
import { gymById, seedById, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { applyPartnerFilter, partnerFilterCount, useDiscoverPrefs, womenOnlyAllowed } from '@/store/discoverPrefs';
import { toast } from '@/store/ui';
import { palette } from '@/theme';
import { nameWithAge } from '@/lib/authorName';

const { width } = Dimensions.get('window');
const THRESHOLD = width * 0.28;

/* «Kartlar» is deliberately the scarce, high-quality channel — that is why SPOT is
 * a training app and not an endless swipe feed. Two rules define it and both are
 * enforced here: only people scoring 60 or more, and at most 30 cards a day.
 * Without them a user at a busy gym burns through the whole roster on 30 %
 * strangers, and every left-swipe is a permanent, persisted decline. */
const MIN_SCORE = 60;
const DAILY_CAP = 30;

/** The gym day runs 04:00 → 04:00, the same boundary the streak uses in store/db.ts,
 *  so a 01:00 session still belongs to the day it started. */
function gymDayKey(d: Date = new Date()): string {
  const x = new Date(d);
  x.setHours(x.getHours() - 4);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** How many cards this device has spent today. Persisted, because a cap that a
 *  restart resets is not a cap. One card is spent per DECISION (keç / saxla /
 *  təklif), so simply looking at a card and leaving costs nothing. */
interface CardQuota {
  day: string;
  count: number;
  spend: () => void;
}

const useCardQuota = create<CardQuota>()(
  persist(
    (set) => ({
      day: gymDayKey(),
      count: 0,
      spend: () =>
        set((s) => {
          const day = gymDayKey();
          return s.day === day ? { count: s.count + 1 } : { day, count: 1 };
        }),
    }),
    { name: 'spot-cards-quota', storage: createJSONStorage(() => AsyncStorage) }
  )
);

export default function Cards() {
  const router = useRouter();
  // Null until the user picks a gym — no catalogue gym is substituted, so the deck
  // is honestly empty instead of showing strangers from a gym they never chose.
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  // «not a man», not «is a woman» — see womenOnlyAllowed.
  const isWoman = womenOnlyAllowed(useAppStore((s) => s.profile.gender));
  const gate = useAuthGate();
  const deck = usePartnerDeck(homeGymId ?? '');
  const phase = usePartnersPhase(homeGymId ?? '');
  const filter = useDiscoverPrefs((s) => s.partnerFilter);
  const savedPartners = useDiscoverPrefs((s) => s.savedPartners);
  const toggleSavedPartner = useDiscoverPrefs((s) => s.toggleSavedPartner);
  const declineMatch = useDb((s) => s.declineMatch);
  const quotaDay = useCardQuota((s) => s.day);
  const quotaCount = useCardQuota((s) => s.count);
  const spend = useCardQuota((s) => s.spend);
  const usedToday = quotaDay === gymDayKey() ? quotaCount : 0;
  const remaining = Math.max(0, DAILY_CAP - usedToday);

  const inFilter = useMemo(() => applyPartnerFilter(deck, filter, isWoman), [deck, filter]);
  /* The 60 % gate. A null score means nothing was compared at all (the app holds
     too little of my own profile) — that can never pass a threshold, so those
     people are held back and the empty state says why. */
  const eligible = useMemo(() => inFilter.filter((p) => (compatOf(p) ?? -1) >= MIN_SCORE), [inFilter]);
  const belowGate = inFilter.length - eligible.length;
  const filterN = partnerFilterCount(filter, isWoman);
  // Saved partners stay in the pool (they were not rejected) — they are only put
  // aside for this sitting. Passed ones leave the engine deck for good.
  const [setAside, setSetAside] = useState<string[]>([]);
  const pool = useMemo(() => eligible.filter((p) => !setAside.includes(p.id)), [eligible, setAside]);
  const partners = useMemo(() => pool.slice(0, remaining), [pool, remaining]);
  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const current = partners[0];
  const next = partners[1];

  const emptyKind: 'cap' | 'filter' | 'gate' | 'done' =
    remaining <= 0 && pool.length > 0
      ? 'cap'
      : filterN > 0 && inFilter.length === 0
        ? 'filter'
        : eligible.length === 0 && belowGate > 0
          ? 'gate'
          : 'done';

  const reset = () => {
    x.value = 0;
    y.value = 0;
  };

  /** "Keç" is a real, persisted pass — the deck genuinely shrinks and stays shrunk.
   *
   *  It hides the CARD, it does not delete the PERSON's messages: if they later send
   *  a real workout offer, that request is kept and shown under «Gizlədilmiş sorğular»
   *  in Söhbətlər → Sorğular (chat/requests.tsx), where it can still be accepted. A
   *  decision about a stranger's card must never quietly destroy a message from them. */
  const skip = () => {
    const p = current;
    tapFeedback();
    if (p) {
      declineMatch(p.id); // removes them from usePartnerDeck permanently
      spend();
    }
    reset();
  };

  const save = () => {
    const p = current;
    if (!p) return;
    tapFeedback();
    if (!savedPartners.includes(p.id)) {
      toggleSavedPartner(p.id);
      toast('Saxlanıldı — «Yoldaşlar» bölməsində tapa bilərsən');
    }
    setSetAside((l) => [...l, p.id]);
    spend();
    reset();
  };

  const propose = (p?: Partner) => {
    if (!p) return;
    x.value = 0;
    y.value = 0;
    gate(() => {
      successFeedback();
      // The decision is made here, so the card is spent here — and it leaves this
      // sitting's deck so it cannot be spent a second time on the way back.
      setSetAside((l) => (l.includes(p.id) ? l : [...l, p.id]));
      spend();
      router.push({ pathname: '/(tabs)/discover/match', params: { id: p.id } });
    }, 'Yoldaş tapmaq üçün');
  };

  const flingSkip = () => {
    x.value = withTiming(-width * 1.4, { duration: 240 }, () => runOnJS(skip)());
  };
  const flingPropose = () => {
    const p = current;
    x.value = withTiming(width * 1.4, { duration: 220 }, () => runOnJS(propose)(p));
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY * 0.4;
    })
    .onEnd((e) => {
      if (e.translationX > THRESHOLD) {
        x.value = withTiming(width * 1.4, { duration: 220 }, () => runOnJS(propose)(current));
      } else if (e.translationX < -THRESHOLD) {
        x.value = withTiming(-width * 1.4, { duration: 240 }, () => runOnJS(skip)());
      } else {
        x.value = withSpring(0, { damping: 16, stiffness: 220 });
        y.value = withSpring(0);
      }
    });

  const topStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${interpolate(x.value, [-width, width], [-12, 12])}deg` }],
  }));
  const likeStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, THRESHOLD], [0, 1], 'clamp') }));
  const nopeStyle = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-THRESHOLD, 0], [1, 0], 'clamp') }));
  const nextScale = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(Math.abs(x.value), [0, THRESHOLD], [0.94, 1], 'clamp') }] }));

  return (
    /* Modal presentation: on iOS this sheet is its own view controller, so it reaches
       the physical bottom edge and the tab scene's padding does not apply. Without the
       'bottom' edge the action row and the hint below it land on the home indicator —
       the sibling modals (filter, partner-filter, match) all take both edges. */
    <Screen edges={['top', 'bottom']} style={{ backgroundColor: palette.element2 }}>
      <NavBar
        title="Kartlar"
        right={
          <PressableScale activeScale={0.9} onPress={() => router.push('/(tabs)/discover/partner-filter')}>
            <Icon name="sliders" size={22} color={palette.inkText} />
          </PressableScale>
        }
      />

      <View style={styles.deck}>
        {!homeGymId ? (
          <View style={styles.empty}>
            <Icon name="pin" size={30} color={palette.tertiary} />
            <AppText variant="headline" style={{ marginTop: 12 }}>
              Əsas zalın seçilməyib
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 250, lineHeight: 21 }}>
              Zalını seç — yoldaşlar zala görə tapılır.
            </AppText>
            <PressableScale activeScale={0.96} onPress={() => router.push('/(tabs)/profile/edit')} style={styles.emptyBtn}>
              <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Zalını seç</AppText>
            </PressableScale>
          </View>
        ) : !current ? (
          /* Four different reasons the deck is empty, and the user is told which one:
             today's 30 are spent, the filter is too tight, nobody here clears 60 %,
             or there is genuinely nobody left. */
          <View style={styles.empty}>
            {/* A FIFTH reason the deck can be empty, and the only one that is not
                about the user: the request for this gym's people failed. Saying
                «Hamısını gördün» then claims a measurement — that we looked and
                there is nobody — over a read that never happened. */}
            <Icon
              name={phase === 'failed' ? 'x' : emptyKind === 'cap' ? 'clock' : emptyKind === 'gate' ? 'target' : 'users'}
              size={30}
              color={phase === 'failed' ? palette.red : palette.tertiary}
            />
            <AppText variant="headline" style={{ marginTop: 12 }} center>
              {phase === 'failed'
                ? 'Kartlar yüklənmədi'
                : phase === 'loading'
                  ? 'Yüklənir…'
                  : emptyKind === 'cap'
                    ? 'Bu günün kartları bitdi'
                    : emptyKind === 'filter'
                      ? 'Filtrə uyğun kart yoxdur'
                      : emptyKind === 'gate'
                        ? 'Yüksək uyğunluqlu kart yoxdur'
                        : 'Hamısını gördün'}
            </AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 265, lineHeight: 21 }}>
              {phase === 'failed'
                ? 'Zalındakı adamların siyahısı serverdən gəlmədi — bu, kart olmadığı demək deyil. Bağlantını yoxla və səhifəni yenidən aç.'
                : phase === 'loading'
                  ? 'Zalındakı adamlar yüklənir.'
                  : emptyKind === 'cap'
                    ? `Gündə ən çox ${DAILY_CAP} kart — az, ona görə hər birinə diqqətlə baxılır. Sabah səhər yenidən açılır.`
                    : emptyKind === 'filter'
                      ? 'Seçdiyin filtrə uyğun yeni yoldaş qalmadı. Filtri yumşalt.'
                      : emptyKind === 'gate'
                        ? `Kartlarda yalnız uyğunluğu ${MIN_SCORE}%-dən yuxarı olanlar göstərilir. Bu zalda ${belowGate} nəfər var, amma uyğunluq bu həddən aşağıdır. Profilində saat, səviyyə və məqsədi doldur — uyğunluq dəqiqləşəcək.`
                        : 'Bu zalda cavab vermədiyin yoldaş qalmadı. Yeni adam qoşulanda burada görünəcək.'}
            </AppText>
            {phase === 'failed' || phase === 'loading' ? null : emptyKind === 'filter' ? (
              <PressableScale activeScale={0.96} onPress={() => router.push('/(tabs)/discover/partner-filter')} style={styles.emptyBtn}>
                <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Filtri dəyiş</AppText>
              </PressableScale>
            ) : emptyKind === 'gate' ? (
              <PressableScale activeScale={0.96} onPress={() => router.push('/(tabs)/profile/edit')} style={styles.emptyBtn}>
                <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>Profilini tamamla</AppText>
              </PressableScale>
            ) : null}
            {emptyKind !== 'cap' && usedToday > 0 ? (
              <AppText variant="caption" color={palette.caption} center style={{ marginTop: 14 }}>
                Bu gün {usedToday} / {DAILY_CAP} kart baxılıb.
              </AppText>
            ) : null}
          </View>
        ) : (
          <>
            {next ? (
              <Animated.View style={[styles.cardWrap, styles.behind, nextScale]}>
                <CardFace partner={next} />
              </Animated.View>
            ) : null}
            <GestureDetector gesture={pan}>
              <Animated.View style={[styles.cardWrap, topStyle]}>
                <CardFace partner={current} />
                <Animated.View style={[styles.stamp, styles.likeStamp, likeStyle]}>
                  <AppText style={[styles.stampText, { color: palette.voltDeep }]}>TƏKLİF</AppText>
                </Animated.View>
                <Animated.View style={[styles.stamp, styles.nopeStamp, nopeStyle]}>
                  <AppText style={[styles.stampText, { color: palette.textSecondary }]}>KEÇ</AppText>
                </Animated.View>
              </Animated.View>
            </GestureDetector>
          </>
        )}
      </View>

      {current ? (
        <>
          <View style={styles.controls}>
            <PressableScale activeScale={0.9} onPress={flingSkip} style={[styles.ctrl, styles.ctrlSm]}>
              <Icon name="x" size={26} color={palette.textSecondary} />
            </PressableScale>
            <PressableScale activeScale={0.9} onPress={flingPropose} style={[styles.ctrl, styles.ctrlLg]}>
              <Icon name="dumbbell" size={32} color={palette.volt} />
            </PressableScale>
            <PressableScale activeScale={0.9} onPress={save} style={[styles.ctrl, styles.ctrlSm]}>
              <Icon name="bookmark" size={24} color={savedPartners.includes(current.id) ? palette.voltDeep : palette.textSecondary} />
            </PressableScale>
          </View>
          <AppText variant="caption" color={palette.caption} center style={{ paddingHorizontal: 40 }}>
            Sağa çək = məşq təklif et · sola = keç (kart bir daha gəlmir) · əlfəcin = sonraya saxla
          </AppText>
          {/* The cap is visible before it bites, not only when the deck goes dark. */}
          <AppText variant="caption" color={palette.caption} center style={{ paddingHorizontal: 40, paddingTop: 4, paddingBottom: 10 }}>
            Bu gün qalan kart: {remaining} / {DAILY_CAP}
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}

function CardFace({ partner }: { partner: Partner }) {
  const score = compatOf(partner);
  const { pros, cons } = splitReasons(partner);
  const cardGym = gymById(partner.gymId);
  return (
    <View style={styles.card}>
      <View style={styles.photo}>
        <LinearGradient colors={['#C4C4CB', '#E6E6EA']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Icon name="user" size={34} color="rgba(11,11,14,0.14)" />
        </View>
        <View style={styles.matchBadge}>
          <AppText style={{ color: score === null ? 'rgba(255,255,255,0.75)' : palette.volt, fontSize: 13, fontWeight: '700' }}>
            {score === null ? COMPAT_UNKNOWN_SHORT : `${score}% uyğun`}
          </AppText>
        </View>
        {/* Only a real, checked-in profile may claim presence — never a catalogue entry. */}
        {partner.hereNow && !seedById(partner.id) ? (
          <View style={styles.hereBadge}>
            <View style={styles.hereDot} />
            <AppText style={{ fontSize: 11.5, fontWeight: '600', color: palette.inkText }}>İndi zalda</AppText>
          </View>
        ) : null}
        <LinearGradient colors={['transparent', 'rgba(11,11,14,0.72)']} style={styles.photoScrim} />
        <View style={styles.nameOverlay}>
          <AppText style={{ color: palette.white, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }}>
            {nameWithAge(partner.name, partner.age)}
          </AppText>
          <AppText style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13.5, marginTop: 5 }}>
            {/* The distance segment is drawn only when there IS one. Every seed
                carried `distanceKm: 0` and only the `gyms_near` RPC — which this
                screen never calls — produces a real figure, so «Zal · 0 km» was
                a measurement nobody took, under a gym nobody could name. Every
                other consumer already guards with `distanceKm > 0`. */}
            {cardGym?.name ?? 'Zal'}
            {cardGym && cardGym.distanceKm > 0 ? ` · ${cardGym.distanceKm} km` : ''}
          </AppText>
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.grid}>
          <DataCell label="Səviyyə" value={partner.level ?? 'göstərilməyib'} />
          <DataCell label="Məqsəd" value={partner.goals[0] ?? '—'} />
          <DataCell label="Qrafik" value={partner.usualTime.replace(/\s?\d.*/, '') || partner.usualTime} volt />
          <DataCell label="Tip" value={partner.types[0] ?? '—'} />
        </View>
        {/* No score = no comparison, so there is nothing to explain: the card says
            what is missing instead of listing an app instruction as a reason. */}
        {score === null ? (
          <AppText variant="caption" color={palette.caption} style={{ marginTop: 13, lineHeight: 18 }}>
            Uyğunluq hesablanmayıb — profilində zal, saat, səviyyə və məqsədi doldur.
          </AppText>
        ) : (
          <>
            {pros.length > 0 ? (
              <>
                <AppText variant="caption" color={palette.caption} style={{ marginTop: 13 }}>
                  NİYƏ UYĞUNDUR
                </AppText>
                <AppText variant="body" color={palette.text3} style={{ marginTop: 5, lineHeight: 20 }}>
                  {pros.join(' · ')}
                </AppText>
              </>
            ) : null}
            {/* Mismatches are shown, and never in the «niyə uyğundur» voice. */}
            {cons.length > 0 ? (
              <>
                <AppText variant="caption" color={MISMATCH_COLOR} style={{ marginTop: 11 }}>
                  FƏRQLƏR
                </AppText>
                <AppText variant="body" color={palette.textSecondary} style={{ marginTop: 5, lineHeight: 20 }}>
                  {cons.slice(0, 3).join(' · ')}
                </AppText>
              </>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function DataCell({ label, value, volt }: { label: string; value: string; volt?: boolean }) {
  return (
    <View style={[styles.cell, volt && { backgroundColor: 'rgba(198,255,61,0.26)' }]}>
      <AppText style={[styles.cellLabel, volt && { color: palette.voltDeep }]}>{azUpper(label)}</AppText>
      <AppText style={[styles.cellValue, volt && { color: '#3F5500' }]} numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
  cardWrap: { position: 'absolute', left: 18, right: 18, top: 8 },
  behind: { top: 16 },
  card: { backgroundColor: palette.white, borderRadius: 24, overflow: 'hidden', ...(({ shadowColor: '#101014', shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 8 }) as object) },
  photo: { height: 300 },
  matchBadge: { position: 'absolute', top: 14, left: 14, backgroundColor: palette.ink, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 6 },
  hereBadge: { position: 'absolute', top: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(198,255,61,0.94)', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  hereDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3F5500' },
  photoScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  nameOverlay: { position: 'absolute', left: 16, bottom: 14 },
  body: { padding: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  cell: { width: '47.5%', backgroundColor: palette.grouped, borderRadius: 12, padding: 11 },
  cellLabel: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.5, color: palette.caption },
  cellValue: { fontSize: 14, fontWeight: '600', marginTop: 7 },
  stamp: { position: 'absolute', top: 26, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 3 },
  likeStamp: { left: 20, borderColor: palette.voltDeep, transform: [{ rotate: '-12deg' }] },
  nopeStamp: { right: 20, borderColor: palette.textSecondary, transform: [{ rotate: '12deg' }] },
  stampText: { fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  emptyBtn: { marginTop: 18, height: 44, paddingHorizontal: 20, borderRadius: 13, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, paddingTop: 14, paddingBottom: 6 },
  ctrl: { borderRadius: 40, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center', ...(({ shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }) as object) },
  ctrlSm: { width: 58, height: 58 },
  ctrlLg: { width: 72, height: 72, backgroundColor: palette.ink },
});
