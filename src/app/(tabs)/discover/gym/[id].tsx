import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { GymImage } from '@/components/GymImage';
import { SpotMap } from '@/components/SpotMap';
import { PartnerRow } from '@/components/PartnerRow';
import { TrainerRow } from '@/components/TrainerRow';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { Tag } from '@/components/ui/Tag';
import { Gym, Partner } from '@/data/types';
import { createDayPass, DayPass, getGym, getMyDayPass, getMyProfile, getWhoIsHere } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { usePartnersForGym, usePartnersPhase, useTrainersForGym, useTrainersForGymPhase } from '@/lib/hooks';
import { useKeyboardLift } from '@/components/ui/KeyboardLift';
import { showModerationSheet } from '@/lib/moderation';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { gymById, useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { toast } from '@/store/ui';
import { palette, spacing } from '@/theme';

/** Local wall-clock HH:MM — the pass expiry is stored as a real timestamp. */
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type MyReview = { rating: number; text: string; at: string };
const NO_REVIEWS: MyReview[] = []; // stable ref — avoids an infinite re-render loop

/** «12 sentyabr». The app writes its own Azerbaijani dates everywhere else
 *  (workout/index.tsx, trainer/verify.tsx) rather than trusting Intl month
 *  names on Hermes, and a reply with no date reads as if it arrived today. */
const AZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const dayLabel = (iso: string): string | null => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getDate()} ${AZ_MONTHS[d.getMonth()]}`;
};

interface GymReview {
  id: string;
  name: string;
  tenure: string | null;
  rating: number;
  text: string;
  /** Who wrote it. Read back so the screen can tell that MY review already
   *  reached the server — `reviews_one_per_member` (schema30) refuses a second
   *  one, and the compose button used to keep offering it. */
  authorId: string | null;
  /** The gym's official answer (`reviews.reply` / `reviews.reply_at`, schema7).
   *  The owner panel has been writing it since schema7 and this mapping dropped
   *  both columns, so a reply existed in the database and reached no reader at
   *  all — and «Rəyinə cavab» in Bildirişlər opened the very page that was
   *  hiding it. Null when the gym has not answered. */
  reply: string | null;
  replyAt: string | null;
}

/** Real reviews only. No fallback rows — an empty gym shows an empty state.
 *
 *  «Loaded» used to be set to true by the catch handler as well, so a read that
 *  THREW was indistinguishable from a gym with no reviews and the screen printed
 *  «Hələ rəy yoxdur» over a question it never got to ask. A failed read is now
 *  its own state, and the query's own `error` counts as a failure too — it does
 *  not throw, it comes back in the result. */
function useGymReviews(gymId: string) {
  const [rows, setRows] = useState<GymReview[]>([]);
  const [loaded, setLoaded] = useState(!hasSupabaseConfig);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!hasSupabaseConfig || !gymId) return;
    const { data, error } = await supabase.from('reviews').select('*').eq('gym_id', gymId).order('created_at', { ascending: false });
    if (error) {
      setFailed(true);
      setLoaded(false);
      return;
    }
    setFailed(false);
    setRows(
      (data ?? []).map(
        (r: {
          id: string;
          name: string;
          tenure: string | null;
          rating: number;
          body: string;
          author_id: string | null;
          // Optional on purpose: without supabase/schema7_gym_owner.sql the two
          // reply columns do not exist, and `select('*')` then simply returns
          // rows without them — which is «no reply», not a broken row.
          reply?: string | null;
          reply_at?: string | null;
        }) => ({
          id: r.id,
          name: r.name,
          tenure: r.tenure,
          rating: r.rating,
          text: r.body,
          authorId: r.author_id ?? null,
          reply: r.reply ?? null,
          replyAt: r.reply_at ?? null,
        })
      )
    );
    setLoaded(true);
  }, [gymId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {
        setFailed(true);
        setLoaded(false);
      });
    }, [load])
  );

  return { rows, loaded, failed, reload: load };
}

export default function GymDetail() {
  /* `seg` names the tab to open on. Without it every caller landed on
     «Haqqında»: the «Rəyinə cavab» notification opened this page and left the
     person to find the Rəylər segment themselves, on a screen that gives no
     hint that the thing they tapped for is three taps away. */
  const { id, seg: segParam } = useLocalSearchParams<{ id: string; seg?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const gate = useAuthGate();
  const [seg, setSeg] = useState(segParam === 'reviews' ? 3 : 0);
  const checkIns = useDb((s) => s.checkIns);
  /* Android edge-to-edge never resizes the window, so the KeyboardAvoidingView below
     is inert there and the review composer's «Göndər» ended up under the IME. The
     measured overlap is what works; the tab scene already reserves `insets.bottom`.
     iOS is left to KeyboardAvoidingView — it measures the same overlap itself and does
     it in sync with the keyboard animation, so adding the lift on top of its padding
     would raise the composer twice. */
  const measuredLift = useKeyboardLift(8);
  const keyboardLift = Platform.OS === 'android' ? measuredLift : 0;

  // Local-first: seed immediately, then let the real row win (gyms created in-app
  // have ids that are not in the seed catalogue at all).
  const seedGym = useMemo(() => gymById(id) ?? null, [id]);
  const [remote, setRemote] = useState<Gym | null>(null);
  const [resolved, setResolved] = useState(!hasSupabaseConfig);
  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !id) return;
      let alive = true;
      getGym(id)
        .then((g) => {
          if (!alive) return;
          setRemote(g);
          setResolved(true);
        })
        .catch(() => alive && setResolved(true));
      return () => {
        alive = false;
      };
    }, [id])
  );

  const base = remote ?? seedGym;
  /* Only the server can say how many people are in a gym. `gymLiveCount` reports
     the CURRENT USER's own check-in, so substituting it here made the page tell
     the reader that a stranger was in the room — when the one person there was
     them. With no server answer there is simply no live count. */
  const gym: Gym | null = useMemo(
    () => (base ? { ...base, liveCount: remote ? remote.liveCount : 0 } : null),
    [base, remote]
  );

  const members = usePartnersForGym(id);
  const membersPhase = usePartnersPhase(id);
  const gymTrainers = useTrainersForGym(id);
  const trainersPhase = useTrainersForGymPhase(id);
  const { rows: reviews, loaded: reviewsLoaded, failed: reviewsFailed, reload: reloadReviews } = useGymReviews(id);

  // Presence is only ever claimed for people with a live check-in row.
  const [hereNow, setHereNow] = useState<Partner[]>([]);
  /* A block is a MUTUAL hide — «kəşfdə və söhbətlərdə sənə görünməyəcək» — and a
     declined card is a decision the app must respect everywhere. `getWhoIsHere`
     is the raw server answer and knows neither, so the strip below used to show a
     blocked person's avatar and count them among «sənə uyğundur». The members tab
     (usePartnersForGym) already filters both; this applies the same rule here. */
  const matches = useDb((s) => s.matches);
  const blockedIds = useAppStore((s) => s.blocked);
  const visibleHere = useMemo(
    () => hereNow.filter((p) => matches[p.id]?.state !== 'declined' && !blockedIds.includes(p.id)),
    [hereNow, matches, blockedIds]
  );
  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !id) return;
      let alive = true;
      getWhoIsHere(id)
        .then((p) => alive && setHereNow(p))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [id])
  );

  const bookmarks = useAppStore((s) => s.bookmarks);
  const toggle = useAppStore((s) => s.toggleBookmark);
  const profileName = useAppStore((s) => s.profile.name) || 'Sən';
  const myProfileId = useAppStore((s) => s.profileId);
  const myReviews = useDb((s) => s.myReviews[id]) ?? NO_REVIEWS;
  const addReview = useDb((s) => s.addReview);
  const myCheckins = checkIns.filter((c) => c.gymId === id).length;
  const [composing, setComposing] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [buyingPass, setBuyingPass] = useState(false);
  /* The door code the member shows at reception. It used to live ONLY here, so
     stepping off this screen threw it away while the row stayed in the database —
     the person lost the one thing they were told to show, and the button offered
     to register a second pass. It is read back from the server on every focus.
     `undefined` = not asked yet, `null` = asked and there is none. */
  const [dayPass, setDayPass] = useState<DayPass | null | undefined>(undefined);
  const [passReadFailed, setPassReadFailed] = useState(false);
  const [passChecking, setPassChecking] = useState(false);

  /* One reader for both the focus effect and the retry button. A failed read used
     to be a dead end: the CTA went permanently disabled («Day-pass yoxlanılmadı»)
     and the card told the person to refresh a page that has no pull-to-refresh and
     no retry control at all — the only way back was to guess that leaving the
     screen and returning re-runs this effect. */
  const loadDayPass = useCallback(
    async (isAlive: () => boolean = () => true) => {
      if (!hasSupabaseConfig) return;
      setPassChecking(true);
      try {
        const p = await getMyDayPass(id);
        if (!isAlive()) return;
        setDayPass(p);
        setPassReadFailed(false);
      } catch {
        // A failed read is NOT «no pass»: leaving the button live would let the
        // person register a second one over a first we simply could not see.
        if (isAlive()) setPassReadFailed(true);
      } finally {
        if (isAlive()) setPassChecking(false);
      }
    },
    [id]
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadDayPass(() => alive);
      return () => {
        alive = false;
      };
    }, [loadDayPass])
  );

  /* The review is written to the local store ONLY after the database accepted it
     (or, offline, when there was no database to ask).
     It used to be added BEFORE the insert and never rolled back, so a refusal —
     «hər zala bir rəy», the 3-check-in rule, a dropped connection — left a
     phantom review on the page wearing the «Sənin rəyin» shield AND folded its
     stars into the gym's header average, for a row the server never had. The
     tail of this function also cleared the box unconditionally, so the refusal
     destroyed the draft the person had just typed. */
  const submitReview = async () => {
    const body = reviewText.trim();
    if (!body || !gym) return;
    setSavingReview(true);
    if (hasSupabaseConfig) {
      try {
        // `author_id` is REQUIRED by `reviews_insert` (schema29/30). Without it
        // the policy refused every single review — the row never reached the gym
        // and the catch below blamed the internet for a rule the database was
        // enforcing on purpose. It is also what `can_review_gym` checks the
        // three check-ins against.
        const me = await getMyProfile();
        if (!me?.id) throw new Error('no-profile');
        const { error } = await supabase.from('reviews').insert({
          gym_id: id,
          author_id: me.id,
          name: profileName,
          tenure: `${myCheckins} check-in edib`,
          rating,
          body,
        });
        if (error) throw error;
        await reloadReviews().catch(() => {});
        toast('Rəyin göndərildi');
      } catch (e) {
        // A refusal is not a network problem. Say which rule stopped it, so the
        // person is not told to check a connection that is working.
        const msg = String((e as { message?: string })?.message ?? '');
        toast(
          msg.includes('duplicate key') || msg.includes('reviews_one_per_member')
            ? 'Bu zala rəyini artıq yazmısan — hər zala bir rəy yazmaq olar.'
            : msg.includes('row-level security') || msg.includes('violates')
              ? 'Rəy qəbul edilmədi — bu zalda ən azı 3 check-in lazımdır və hər zala bir rəy yazmaq olar.'
              : msg === 'no-profile'
                ? 'Profil tapılmadı — rəy yazmaq üçün profilini tamamla.'
                : 'Rəy zala çatmadı — internet yoxlanılsın, sonra yenidən yaz',
          'error'
        );
        // The draft stays exactly where it was — the composer, the text and the
        // stars — so «yenidən yaz» means one tap, not retyping from memory.
        setSavingReview(false);
        return;
      }
    } else {
      // No backend to refuse it: this really is a device-only note, and it is
      // labelled as one below instead of joining the gym's rating.
      addReview(id, rating, body);
      toast('Rəy yalnız cihazda saxlanıldı — zala çatması üçün internet lazımdır', 'info');
    }
    setSavingReview(false);
    setReviewText('');
    setRating(5);
    setComposing(false);
  };

  const getDayPass = () => {
    if (!gym) return;
    gate(async () => {
      if (!hasSupabaseConfig) {
        toast('Day-pass qeydə alınmadı — internet bağlantısı lazımdır', 'error');
        return;
      }
      setBuyingPass(true);
      try {
        const pass = await createDayPass(gym.id);
        setDayPass(pass);
        setPassReadFailed(false);
        // Pressing again while a pass is live returns the SAME one. Saying
        // «qeydə alındı» then would claim a second registration that did not
        // happen, so the two cases are named apart.
        toast(pass.reused ? 'Bu zal üçün day-pass artıq var — kod aşağıdadır' : 'Day-pass qeydə alındı — kod aşağıdadır');
      } catch {
        toast('Day-pass alınmadı — yenidən cəhd et', 'error');
      } finally {
        setBuyingPass(false);
      }
    }, 'Day-pass üçün');
  };

  // Coordinates only exist once the gym owner pinned the place on the map.
  const coords = gym && typeof gym.lat === 'number' && typeof gym.lng === 'number' ? { lat: gym.lat, lng: gym.lng } : null;

  /**
   * Hand the location to the device's own maps app. `geo:` is the native Android
   * intent; iOS rejects it, so we fall back to a Google Maps web URL — by
   * coordinates when we have them, by name otherwise (never a made-up pin).
   */
  const openDirections = () => {
    if (!gym) return;
    const web = coords
      ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${gym.name} ${gym.district ?? ''}`.trim())}`;
    const fail = () => toast('Xəritə açılmadı', 'error');
    if (coords) {
      Linking.openURL(`geo:${coords.lat},${coords.lng}?q=${coords.lat},${coords.lng}(${encodeURIComponent(gym.name)})`).catch(() =>
        Linking.openURL(web).catch(fail)
      );
      return;
    }
    Linking.openURL(web).catch(fail);
  };

  if (!gym) {
    return (
      /* Pushed inside the discover tab: the scene padding already reserves the
         floating bar's footprint, bottom inset included — no 'bottom' edge here. */
      <Screen edges={['top']} padded>
        <View style={styles.missing}>
          <Icon name="pin" size={30} color={palette.tertiary} />
          <AppText variant="headline" style={{ marginTop: 12 }}>
            {resolved ? 'Zal tapılmadı' : 'Yüklənir…'}
          </AppText>
          {resolved ? (
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 260, lineHeight: 21 }}>
              Bu zal silinib və ya ünvan səhvdir.
            </AppText>
          ) : null}
          <Button title="Geri" variant="secondary" onPress={() => router.back()} style={{ marginTop: 18, height: 44, paddingHorizontal: 26 }} />
        </View>
      </Screen>
    );
  }

  const saved = bookmarks.includes(gym.id);
  // My locally-stored review is only rendered while the server copy is not back yet,
  // so a synced review is never counted twice.
  const mineOnly = myReviews.filter((r) => !reviews.some((x) => x.name === profileName && x.text === r.text));
  /* The header rating is the GYM's rating, so it is computed from the rows the
     database actually holds. Device-only notes used to be averaged in and added
     to «N rəy», which meant the author — and only the author — saw a star figure
     for a review nobody else has. They are still shown below, marked as unsent. */
  const totalReviews = reviews.length;
  const avgRating = totalReviews
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / totalReviews) * 10) / 10
    : null;
  /* One review per person per gym (`reviews_one_per_member`, schema30). Offering
     «Rəy yaz» to somebody who already has one only leads to a refusal, so the
     button is replaced by the reason it is gone. */
  const iAlreadyReviewed = !!myProfileId && reviews.some((r) => r.authorId === myProfileId);

  const heroActions = (
    <View style={[styles.heroTop, { paddingTop: insets.top + 6 }]}>
      <PressableScale activeScale={0.9} onPress={() => router.back()} style={styles.circleBtn}>
        <Icon name="chevL" size={20} color={palette.inkText} />
      </PressableScale>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <PressableScale
          activeScale={0.9}
          onPress={() =>
            Share.share({ message: `${gym.name}${gym.district ? ' — ' + gym.district : ''} · ${gym.priceMonth} ₼/ay. SPOT-da bax.` }).catch(() => {})
          }
          style={styles.circleBtn}>
          <Icon name="share" size={17} color={palette.inkText} />
        </PressableScale>
        <PressableScale activeScale={0.9} onPress={() => toggle(gym.id)} style={styles.circleBtn}>
          <Icon name="bookmark" size={18} color={saved ? palette.voltDeep : palette.inkText} />
        </PressableScale>
        <PressableScale activeScale={0.9} onPress={() => showModerationSheet(gym.name, { type: 'gym', id: gym.id })} style={styles.circleBtn}>
          <Icon name="more" size={18} color={palette.inkText} />
        </PressableScale>
      </View>
    </View>
  );

  const photos = gym.photos ?? [];
  const schedule = gym.schedule ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: palette.grouped }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          /* The lift is a LAYOUT change on the scroller itself, not padding inside it:
             shrinking the ScrollView is what makes Android scroll the focused review
             box into view. Extra bottom padding alone would only add scroll range the
             user still has to drag by hand while typing blind. */
          style={{ marginBottom: keyboardLift }}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled">
          {/* Hero — the gym's own cover photo when it has one, else the branded placeholder */}
          {gym.imageUrl ? (
            <View style={styles.hero}>
              <Image source={{ uri: gym.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
              <LinearGradient colors={['rgba(11,11,14,0.35)', 'transparent']} style={styles.heroScrim} />
              {heroActions}
            </View>
          ) : (
            <GymImage name={gym.name} height={250}>
              {heroActions}
            </GymImage>
          )}

          {/* Sheet */}
          <View style={styles.sheet}>
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.nameRow}>
                  <AppText variant="title">{gym.name}</AppText>
                  {gym.verified && <Icon name="verified" size={18} color={palette.blue} />}
                </View>
                <View style={styles.ratingRow}>
                  {avgRating !== null ? (
                    <>
                      <Icon name="star" size={14} color={palette.streak} />
                      <AppText style={styles.rating}>{avgRating}</AppText>
                      <AppText variant="footnote" color={palette.caption}>
                        · {totalReviews} rəy ·{' '}
                      </AppText>
                    </>
                  ) : (
                    <AppText variant="footnote" color={palette.caption}>
                      Hələ rəy yoxdur ·{' '}
                    </AppText>
                  )}
                  <AppText variant="footnote" color={palette.caption}>
                    {gym.district}
                    {gym.distanceKm > 0 ? `, ${gym.distanceKm} km` : ''}
                  </AppText>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <AppText variant="title2">{gym.priceMonth} ₼</AppText>
                <AppText variant="caption" color={palette.caption}>
                  aylıq · məlumat
                </AppText>
              </View>
            </View>

            <View style={styles.ctaRow}>
              {/* «QR ilə check-in» named a mechanism the app does not have: the
                  screen this opens is a GPS check-in whose own footnote ends «QR
                  oxuyucu hələ yoxdur», so somebody standing in front of the gym's
                  printed code tapped it expecting a camera and got a location
                  permission prompt instead. The button now says what it does.

                  It opens the ROOT `/checkin`, not `/(tabs)/workout/checkin`:
                  the tab route switched the focused tab to Məşq, so the check-in
                  screen's own `router.back()` popped inside the Məşq stack and
                  dropped somebody who started on this gym page in Kəşf onto
                  Məşq home instead of back here. */}
              <Button
                title="Check-in et"
                icon="pin"
                onPress={() => router.push({ pathname: '/checkin', params: { gymId: gym.id } })}
                style={{ flex: 1, height: 46 }}
              />
              <Button
                title={
                  buyingPass
                    ? /* «Alınır…» put a purchase verb straight onto a price tag on the
                         one screen where SPOT takes no money. The RPC only issues a
                         code — the same words the success toast uses. */
                      'Qeydə alınır…'
                    : dayPass
                      ? 'Day-pass aktivdir'
                      : passReadFailed
                        ? 'Day-pass yoxlanılmadı'
                        : `1 günlük · ${gym.dayPass} ₼`
                }
                variant="secondary"
                disabled={buyingPass || !!dayPass || passReadFailed}
                onPress={getDayPass}
                style={{ flex: 1, height: 46 }}
              />
            </View>
            <AppText variant="caption" color={palette.caption} style={{ marginTop: 8, lineHeight: 17 }}>
              Üzvlük zalın özündə rəsmiləşir — SPOT ödəniş qəbul etmir, qiymətlər yalnız məlumat üçündür.
            </AppText>

            {/* The pass is only useful with its door code — show it, do not just claim success. */}
            {dayPass ? (
              <View style={styles.passCard}>
                <View style={styles.passHead}>
                  <Icon name="qr" size={15} color={palette.voltDeep} />
                  <AppText variant="overline" color={palette.voltDeep}>
                    DAY-PASS KODU
                  </AppText>
                </View>
                <AppText style={styles.passCode}>{dayPass.code}</AppText>
                <AppText variant="footnote" color={palette.text3} style={{ marginTop: 6, lineHeight: 18 }}>
                  Resepsiyada bu kodu göstər — zal onu SPOT panelindən yoxlayır. Bu gün {hhmm(dayPass.expiresAt)}-a qədər
                  keçərlidir. {dayPass.price} ₼ zalın özünə ödənilir; SPOT komissiya götürmür.
                </AppText>
              </View>
            ) : passReadFailed ? (
              /* Not «you have no pass» — we could not find out. Drawing the buy
                 button over a pass that exists is how someone ends up with two.
                 The card carries its own retry: the copy used to send people to
                 refresh a page that has neither pull-to-refresh nor a button. */
              <View style={styles.passCard}>
                <AppText variant="footnote" color={palette.text3} style={{ lineHeight: 18 }}>
                  Day-pass məlumatın yüklənmədi — bu, day-pass olmadığı demək deyil. Bağlantını yoxla və yenidən yoxlat.
                </AppText>
                <Button
                  title={passChecking ? 'Yoxlanılır…' : 'Yenidən yoxla'}
                  variant="secondary"
                  disabled={passChecking}
                  onPress={() => void loadDayPass()}
                  style={{ marginTop: 10, height: 42 }}
                />
              </View>
            ) : null}

            {/* Live banner — only when someone is really checked in */}
            {gym.liveCount > 0 ? (
              <PressableScale activeScale={0.98} onPress={() => setSeg(2)} style={styles.liveBanner}>
                {visibleHere.length > 0 ? (
                  <View style={styles.avatars}>
                    {visibleHere.slice(0, 3).map((p, i) => (
                      <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                        <Avatar name={p.name} size={28} />
                      </View>
                    ))}
                    {/* Counts the faces we may actually show, not the raw headcount —
                        a «+2» that includes blocked people is a face by another name. */}
                    {visibleHere.length > 3 ? (
                      <View style={[styles.avatarDot, styles.avatarMore]}>
                        <AppText style={{ fontSize: 10, fontWeight: '700', color: palette.volt }}>+{visibleHere.length - 3}</AppText>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <AppText style={styles.liveText}>
                  {gym.liveCount} nəfər indi zalda
                  {visibleHere.length > 0 ? ` · ${visibleHere.length}-i sənə uyğundur` : ''}
                </AppText>
                <Icon name="chevR" size={17} color={palette.voltDeep} />
              </PressableScale>
            ) : null}

            <View style={{ marginTop: 16 }}>
              <Segmented options={['Haqqında', 'Müəllimlər', 'Üzvlər', 'Rəylər']} value={seg} onChange={setSeg} />
            </View>

            <View style={{ marginTop: 16 }}>
              {seg === 0 && (
                <>
                  {gym.about ? (
                    <AppText variant="body" color={palette.text3} style={{ lineHeight: 22 }}>
                      {gym.about}
                    </AppText>
                  ) : null}
                  <View style={styles.infoRow}>
                    <InfoCard icon="clock" title={gym.hours} sub="iş saatı" />
                    {/* `gyms.trainers` is a seeded column nothing maintains — it claimed
                        «9 müəllim» on a gym whose Müəllimlər tab correctly says there are
                        none. The count comes from the real trainer rows this screen
                        already fetched, and a figure appears only when it is real: a
                        zero here is an absence, not a measurement. */}
                    {gym.members > 0 || gymTrainers.length > 0 ? (
                      <InfoCard
                        icon="users"
                        title={gym.members > 0 ? `${gym.members} üzv` : `${gymTrainers.length} müəllim`}
                        sub={
                          gym.members > 0 && gymTrainers.length > 0
                            ? `${gymTrainers.length} müəllim`
                            : 'SPOT-da qeydiyyatlı'
                        }
                      />
                    ) : null}
                    <InfoCard icon="pin" title={gym.district} sub="Yol göstər" onPress={openDirections} />
                  </View>
                  {/* Real photos the gym uploaded — nothing is shown when there are none. */}
                  {photos.length > 0 ? (
                    <>
                      <AppText variant="overline" color={palette.caption} style={{ marginTop: 20, marginBottom: 10 }}>
                        Şəkillər · {photos.length}
                      </AppText>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 8 }}
                        style={{ marginHorizontal: -spacing.screen, paddingHorizontal: spacing.screen }}>
                        {photos.map((uri) => (
                          <Image key={uri} source={{ uri }} style={styles.photo} contentFit="cover" transition={180} />
                        ))}
                      </ScrollView>
                    </>
                  ) : null}

                  {/* Location — only drawn when the gym was actually pinned on the map. */}
                  {coords ? (
                    <>
                      <AppText variant="overline" color={palette.caption} style={{ marginTop: 20, marginBottom: 10 }}>
                        Yeri
                      </AppText>
                      <PressableScale
                        activeScale={0.98}
                        onPress={openDirections}
                        accessibilityRole="button"
                        accessibilityLabel={`${gym.name} — yol göstər`}
                        style={styles.mapCard}>
                        {/* preview only: touches go to the card, not into the map */}
                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                          <SpotMap
                            markers={[{ id: gym.id, lat: coords.lat, lng: coords.lng, title: gym.name, subtitle: gym.district, active: true }]}
                            center={coords}
                            zoom={15}
                            style={styles.mapFill}
                          />
                        </View>
                        <View style={styles.mapCta}>
                          <Icon name="pin" size={15} color={palette.inkText} />
                          <AppText style={styles.mapCtaText}>Yol göstər</AppText>
                        </View>
                      </PressableScale>
                    </>
                  ) : null}

                  {/* The class timetable, as the gym's own owner typed it into
                      `/gym/classes`. It has been saved to `gyms.schedule` since
                      schema7 and nothing customer-facing ever read it back, so
                      an owner could fill in a whole week and be the only person
                      alive who could see it. Nothing is drawn when the array is
                      empty — an unwritten timetable is not «no classes». */}
                  {schedule.length > 0 ? (
                    <>
                      <AppText variant="overline" color={palette.caption} style={{ marginTop: 20, marginBottom: 10 }}>
                        Cədvəl
                      </AppText>
                      <View style={{ gap: 9 }}>
                        {schedule.map((c, i) => (
                          <View key={`${c.time}-${c.name}-${i}`} style={styles.classRow}>
                            <AppText style={styles.classTime}>{c.time}</AppText>
                            <View style={styles.classDiv} />
                            <View style={{ flex: 1 }}>
                              <AppText style={{ fontSize: 15, fontWeight: '600' }}>{c.name}</AppText>
                              {/* The trainer field is optional in the owner panel;
                                  a blank line under the class name would read as a
                                  name we failed to load. */}
                              {c.trainer ? (
                                <AppText style={{ fontSize: 12, color: palette.tertiary, marginTop: 4 }}>{c.trainer}</AppText>
                              ) : null}
                            </View>
                          </View>
                        ))}
                      </View>
                      {/* Said plainly, because a timetable looks like something you
                          can tap to book: SPOT has no places, no queue and no
                          booking, so it must not imply one. */}
                      <AppText variant="caption" color={palette.caption} style={{ marginTop: 9, lineHeight: 17 }}>
                        Cədvəli zalın özü yazır. Dərsə yazılma SPOT-da yoxdur — yer üçün zalla danış.
                      </AppText>
                    </>
                  ) : null}

                  {gym.amenities.length > 0 ? (
                    <>
                      <AppText variant="overline" color={palette.caption} style={{ marginTop: 20, marginBottom: 10 }}>
                        İmkanlar
                      </AppText>
                      <View style={styles.amenities}>
                        {gym.amenities.map((a) => (
                          <Tag key={a} label={a} />
                        ))}
                      </View>
                    </>
                  ) : null}
                </>
              )}

              {seg === 1 && (
                <View>
                  {gymTrainers.length === 0 ? (
                    /* «Bu zalda hələ müəllim yoxdur» is a statement about the gym.
                       When the request failed it is a statement about our own
                       connection, and it sends a customer away from a coach who
                       is right there. The reviews tab on this same screen already
                       drew the distinction; the trainer and member tabs did not. */
                    <EmptyState
                      icon={trainersPhase === 'failed' ? 'x' : 'user'}
                      text={
                        trainersPhase === 'failed'
                          ? 'Müəllimlər yüklənmədi — serverlə əlaqə alınmadı. Bu, zalda müəllim olmadığı demək deyil.'
                          : trainersPhase === 'loading'
                            ? 'Müəllimlər yüklənir…'
                            : 'Bu zalda hələ SPOT-da qeydiyyatdan keçmiş müəllim yoxdur.'
                      }
                    />
                  ) : (
                    gymTrainers.map((t) => (
                      <TrainerRow key={t.id} trainer={t} onPress={() => router.push({ pathname: '/(tabs)/discover/trainer/[id]', params: { id: t.id } })} />
                    ))
                  )}
                </View>
              )}

              {seg === 2 && (
                <View>
                  {members.length === 0 ? (
                    <EmptyState
                      icon={membersPhase === 'failed' ? 'x' : 'users'}
                      text={
                        membersPhase === 'failed'
                          ? 'Üzvlər yüklənmədi — serverlə əlaqə alınmadı. Bu, zalda istifadəçi olmadığı demək deyil.'
                          : membersPhase === 'loading'
                            ? 'Üzvlər yüklənir…'
                            : 'Bu zalda hələ SPOT istifadəçisi yoxdur. Birinci sən ol — check-in et.'
                      }
                    />
                  ) : (
                    <>
                      <View style={styles.hintRow}>
                        <Icon name="msg" size={15} color={palette.textSecondary} />
                        <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
                          Bu zalı öz zalı seçən istifadəçilər. Uyğunluq sənin cədvəlinə görə hesablanır.
                        </AppText>
                      </View>
                      {members.map((p) => (
                        <PartnerRow key={p.id} partner={p} onPress={() => router.push({ pathname: '/(tabs)/discover/partner/[id]', params: { id: p.id } })} />
                      ))}
                    </>
                  )}
                </View>
              )}

              {seg === 3 && (
                <View>
                  {/* Already reviewed → no compose button. The database allows one
                      review per person per gym, so the button could only produce a
                      refusal that the person had to read to find that out. */}
                  {iAlreadyReviewed ? (
                    <View style={styles.gateCard}>
                      <Icon name="check" size={18} color={palette.voltDeep} />
                      <View style={{ flex: 1 }}>
                        <AppText variant="callout">Bu zala rəyini yazmısan</AppText>
                        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 3, lineHeight: 18 }}>
                          Hər zala bir rəy yazmaq olar — rəyin aşağıdakı siyahıdadır.
                        </AppText>
                      </View>
                    </View>
                  ) : /* 3-check-in gate — only real gym-goers can review (prevents fake reviews) */
                  myCheckins >= 3 ? (
                    composing ? (
                      <View style={styles.composeCard}>
                        <AppText variant="headline">Rəyin</AppText>
                        <View style={styles.starRow}>
                          {[1, 2, 3, 4, 5].map((s) => (
                            <PressableScale
                              key={s}
                              activeScale={0.85}
                              onPress={() => setRating(s)}
                              accessibilityRole="button"
                              accessibilityLabel={`${s} ulduz`}
                              accessibilityState={{ selected: s <= rating }}>
                              <Icon name="star" size={30} color={s <= rating ? palette.streak : palette.separator} />
                            </PressableScale>
                          ))}
                        </View>
                        <TextInput
                          value={reviewText}
                          onChangeText={setReviewText}
                          placeholder="Təcrübəni yaz…"
                          placeholderTextColor={palette.caption}
                          multiline
                          style={styles.reviewInput}
                        />
                        <View style={{ flexDirection: 'row', gap: 9 }}>
                          <Button title="Ləğv et" variant="secondary" onPress={() => setComposing(false)} style={{ flex: 1, height: 44 }} />
                          <Button
                            title={savingReview ? 'Göndərilir…' : 'Göndər'}
                            disabled={savingReview || !reviewText.trim()}
                            onPress={submitReview}
                            style={{ flex: 1, height: 44 }}
                          />
                        </View>
                      </View>
                    ) : (
                      <Button title="Rəy yaz" icon="edit" full onPress={() => setComposing(true)} style={{ marginBottom: 14 }} />
                    )
                  ) : (
                    <View style={styles.gateCard}>
                      <Icon name="lock" size={18} color={palette.textSecondary} />
                      <View style={{ flex: 1 }}>
                        <AppText variant="callout">Rəy yazmaq üçün {3 - myCheckins} check-in qalıb</AppText>
                        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 3, lineHeight: 18 }}>
                          Yalnız bu zalda ən azı 3 dəfə check-in edən rəy yaza bilər — saxta rəylərin qarşısını alır. ({myCheckins}/3)
                        </AppText>
                      </View>
                    </View>
                  )}

                  {mineOnly.map((r, i) => (
                    <View key={`mine-${i}`} style={styles.review}>
                      <View style={styles.reviewHead}>
                        <AppText variant="headline">{profileName}</AppText>
                        <View style={{ flexDirection: 'row', gap: 2 }}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <Icon key={j} name="star" size={12} color={j < r.rating ? palette.streak : palette.separator} />
                          ))}
                        </View>
                      </View>
                      {/* A verification-style shield on a row the gym never received
                          read as «your review is live here». These are the copies
                          that only exist on this phone, so they say so. */}
                      <View style={styles.tenure}>
                        <Icon name="clock" size={12} color={palette.textSecondary} />
                        <AppText style={{ fontSize: 11, fontWeight: '600', color: palette.textSecondary }}>
                          Yalnız sənin cihazında — zala göndərilməyib
                        </AppText>
                      </View>
                      <AppText variant="body" color={palette.text3} style={{ marginTop: 8, lineHeight: 21 }}>
                        {r.text}
                      </AppText>
                    </View>
                  ))}

                  {reviews.map((r) => (
                    <View key={r.id} style={styles.review}>
                      <View style={styles.reviewHead}>
                        <AppText variant="headline">{r.name}</AppText>
                        <View style={{ flexDirection: 'row', gap: 2 }}>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Icon key={i} name="star" size={12} color={i < r.rating ? palette.streak : palette.separator} />
                          ))}
                        </View>
                      </View>
                      {r.tenure ? (
                        <View style={styles.tenure}>
                          <Icon name="shield" size={12} color={palette.voltDeep} />
                          <AppText style={{ fontSize: 11, fontWeight: '600', color: palette.voltDeep }}>{r.tenure}</AppText>
                        </View>
                      ) : null}
                      <AppText variant="body" color={palette.text3} style={{ marginTop: 8, lineHeight: 21 }}>
                        {r.text}
                      </AppText>
                      {/* The gym's official answer. It is written on the owner
                          panel (gym/reviews.tsx) and, until now, read there and
                          nowhere else — the person it was addressed to never saw
                          it. Same card as the owner's own view, so both sides
                          read the same words. */}
                      {r.reply ? (
                        <View style={styles.reply}>
                          <AppText style={{ fontSize: 12, fontWeight: '700', color: palette.blue }}>
                            {gym.name} · rəsmi cavab
                            {r.replyAt && dayLabel(r.replyAt) ? ` · ${dayLabel(r.replyAt)}` : ''}
                          </AppText>
                          <AppText variant="footnote" color={palette.text3} style={{ marginTop: 4, lineHeight: 18 }}>
                            {r.reply}
                          </AppText>
                        </View>
                      ) : null}
                    </View>
                  ))}

                  {reviewsFailed ? (
                    <EmptyState
                      icon="x"
                      text="Rəylər yüklənmədi — serverlə əlaqə alınmadı. Bu, zalda rəy olmadığı demək deyil."
                    />
                  ) : reviewsLoaded && totalReviews === 0 && mineOnly.length === 0 ? (
                    <EmptyState
                      icon="star"
                      text={
                        myCheckins >= 3
                          ? 'Hələ rəy yoxdur — ilk rəyi sən yaz.'
                          : 'Hələ rəy yoxdur. Bu zalda 3 check-in etdikdən sonra ilk rəyi sən yaza bilərsən.'
                      }
                    />
                  ) : null}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function EmptyState({ icon, text }: { icon: 'user' | 'users' | 'star' | 'x'; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Icon name={icon} size={24} color={palette.tertiary} />
      <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 270, lineHeight: 21 }}>
        {text}
      </AppText>
    </View>
  );
}

function InfoCard({ icon, title, sub, onPress }: { icon: 'clock' | 'users' | 'pin'; title: string; sub: string; onPress?: () => void }) {
  const body = (
    <>
      <Icon name={icon} size={18} color={palette.textSecondary} />
      <AppText style={{ fontSize: 13.5, fontWeight: '600', marginTop: 8 }} numberOfLines={1}>
        {title}
      </AppText>
      <AppText style={{ fontSize: 11.5, color: onPress ? palette.blue : palette.caption, marginTop: 3 }}>{sub}</AppText>
    </>
  );
  if (onPress) {
    return (
      <PressableScale activeScale={0.96} onPress={onPress} style={styles.infoCard} accessibilityRole="button" accessibilityLabel={`${title} — yol göstər`}>
        {body}
      </PressableScale>
    );
  }
  return <View style={styles.infoCard}>{body}</View>;
}

const styles = StyleSheet.create({
  hero: { height: 250, backgroundColor: palette.element },
  heroScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%' },
  photo: { width: 148, height: 106, borderRadius: 14, backgroundColor: palette.element },
  mapCard: { height: 180, borderRadius: 16, overflow: 'hidden', backgroundColor: palette.element },
  mapFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mapCta: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mapCtaText: { fontSize: 13.5, fontWeight: '600', color: palette.inkText },
  heroTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.base },
  circleBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.82)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: palette.grouped, borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: -20, paddingHorizontal: spacing.screen, paddingTop: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7, flexWrap: 'wrap' },
  gateCard: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: palette.white, borderRadius: 14, padding: 15, marginBottom: 14 },
  composeCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginBottom: 14, gap: 12 },
  starRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  reviewInput: { minHeight: 80, borderRadius: 12, backgroundColor: palette.grouped, padding: 12, fontSize: 15, color: palette.inkText, textAlignVertical: 'top' },
  rating: { fontSize: 13.5, fontWeight: '600' },
  ctaRow: { flexDirection: 'row', gap: 9, marginTop: 15 },
  liveBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(198,255,61,0.22)', borderRadius: 14, padding: 12, marginTop: 12 },
  passCard: { backgroundColor: palette.white, borderRadius: 14, padding: 14, marginTop: 12, borderWidth: 1, borderColor: 'rgba(198,255,61,0.9)' },
  passHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  passCode: { fontSize: 30, fontWeight: '800', letterSpacing: 3, marginTop: 8, color: palette.inkText },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#F6FBEA' },
  avatarMore: { marginLeft: -10, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
  liveText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#3F5500', lineHeight: 18 },
  infoRow: { flexDirection: 'row', gap: 9, marginTop: 14 },
  infoCard: { flex: 1, backgroundColor: palette.white, borderRadius: 14, padding: 13 },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.white, borderRadius: 12, padding: 12, marginBottom: 6 },
  review: { backgroundColor: palette.white, borderRadius: 14, padding: 14, marginBottom: 10 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Same card the owner panel draws its own reply in (src/app/gym/reviews.tsx).
  reply: { backgroundColor: 'rgba(10,132,255,0.06)', borderRadius: 12, padding: 12, marginTop: 12 },
  classRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 13 },
  classTime: { fontSize: 16, fontWeight: '700', width: 52 },
  classDiv: { width: 1, alignSelf: 'stretch', backgroundColor: palette.separator },
  tenure: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  emptyState: { alignItems: 'center', paddingVertical: 34 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
