import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { errorFeedback, successFeedback } from '@/lib/feedback';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import type { Gym } from '@/data/types';
import { CheckInError, checkIn as checkInApi } from '@/lib/api';
import { useAuthGate } from '@/lib/authGate';
import { useGyms } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { dayKey, gymById, useDb, useStats } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { palette } from '@/theme';

/** Design rule: a manual check-in only counts within 150 m of the gym. */
const MAX_DISTANCE_M = 150;

/** Metres between two WGS-84 points (haversine). */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const hasCoords = (g?: Gym): g is Gym & { lat: number; lng: number } =>
  !!g && typeof g.lat === 'number' && typeof g.lng === 'number' && Number.isFinite(g.lat) && Number.isFinite(g.lng);

/**
 * `gyms.hours` is free text written by the gym owner («6:00–24:00», «24 saat», «7:00 - 23:00»).
 * We only claim to have checked the hours when we could actually read them:
 *   - 'always'  → the gym says it never closes
 *   - 'open' / 'closed' → parsed a real window and compared it to the clock
 *   - 'unknown' → the text is empty or unparseable; the screen SAYS so instead of
 *     pretending the hours were verified.
 */
type HoursVerdict = { state: 'always' | 'open' | 'closed' | 'unknown'; window?: string };

function checkHours(raw: string | undefined, now: Date): HoursVerdict {
  const text = (raw ?? '').trim();
  if (!text) return { state: 'unknown' };
  if (/24\s*\/\s*7|24\s*saat|həmişə|24h/i.test(text)) return { state: 'always' };

  const m = text.match(/(\d{1,2})[:.](\d{2})\s*[–—\-−]\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return { state: 'unknown' };
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return { state: 'unknown' };
  const label = `${m[1]}:${m[2]}–${m[3]}:${m[4]}`;
  if (open === close) return { state: 'always' };

  const mins = now.getHours() * 60 + now.getMinutes();
  // A closing time at or past midnight (24:00, or 02:00 after a 22:00 open) wraps.
  const isOpen = close > open ? mins >= open && mins < close : mins >= open || mins < close;
  return { state: isOpen ? 'open' : 'closed', window: label };
}

/** The server's refusal, in Azerbaijani. Every number here is the one the
 *  database actually measured and sent back — never a guess, never rounded up
 *  into something friendlier. */
function refusalText(e: CheckInError, gymLabel: string): string {
  switch (e.code) {
    case 'already_today':
      return 'Serverdə bu gün üçün artıq check-in var. Növbəti check-in sabah saat 04:00-dan sonra açılır.';
    case 'too_far': {
      const m = Number(e.detail);
      if (!Number.isFinite(m)) return `${gymLabel} çox uzaqdadır. Check-in yalnız zalın ${MAX_DISTANCE_M} m radiusunda edilir.`;
      return m > 2000
        ? `${gymLabel} təxminən ${(m / 1000).toFixed(1)} km uzaqdadır. Check-in yalnız zalın ${MAX_DISTANCE_M} m radiusunda edilir.`
        : `${gymLabel} təxminən ${m} m uzaqdadır. Check-in yalnız zalın ${MAX_DISTANCE_M} m radiusunda edilir.`;
    }
    case 'closed':
      return e.detail
        ? `${gymLabel} indi bağlıdır (${e.detail}). Check-in yalnız iş saatlarında edilir.`
        : `${gymLabel} indi bağlıdır. Check-in yalnız iş saatlarında edilir.`;
    case 'gym_no_coords':
      return `${gymLabel} üçün koordinat qeyd olunmayıb — sənin zalda olduğunu yoxlaya bilmirik, ona görə check-in edilmir. Zal sahibi ünvanı xəritədə göstərəndən sonra işləyəcək.`;
    case 'no_position':
      return 'Lokasiyan serverə düzgün çatmadı. GPS-i aç və yenidən cəhd et.';
    case 'sanctioned':
      return 'Hesabına məhdudiyyət qoyulub — check-in daxil olmaqla yeni qeydlər bağlıdır.';
    case 'not_signed_in':
      return 'Bu cihazda profil tapılmadı. Profilini tamamla və yenidən cəhd et.';
    case 'no_gym':
      return 'Bu zal artıq siyahıda yoxdur.';
    default:
      return 'Check-in serverdə qeydə alınmadı.';
  }
}

export default function CheckIn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [done, setDone] = useState(false);
  // null = write still in flight, true = the server really has the row,
  // false = only this device knows about it.
  const [synced, setSynced] = useState<boolean | null>(null);
  // Why the check-in was refused before it was ever written. Plain Azerbaijani,
  // always naming the actual reason — never a generic "alınmadı".
  const [refused, setRefused] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const { gymId: gymParam } = useLocalSearchParams<{ gymId?: string }>();
  const profileGym = useAppStore((s) => s.profile.homeGymId);
  // No fallback gym: if the person never picked one, we must not check them into a gym
  // they never chose. `gymId` stays null and the screen asks them to pick one.
  const gymId = gymParam ?? profileGym ?? null;

  const gate = useAuthGate();
  const stats = useStats(); // real streak — recomputed after the check-in below
  const checkIns = useDb((s) => s.checkIns);
  // The server-backed catalogue carries the real lat/lng/hours; the seed row is the
  // offline fallback. Without coordinates the distance gate cannot run at all.
  const gyms = useGyms();
  const gym = useMemo(
    () => (gymId ? (gyms.find((g) => g.id === gymId) ?? gymById(gymId)) : undefined),
    [gyms, gymId]
  );

  // The gym day comes from `dayKey` (src/store/db.ts) — the SAME function the
  // streak engine and schema19's `gym_day` column agree on. This screen used to
  // carry its own copy that subtracted 4 local hours and then read the UTC date,
  // which lands 4 h off: between 04:00 and 08:00 it reported YESTERDAY, so anyone
  // who trained the previous evening and came back before 08:00 was told «bugün
  // check-in edilib» and refused.
  const today = dayKey(new Date());
  const checkedInToday = checkIns.some((c) => dayKey(c.at) === today);

  const gymLabel = gym?.name ?? 'Seçdiyin zal';
  const hours = checkHours(gym?.hours, new Date());
  const coordsMissing = !!gym && !hasCoords(gym);
  // Everything that makes the button pointless before it is even pressed.
  const blocked = checkedInToday || coordsMissing;

  const fail = (msg: string) => {
    setRefused(msg);
    setVerifying(false);
    errorFeedback();
  };

  const checkIn = () => {
    if (!gymId || !gym) return;
    gate(async () => {
      setRefused(null);

      // ---- gate 1: max one check-in per gym day (04:00 → 04:00) -------------
      if (checkedInToday) {
        fail('Gündə yalnız bir dəfə check-in etmək olar. Növbəti check-in sabah saat 04:00-dan sonra açılır.');
        return;
      }

      // ---- gate 2: opening hours -------------------------------------------
      if (hours.state === 'closed') {
        fail(`${gymLabel} indi bağlıdır (${hours.window}). Check-in yalnız iş saatlarında edilir.`);
        return;
      }

      // ---- gate 3: within 150 m of the gym ---------------------------------
      if (!hasCoords(gym)) {
        fail(
          `${gymLabel} üçün koordinat qeyd olunmayıb — sənin zalda olduğunu yoxlaya bilmirik, ona görə check-in edilmir. Zal sahibi ünvanı xəritədə göstərəndən sonra işləyəcək.`
        );
        return;
      }

      setVerifying(true);
      let here: { lat: number; lng: number };
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          fail('Check-in üçün lokasiya icazəsi lazımdır — zalda olduğunu yalnız bununla yoxlaya bilirik.');
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch {
        fail('Lokasiya alınmadı. GPS-i aç və yenidən cəhd et.');
        return;
      }

      const metres = Math.round(distanceM(here, { lat: gym.lat, lng: gym.lng }));
      if (metres > MAX_DISTANCE_M) {
        fail(
          metres > 2000
            ? `${gymLabel} təxminən ${(metres / 1000).toFixed(1)} km uzaqdadır. Check-in yalnız zalın ${MAX_DISTANCE_M} m radiusunda edilir.`
            : `${gymLabel} təxminən ${metres} m uzaqdadır. Check-in yalnız zalın ${MAX_DISTANCE_M} m radiusunda edilir.`
        );
        return;
      }

      // ---- gates passed: ask the server ------------------------------------
      // The gates above are a courtesy — they save a round trip and let us name
      // the reason instantly. schema19 re-runs all three in the database, and
      // THAT verdict is the one that counts. So nothing is written locally until
      // the server has accepted: a refused check-in must never leave a streak
      // behind that no other person can see.
      if (!hasSupabaseConfig) {
        setVerifying(false);
        if (!done) useDb.getState().checkIn(gymId);
        setDone(true);
        setSynced(false);
        errorFeedback();
        return;
      }

      try {
        await checkInApi(gymId, here);
      } catch (e) {
        setVerifying(false);
        if (e instanceof CheckInError && e.code !== 'unknown') {
          fail(refusalText(e, gymLabel));
          return;
        }
        // Not a refusal — the request never got an answer. Record it locally and
        // say plainly that nobody else can see it.
        if (!done) useDb.getState().checkIn(gymId);
        setDone(true);
        setSynced(false);
        errorFeedback();
        return;
      }

      setVerifying(false);
      useDb.getState().checkIn(gymId); // local streak engine, now that it is real
      setDone(true);
      setSynced(true);
      successFeedback();
      setTimeout(() => router.back(), 1400);
    }, 'Check-in üçün');
  };

  const buttonLabel = verifying
    ? 'Yoxlanılır…'
    : done && synced === false
      ? 'Yenidən cəhd et'
      : checkedInToday
        ? 'Bugün check-in edilib'
        : coordsMissing
          ? 'Check-in mümkün deyil'
          : 'Check-in et';

  const buttonDisabled = verifying || blocked || (done && synced !== false);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <PressableScale activeScale={0.9} onPress={() => router.back()} style={styles.close}>
          <Icon name="x" size={17} color={palette.white} />
        </PressableScale>
        <AppText style={{ color: palette.white, fontSize: 16, fontWeight: '600' }}>Check-in</AppText>
        <View style={{ width: 32 }} />
      </View>

      {!gymId ? (
        // ---------------------------------------------------------- no gym chosen
        <>
          <View style={styles.center}>
            <View style={styles.discMuted}>
              <Icon name="pin" size={38} color={palette.volt} />
            </View>
            <View style={styles.textBlock}>
              <AppText style={styles.title}>Əvvəlcə zalını seç</AppText>
              <AppText style={styles.sub}>
                Check-in bir zala bağlıdır. Kəşf bölməsindən zalını seç — sonra buradan check-in edə
                bilərsən.
              </AppText>
            </View>
          </View>
          <View style={styles.footer}>
            <PressableScale onPress={() => router.replace('/(tabs)/discover')} style={styles.primaryBtn}>
              <AppText style={{ color: palette.inkText, fontSize: 15.5, fontWeight: '700' }}>Kəşfdə zal seç</AppText>
            </PressableScale>
          </View>
        </>
      ) : (
        // ---------------------------------------------------------- manual check-in
        <>
          <View style={styles.center}>
            {done ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.disc}>
                <Icon name="check" size={42} color={palette.inkText} />
              </Animated.View>
            ) : (
              <View style={styles.discMuted}>
                <Icon name={refused ? 'lock' : 'dumbbell'} size={38} color={palette.volt} />
              </View>
            )}

            <View style={styles.textBlock}>
              <AppText style={styles.title}>
                {!done
                  ? refused
                    ? 'Check-in edilmədi'
                    : gymLabel
                  : synced === false
                    ? 'Check-in tam getmədi'
                    : 'Check-in edildi!'}
              </AppText>
              <AppText style={styles.sub}>
                {!done
                  ? refused
                    ? refused
                    : verifying
                      ? 'Lokasiyan yoxlanılır — zalın 150 m radiusunda olmalısan.'
                      : 'Check-in zalın 150 m radiusunda və iş saatlarında edilir. Streak-ini davam etdirir, kimin zalda olduğunu göstərir və rəy yazmaq hüququ verir.'
                  : synced === null
                    ? `${gymLabel} · yoxlanılır…`
                    : synced
                      ? `${gymLabel} · streak ${stats.streakDays} gün. Zala gələnlər səni indi görür.`
                      : `${gymLabel} · streak ${stats.streakDays} gün. Check-in yalnız bu cihazda qeyd olundu — serverə çatmadı, başqaları səni indi zalda görmür.`}
              </AppText>
              {!done && !refused && gym ? (
                <AppText style={styles.meta}>
                  {[gym.district, hours.state === 'always' ? '24 saat açıq' : hours.window].filter(Boolean).join(' · ')}
                </AppText>
              ) : null}
            </View>
          </View>

          <View style={styles.footer}>
            <View style={styles.streakCard}>
              <Icon name="flame" size={20} color={palette.volt} />
              <AppText style={{ flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: 13.5, fontWeight: '500' }}>
                {checkedInToday
                  ? `Streak: ${stats.streakDays} gün · bugün artıq check-in etmisən`
                  : stats.streakDays === 0
                    ? 'İlk check-in — streak bugün başlayır'
                    : `${stats.streakDays} gün streak · bugün check-in etsən ${stats.streakDays + 1} olacaq`}
              </AppText>
            </View>
            <PressableScale
              onPress={checkIn}
              disabled={buttonDisabled}
              style={[styles.primaryBtn, buttonDisabled && { opacity: 0.4 }]}
            >
              <AppText style={{ color: palette.inkText, fontSize: 15.5, fontWeight: '700' }}>{buttonLabel}</AppText>
            </PressableScale>
            <AppText style={styles.hint}>
              {coordsMissing
                ? 'Bu zalın koordinatı yoxdur — məsafə yoxlanıla bilmir, ona görə check-in bağlıdır.'
                : hours.state === 'unknown'
                  ? 'Gündə bir check-in qaydasını server tətbiq edir. Məsafə (150 m) telefonun göndərdiyi koordinata görə serverdə yoxlanılır — bu, zalda olduğunun sübutu deyil. Bu zalın iş saatları qeyd olunmayıb, ona görə saat yoxlanmır. QR oxuyucu hələ yoxdur.'
                  : 'Gündə bir check-in qaydasını və iş saatını server tətbiq edir. Məsafə (150 m) telefonun göndərdiyi koordinata görə yoxlanılır — bu, zalda olduğunun sübutu deyil. QR oxuyucu hələ yoxdur.'}
            </AppText>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.inkText },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  disc: { width: 96, height: 96, borderRadius: 48, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  discMuted: { width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(198,255,61,0.14)', borderWidth: 1, borderColor: 'rgba(198,255,61,0.4)', alignItems: 'center', justifyContent: 'center' },
  textBlock: { alignItems: 'center', marginTop: 30 },
  title: { color: palette.white, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.55)', fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginTop: 10, maxWidth: 300 },
  meta: { color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', marginTop: 8 },
  /* Only 10pt of its own: this screen lives inside the Məşq tab scene, which (tabs)/_layout
     already pads by the native tab bar's own reserved space, which already includes the
     home indicator folded in. The footer used to add `insets.bottom` again on top of that. */
  footer: { paddingHorizontal: 20, paddingBottom: 10 },
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 14, marginBottom: 12 },
  primaryBtn: { height: 52, borderRadius: 14, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  hint: { color: 'rgba(255,255,255,0.38)', fontSize: 12.5, textAlign: 'center', marginTop: 10 },
});
