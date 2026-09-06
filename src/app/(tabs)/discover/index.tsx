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
import { useGyms, usePartnersForGym, useTrainers } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { applyGymFilter, applyPartnerFilter, gymFilterCount, partnerFilterCount, useDiscoverPrefs, womenOnlyAllowed } from '@/store/discoverPrefs';
import { palette, spacing } from '@/theme';
import { searchKey } from '@/lib/az';
import { getUnreadCount } from '@/lib/notifications';

// Shared fold — a plain toLocaleLowerCase('az') turned «Iron Bay» into
// «ıron bay», so typing `iron` found nothing. See src/lib/az.ts.
const norm = searchKey;

export default function Discover() {
  const router = useRouter();
  const [segment, setSegment] = useState(0);
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
      getUnreadCount().then((n) => alive && setNotifUnread(n && n > 0 ? n : null));
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

  const allPartners = usePartnersForGym(homeGymId ?? '');
  const trainers = useTrainers();

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

  const filteredPartners = useMemo(() => applyPartnerFilter(allPartners, partnerFilter, isWoman), [allPartners, partnerFilter]);
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

  const searchPlaceholder = segment === 0 ? 'Zal, rayon axtar' : segment === 1 ? 'Müəllim, ixtisas axtar' : 'Yoldaş, məqsəd axtar';

  return (
    <Screen edges={['top']}>
      <LargeHeader
        title="Kəşf"
        right={
          <>
            <HeaderIcon name="bell" badge={notifUnread ?? undefined} onPress={() => router.push('/notifications')} />
            <HeaderIcon name="msg" badge={unread > 0 ? unread : undefined} onPress={() => router.push('/chat')} />
            <HeaderIcon name="pin" onPress={() => router.push('/(tabs)/discover/map')} />
          </>
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
          <Segmented options={['Zallar', 'Müəllimlər', 'Yoldaşlar']} value={segment} onChange={setSegment} />
        </View>

        {segment === 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={{ marginTop: 12, marginHorizontal: -spacing.screen }}>
            {/* The map is the second way to browse gyms — it must be visible in the
                Zallar segment itself, not only behind the header pin. */}
            <Chip label="Xəritə" icon="pin" tone="card" onPress={() => router.push('/(tabs)/discover/map')} />
            <Chip
              label={filterN > 0 ? `Filtr · ${filterN}` : 'Filtr'}
              icon="sliders"
              selected={filterN > 0}
              onPress={() => router.push('/(tabs)/discover/filter')}
            />
            <Chip
              label="2 km-ə qədər"
              tone="card"
              selected={gymFilter.maxDistanceKm === 2}
              onPress={() => setGymFilter({ maxDistanceKm: gymFilter.maxDistanceKm === 2 ? null : 2 })}
            />
            <Chip
              label="50 ₼-dək"
              tone="card"
              selected={gymFilter.maxPrice === 50}
              onPress={() => setGymFilter({ maxPrice: gymFilter.maxPrice === 50 ? null : 50 })}
            />
            <Chip
              label="24 saat"
              tone="card"
              selected={gymFilter.hours === '24h'}
              onPress={() => setGymFilter({ hours: gymFilter.hours === '24h' ? null : '24h' })}
            />
            {['Duş', 'Park'].map((a) => (
              <Chip
                key={a}
                label={a}
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
              label={partnerFilterN > 0 ? `Filtr · ${partnerFilterN}` : 'Filtr'}
              icon="sliders"
              selected={partnerFilterN > 0}
              onPress={() => router.push('/(tabs)/discover/partner-filter')}
            />
            <Chip label="Kartlar" icon="grid" tone="card" onPress={() => router.push('/(tabs)/discover/cards')} />
            {pendingOut > 0 ? (
              <Chip label={`Gözləyən təklif · ${pendingOut}`} tone="card" onPress={() => router.push('/chat/requests')} />
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
                q || filterN > 0
                  ? 'Bu axtarışa uyğun zal tapılmadı. Filtri sıfırla və ya başqa söz yaz.'
                  : 'Hələ zal yoxdur. Xəritəyə bax və ya sonra yenidən yoxla.'
              }
              action={{ label: 'Xəritədə bax', onPress: () => router.push('/(tabs)/discover/map') }}
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
                        İNDİ ZALDA {homeGym.liveCount} NƏFƏR · {homeGym.name.toUpperCase()}
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
              ) : !homeGymId ? (
                // Only when no gym was ever chosen — a home gym hidden by the current
                // filter/search must not be reported as "not chosen".
                <PressableScale activeScale={0.98} onPress={() => router.push('/(tabs)/profile/edit')} style={styles.weeklyBanner}>
                  <View style={styles.weeklyIcon}>
                    <Icon name="pin" size={18} color={palette.voltDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="headline">Əsas zalın seçilməyib</AppText>
                    <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2, lineHeight: 18 }}>
                      Zalını seç — yoldaşlar zala görə tapılır.
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
            <EmptyBlock
              icon="user"
              text={q ? 'Bu ada uyğun müəllim tapılmadı.' : 'Hələ müəllim yoxdur. Zalını seç — müəllimlər orada görünəcək.'}
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
                  <AppText variant="headline">{weeklyCount} həftəlik təklif</AppText>
                  <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
                    Bu həftənin ən uyğun yoldaşları
                  </AppText>
                </View>
                <Icon name="chevR" size={18} color={palette.tertiary} />
              </PressableScale>
            ) : null}

            {savedPartners.length > 0 ? (
              <>
                <AppText variant="overline" color={palette.caption} style={{ marginBottom: 10 }}>
                  Saxlanılanlar{savedPhase === 'ready' ? ` · ${saved.length}` : ''}
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
                    Saxladıqların yüklənir…
                  </AppText>
                ) : null}
                {savedPhase === 'error' ? (
                  <AppText variant="footnote" color={palette.caption} style={{ paddingVertical: 10, lineHeight: 18 }}>
                    {hasSupabaseConfig
                      ? 'Saxladıqların yüklənmədi — internet bağlantısını yoxla və bu səhifəni yenidən aç.'
                      : 'Bu quraşdırmada server bağlantısı yoxdur — saxladığın profilləri oxuya bilmirik.'}
                  </AppText>
                ) : null}
                {savedPhase === 'ready' && saved.length === 0 ? (
                  <AppText variant="footnote" color={palette.caption} style={{ paddingVertical: 10, lineHeight: 18 }}>
                    Saxladığın profillər artıq görünmür — profillərini gizlədiblər və ya hesabları yoxdur.
                  </AppText>
                ) : null}
                <View style={{ height: 8 }} />
              </>
            ) : null}

            {!homeGymId ? (
              <EmptyBlock
                icon="pin"
                text="Zalını seç — yoldaşlar zala görə tapılır."
                action={{ label: 'Zalını seç', onPress: () => router.push('/(tabs)/profile/edit') }}
              />
            ) : (
              <>
                <AppText variant="subhead" color={palette.textSecondary} style={{ marginBottom: 10 }}>
                  Uyğun yoldaşlar · səbəb etiketləri ilə
                </AppText>
                {visiblePartners.length === 0 ? (
                  <EmptyBlock
                    icon="users"
                    text={
                      q
                        ? 'Bu axtarışa uyğun yoldaş yoxdur.'
                        : partnerFilterN > 0
                          ? 'Seçdiyin filtrə uyğun yoldaş yoxdur. Filtri yumşalt.'
                          : 'Bu zalda hələ uyğun yoldaş yoxdur. Başqa zal seç və ya profilini tamamla.'
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
