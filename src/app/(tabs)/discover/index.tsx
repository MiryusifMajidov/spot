import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { GymCard } from '@/components/GymCard';
import { Icon } from '@/components/Icon';
import { PartnerRow } from '@/components/PartnerRow';
import { TrainerRow } from '@/components/TrainerRow';
import { AppText } from '@/components/ui/AppText';
import { Chip } from '@/components/ui/Chip';
import { HeaderIcon, LargeHeader } from '@/components/ui/LargeHeader';
import { LiveDot } from '@/components/ui/LiveDot';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { Partner } from '@/data/types';
import { getPartner } from '@/lib/api';
import { useFetchPhase } from '@/lib/focusFetch';
import { useGyms, useGymsPhase, usePartnersForGym, useTrainers } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb } from '@/store/db';
import { useIsGuest } from '@/lib/authGate';
import { useAppStore } from '@/store/appStore';
import { applyGymFilter, applyPartnerFilter, gymFilterCount, partnerFilterCount, useDiscoverPrefs, womenOnlyAllowed } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';
import { searchKey, azUpper } from '@/lib/az';
import { getUnreadCount } from '@/lib/notifications';
import { useT } from '@/lib/useT';

// Shared fold — a plain toLocaleLowerCase('az') turned «Iron Bay» into
// «ıron bay», so typing `iron` found nothing. See src/lib/az.ts.
const norm = searchKey;

export default function Discover() {
  const router = useRouter();
  const t = useT();
  const guest = useIsGuest();
  const [rawSegment, setSegment] = useState(0);
  /* A guest has only two segments. Clamping here rather than resetting the state
     means somebody who was on «Yoldaşlar» and then signed OUT lands on a real
     segment instead of a blank third one. */
  const segment = guest && rawSegment > 1 ? 0 : rawSegment;
  const [query, setQuery] = useState('');
  const profile = useAppStore((s) => s.profile);
  // No substitute gym. If the person has not chosen one, we say so instead of
  // pinning the screen to a catalogue gym they never picked.
  const homeGymId = profile.homeGymId;
  // «Yalnız qadınlar» yalnız qadın üçün tətbiq olunur — bax discoverPrefs.ts.
  // «not a man», not «is a woman» — see womenOnlyAllowed.
  const isWoman = womenOnlyAllowed(profile.gender);
  const matches = useDb((s) => s.matches);
  const threads = useDb((s) => s.threads);
  const lastRead = useDiscoverPrefs((s) => s.lastRead);
  const gymFilter = useDiscoverPrefs((s) => s.gymFilter);
  const partnerFilter = useDiscoverPrefs((s) => s.partnerFilter);
  const setGymFilter = useDiscoverPrefs((s) => s.setGymFilter);
  const savedPartners = useDiscoverPrefs((s) => s.savedPartners);

  // Unread notifications. `null` means the count could not be read — the badge
  // then shows NOTHING rather than a confident zero, the same rule the trainer
  // panel follows.
  const [notifUnread, setNotifUnread] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      /* `.catch` is not optional here: getUnreadCount → getMyProfile → getUserId
         RETHROWS every auth error that is not «no session», so on a cold start
         with no signal this rejection escaped and the app's first screen fired a
         «Possible Unhandled Promise Rejection». A failed read leaves the badge
         unset, which is exactly what `null` already means. */
      getUnreadCount()
        .then((n) => alive && setNotifUnread(n && n > 0 ? n : null))
        .catch(() => {});
      return () => { alive = false; };
    }, [])
  );

  // Unread = a message from the other side that arrived after I last opened the thread.
  const unread = useMemo(
    () =>
      Object.keys(threads).filter((id) => {
        const last = threads[id]?.[threads[id].length - 1];
        return !!last && last.from === 'them' && last.at > (lastRead[id] ?? '');
      }).length,
    [threads, lastRead]
  );

  // Local-first gyms. A live headcount is shown only when the server actually
  // returned one (real check_ins rows). The seed catalogue carries no measured
  // occupancy, and the local engine only knows about the user's own check-in —
  // neither is a crowd count, so neither may feed the banner below.
  const gyms = useGyms();
  const gymsPhase = useGymsPhase();

  const allPartners = usePartnersForGym(homeGymId ?? '');
  const trainers = useTrainers();
  const trainerPhase = useFetchPhase('trainers');
  const partnerPhase = useFetchPhase(homeGymId ? `partners:${homeGymId}` : '');

  const q = norm(query.trim());
  const visibleGyms = useMemo(() => {
    const filtered = applyGymFilter(gyms, gymFilter);
    if (!q) return filtered;
    return filtered.filter(
      (g) => norm(g.name).includes(q) || norm(g.district).includes(q) || g.tags.some((t) => norm(t).includes(q))
    );
  }, [gyms, gymFilter, q]);

  const visibleTrainers = useMemo(() => {
    if (!q) return trainers;
    return trainers.filter((t) => norm(t.name).includes(q) || norm(t.specialty).includes(q));
  }, [trainers, q]);

  // `isWoman` belongs in the deps: without it the safety filter kept applying the
  // value it had when the list was first computed, even after the gender changed.
  const filteredPartners = useMemo(
    () => applyPartnerFilter(allPartners, partnerFilter, isWoman),
    [allPartners, partnerFilter, isWoman]
  );
  const visiblePartners = useMemo(() => {
    if (!q) return filteredPartners;
    return filteredPartners.filter(
      (p) => norm(p.name).includes(q) || p.goals.some((g) => norm(g).includes(q)) || p.types.some((t) => norm(t).includes(q))
    );
  }, [filteredPartners, q]);

  /* Saved people are REAL profiles — the bookmark in Kartlar stores a profiles UUID.
     Resolving them through the seed catalogue matched nothing, so this list was
     permanently empty while the «Saxlanıldı — «Yoldaşlar» bölməsində tapa bilərsən»
     toast promised the opposite. They are fetched now, and loading / failed / really
     empty each say something different. */
  const savedKey = useMemo(() => [...savedPartners].sort().join(','), [savedPartners]);
  const [saved, setSaved] = useState<Partner[]>([]);
  const [savedPhase, setSavedPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  useFocusEffect(
    useCallback(() => {
      if (!savedKey) {
        setSaved([]);
        setSavedPhase('ready');
        return;
      }
      if (!hasSupabaseConfig) {
        setSavedPhase('error');
        return;
      }
      let alive = true;
      setSavedPhase('loading');
      (async () => {
        try {
          const rows = await Promise.all(savedKey.split(',').map((id) => getPartner(id)));
          if (!alive) return;
          setSaved(rows.filter((p): p is Partner => !!p));
          setSavedPhase('ready');
        } catch {
          if (alive) setSavedPhase('error');
        }
      })();
      return () => {
        alive = false;
      };
    }, [savedKey])
  );

  // The hero slot means "your gym" — it stays empty until the user actually picks one.
  const homeGym = homeGymId ? visibleGyms.find((g) => g.id === homeGymId) ?? null : null;
  const otherGyms = homeGym ? visibleGyms.filter((g) => g.id !== homeGym.id) : visibleGyms;
  const filterN = gymFilterCount(gymFilter);
  const partnerFilterN = partnerFilterCount(partnerFilter, isWoman);
  const weeklyCount = Math.min(3, filteredPartners.length);
  const pendingOut = useMemo(() => Object.values(matches).filter((m) => m.state === 'requested').length, [matches]);

  const searchPlaceholder =
    segment === 0 ? t('Zal, rayon axtar') : segment === 1 ? t('Müəllim, ixtisas axtar') : t('Yoldaş, məqsəd axtar');

  return (
    <Screen edges={['top']}>
      <LargeHeader
        title={t('Kəşf')}
        right={
          guest ? (
            /* The only way in. A guest has no Profil tab, so without this button
               there is no visible door back to an account anywhere in the app —
               only the prompts that appear after tapping something. */
            <PressableScale activeScale={0.96} onPress={() => router.push('/onboarding/welcome')} style={styles.signIn}>
              <AppText variant="subhead" style={{ color: palette.inkText, fontWeight: '700' }}>
                {t('Daxil ol')}
              </AppText>
            </PressableScale>
          ) : (
            <>
              <HeaderIcon name="bell" badge={notifUnread ?? undefined} onPress={() => router.push('/notifications')} />
              <HeaderIcon name="msg" badge={unread > 0 ? unread : undefined} onPress={() => router.push('/chat')} />
              <HeaderIcon name="pin" onPress={() => router.push('/(tabs)/discover/map')} />
            </>
          )
        }
      />

      <View style={styles.controls}>
        <View style={styles.search}>
          <Icon name="search" size={17} color={palette.caption} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={palette.caption}
            style={styles.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <PressableScale haptic={false} activeScale={0.9} onPress={() => setQuery('')}>
              <Icon name="x" size={15} color={palette.caption} />
            </PressableScale>
          ) : null}
        </View>
        <View style={{ marginTop: 12 }}>
          {/* «Yoldaşlar» is a list of PEOPLE matched against your own gym, goals
              and schedule — a guest has none of those, so the segment could only
              ever be empty or a prompt. Browsing without an account is the
              catalogue: gyms, and the coaches in them. */}
          <Segmented
            options={guest ? [t('Zallar'), t('Müəllimlər')] : [t('Zallar'), t('Müəllimlər'), t('Yoldaşlar')]}
            value={segment}
            onChange={setSegment}
          />
        </View>

        {segment === 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={{ marginTop: 12, marginHorizontal: -spacing.screen }}>
            {/* The map is the second way to browse gyms — it must be visible in the
                Zallar segment itself, not only behind the header pin. */}
            <Chip label={t('Xəritə')} icon="pin" tone="card" onPress={() => router.push('/(tabs)/discover/map')} />
            <Chip
              label={filterN > 0 ? t('Filtr · {n}', { n: filterN, count: filterN }) : t('Filtr')}
              icon="sliders"
              selected={filterN > 0}
              onPress={() => router.push('/(tabs)/discover/filter')}
            />
            <Chip
              label={t('2 km-ə qədər')}
              tone="card"
              selected={gymFilter.maxDistanceKm === 2}
              onPress={() => setGymFilter({ maxDistanceKm: gymFilter.maxDistanceKm === 2 ? null : 2 })}
            />
            <Chip
              label={t('50 ₼-dək')}
              tone="card"
              selected={gymFilter.maxPrice === 50}
              onPress={() => setGymFilter({ maxPrice: gymFilter.maxPrice === 50 ? null : 50 })}
            />
            <Chip
              label={t('24 saat')}
              tone="card"
              selected={gymFilter.hours === '24h'}
              onPress={() => setGymFilter({ hours: gymFilter.hours === '24h' ? null : '24h' })}
            />
            {['Duş', 'Park'].map((a) => (
              <Chip
                key={a}
                label={t(a)}
                tone="card"
                selected={gymFilter.amenities.includes(a)}
                onPress={() =>
                  setGymFilter({
                    amenities: gymFilter.amenities.includes(a)
                      ? gymFilter.amenities.filter((x) => x !== a)
                      : [...gymFilter.amenities, a],
                  })
                }
              />
            ))}
          </ScrollView>
        ) : segment === 2 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={{ marginTop: 12, marginHorizontal: -spacing.screen }}>
            <Chip
              label={partnerFilterN > 0 ? t('Filtr · {n}', { n: partnerFilterN, count: partnerFilterN }) : t('Filtr')}
              icon="sliders"
              selected={partnerFilterN > 0}
              onPress={() => router.push('/(tabs)/discover/partner-filter')}
            />
            <Chip label={t('Kartlar')} icon="grid" tone="card" onPress={() => router.push('/(tabs)/discover/cards')} />
            {pendingOut > 0 ? (
              <Chip
                label={t('Gözləyən təklif · {n}', { n: pendingOut, count: pendingOut })}
                tone="card"
                onPress={() => router.push('/chat/requests')}
              />
            ) : null}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {segment === 0 &&
          (visibleGyms.length === 0 ? (
            <EmptyBlock
              icon="pin"
              text={
                /* «Hələ zal yoxdur» is a claim about the catalogue. Until now it
                   was also printed over a read that never landed — there was no
                   failed branch for gyms at all. */
                gymsPhase === 'failed'
                  ? t('Zallar yüklənmədi — bu, zal olmadığı demək deyil. Bağlantını yoxla və səhifəni yenidən aç.')
                  : gymsPhase === 'loading'
                    ? t('Zallar yüklənir…')
                    : q || filterN > 0
                      ? t('Bu axtarışa uyğun zal tapılmadı. Filtri sıfırla və ya başqa söz yaz.')
                      : guest
                        ? /* A guest has no Profil tab — the other sentence
                             sent them to a screen they cannot reach. */
                          t('Hələ heç bir zal SPOT-da qeydiyyatdan keçməyib. Zal sahibisənsə, daxil ol və zalını əlavə et.')
                        : t('Hələ heç bir zal SPOT-da qeydiyyatdan keçməyib. Zal sahibisənsə, Profil → Parametrlər → «Zal hesabı yarat» ilə özün əlavə edə bilərsən.')
              }
              /* «Xəritədə bax» over an empty catalogue opened a map with nothing
                 on it. Only offered when the list is empty because of a filter
                 or a failed read, where the map can still say something. */
              action={
                q || filterN > 0 || gymsPhase === 'failed'
                  ? { label: t('Xəritədə bax'), onPress: () => router.push('/(tabs)/discover/map') }
                  : guest
                    ? { label: t('Daxil ol'), onPress: () => router.push('/onboarding/welcome') }
                    : undefined
              }
            />
          ) : (
            <>
              {homeGym ? (
                <>
                  {/* Only a count the server really reported may appear here. */}
                  {homeGym.liveCount > 0 ? (
                    <View style={styles.liveRow}>
                      <LiveDot />
                      <AppText style={styles.liveLabel}>
                        {t('İNDİ ZALDA {n} NƏFƏR · {gym}', {
                          n: homeGym.liveCount,
                          count: homeGym.liveCount,
                          gym: azUpper(homeGym.name),
                        })}
                      </AppText>
                    </View>
                  ) : null}
                  <GymCard
                    gym={homeGym}
                    variant="hero"
                    onPress={() => router.push({ pathname: '/(tabs)/discover/gym/[id]', params: { id: homeGym.id } })}
                  />
                  <View style={{ height: 14 }} />
                </>
              ) : !homeGymId && !guest ? (
                /* Only when no gym was ever chosen — a home gym hidden by the current
                   filter/search must not be reported as "not chosen".
                   And never to a guest: they have no profile to set it on, the
                   Profil tab it pushed into is hidden from them, and the reason
                   it gives («yoldaşlar zala görə tapılır») is about a section a
                   guest does not have either. */
                <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/profile/edit')} style={styles.weeklyBanner}>
                  <View style={styles.weeklyIcon}>
                    <Icon name="pin" size={18} color={palette.voltDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="headline">{t('Əsas zalın seçilməyib')}</AppText>
                    <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2, lineHeight: 18 }}>
                      {t('Zalını seç — yoldaşlar zala görə tapılır.')}
                    </AppText>
                  </View>
                  <Icon name="chevR" size={18} color={palette.tertiary} />
                </PressableScale>
              ) : null}
              {otherGyms.map((g) => (
                <View key={g.id} style={{ marginBottom: 12 }}>
                  <GymCard
                    gym={g}
                    variant="compact"
                    onPress={() => router.push({ pathname: '/(tabs)/discover/gym/[id]', params: { id: g.id } })}
                  />
                </View>
              ))}
            </>
          ))}

        {segment === 1 &&
          (visibleTrainers.length === 0 ? (
            /* A read that never reached the server is not «there are none» —
               see lib/focusFetch. Without this the app states a fact about the
               world every time the connection wobbles. */
            <EmptyBlock
              icon="user"
              text={
                trainerPhase === 'failed'
                  ? t('Müəllimlər yüklənmədi — serverlə əlaqə alınmadı. Bu, müəllim olmadığı demək deyil.')
                  : q
                    ? t('Bu ada uyğun müəllim tapılmadı.')
                    : t('Hələ müəllim yoxdur. Zalını seç — müəllimlər orada görünəcək.')
              }
            />
          ) : (
            visibleTrainers.map((t) => (
              <TrainerRow
                key={t.id}
                trainer={t}
                onPress={() => router.push({ pathname: '/(tabs)/discover/trainer/[id]', params: { id: t.id } })}
              />
            ))
          ))}

        {segment === 2 && (
          <>
            {weeklyCount > 0 ? (
              <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/discover/weekly')} style={styles.weeklyBanner}>
                <View style={styles.weeklyIcon}>
                  <Icon name="star" size={18} color={palette.voltDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{t('{n} həftəlik təklif', { n: weeklyCount, count: weeklyCount })}</AppText>
                  <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
                    {t('Bu həftənin ən uyğun yoldaşları')}
                  </AppText>
                </View>
                <Icon name="chevR" size={18} color={palette.tertiary} />
              </PressableScale>
            ) : null}

            {savedPartners.length > 0 ? (
              <>
                <AppText variant="overline" color={palette.caption} style={{ marginBottom: 10 }}>
                  {savedPhase === 'ready'
                    ? t('Saxlanılanlar · {n}', { n: saved.length, count: saved.length })
                    : t('Saxlanılanlar')}
                </AppText>
                {saved.map((p) => (
                  <PartnerRow
                    key={`saved-${p.id}`}
                    partner={p}
                    onPress={() => router.push({ pathname: '/(tabs)/discover/partner/[id]', params: { id: p.id } })}
                  />
                ))}
                {savedPhase === 'loading' && saved.length === 0 ? (
                  <AppText variant="footnote" color={palette.caption} style={{ paddingVertical: 10, lineHeight: 18 }}>
                    {t('Saxladıqların yüklənir…')}
                  </AppText>
                ) : null}
                {savedPhase === 'error' ? (
                  <AppText variant="footnote" color={palette.caption} style={{ paddingVertical: 10, lineHeight: 18 }}>
                    {hasSupabaseConfig
                      ? t('Saxladıqların yüklənmədi — internet bağlantısını yoxla və bu səhifəni yenidən aç.')
                      : t('Bu quraşdırmada server bağlantısı yoxdur — saxladığın profilləri oxuya bilmirik.')}
                  </AppText>
                ) : null}
                {savedPhase === 'ready' && saved.length === 0 ? (
                  <AppText variant="footnote" color={palette.caption} style={{ paddingVertical: 10, lineHeight: 18 }}>
                    {t('Saxladığın profillər artıq görünmür — profillərini gizlədiblər və ya hesabları yoxdur.')}
                  </AppText>
                ) : null}
                <View style={{ height: 8 }} />
              </>
            ) : null}

            {!homeGymId ? (
              <EmptyBlock
                icon="pin"
                text={t('Zalını seç — yoldaşlar zala görə tapılır.')}
                action={{ label: t('Zalını seç'), onPress: () => router.push('/(tabs)/profile/edit') }}
              />
            ) : (
              <>
                <AppText variant="subhead" color={palette.textSecondary} style={{ marginBottom: 10 }}>
                  {t('Uyğun yoldaşlar · səbəb etiketləri ilə')}
                </AppText>
                {visiblePartners.length === 0 ? (
                  <EmptyBlock
                    icon="users"
                    text={
                      partnerPhase === 'failed'
                        ? t('Yoldaşlar yüklənmədi — serverlə əlaqə alınmadı. Bu, zalda kimsə olmadığı demək deyil.')
                        : q
                          ? t('Bu axtarışa uyğun yoldaş yoxdur.')
                          : partnerFilterN > 0
                            ? t('Seçdiyin filtrə uyğun yoldaş yoxdur. Filtri yumşalt.')
                            : t('Bu zalda hələ uyğun yoldaş yoxdur. Başqa zal seç və ya profilini tamamla.')
                    }
                  />
                ) : (
                  visiblePartners.map((p) => (
                    <PartnerRow
                      key={p.id}
                      partner={p}
                      onPress={() => router.push({ pathname: '/(tabs)/discover/partner/[id]', params: { id: p.id } })}
                    />
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function EmptyBlock({
  icon,
  text,
  action,
}: {
  icon: 'users' | 'user' | 'pin';
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.emptyPartners}>
      <Icon name={icon} size={26} color={palette.tertiary} />
      <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 10, maxWidth: 270, lineHeight: 21 }}>
        {text}
      </AppText>
      {action ? (
        <PressableScale activeScale={0.96} onPress={action.onPress} style={styles.emptyBtn}>
          <AppText style={{ fontSize: 14, fontWeight: '600', color: palette.white }}>{action.label}</AppText>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  signIn: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: palette.volt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: { paddingHorizontal: spacing.screen, paddingBottom: 10 },
  search: { backgroundColor: palette.fill, borderRadius: 11, height: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10 },
  searchInput: { flex: 1, fontSize: 16, color: palette.inkText, paddingVertical: 0 },
  chips: { paddingHorizontal: spacing.screen, gap: 7 },
  content: { paddingHorizontal: spacing.screen, paddingTop: 14, paddingBottom: 40 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  liveLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.6, color: palette.voltDeep },
  weeklyBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.white, borderRadius: 14, padding: 14, marginBottom: 12 },
  weeklyIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
  emptyPartners: { alignItems: 'center', paddingVertical: 40 },
  emptyBtn: { marginTop: 16, height: 44, paddingHorizontal: 22, borderRadius: 13, backgroundColor: palette.ink, alignItems: 'center', justifyContent: 'center' },
});
