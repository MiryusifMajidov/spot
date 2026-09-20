import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';


import { Icon } from '@/components/Icon';
import { VideoPoster } from '@/components/VideoPoster';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { getMyProfile } from '@/lib/api';
import { useIsGuest } from '@/lib/authGate';
import { useCommunityPosts, useFeedVideos, useGyms } from '@/lib/hooks';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb, useStats } from '@/store/db';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';
import { azLower, azUpper } from '@/lib/az';

/** `avatar_url` lives on the profiles row (added by schema8) — read it defensively. */
function avatarOf(row: unknown): string | null {
  return (row as { avatar_url?: string | null } | null)?.avatar_url ?? null;
}

export default function Profile() {
  const router = useRouter();
  const [avatar, setAvatar] = useState<string | null>(null);
  const isGuest = useIsGuest();
  const profile = useAppStore((s) => s.profile);
  const gyms = useGyms();
  const gym = profile.homeGymId ? gyms.find((g) => g.id === profile.homeGymId) ?? null : null;
  const name = profile.name || 'Sən';

  const stats = useStats();
  const prs = stats.prs;
  const partners = useDb((s) => Object.values(s.matches).filter((m) => m.state === 'accepted').length);

  // The user's REAL content — nothing is rendered unless they actually published it.
  const allVideos = useFeedVideos();
  const allPosts = useCommunityPosts();
  /* Matched on the author's PROFILE ID, not their display name. By name, two
     people called «Yusif» each saw the other's videos as their own, and renaming
     yourself detached you from everything you had posted. `authorId` was already
     on the row (schema29 made it mandatory) and simply was not used. Rows whose
     author is null predate that and belong to nobody, so they match nobody. */
  const myProfileId = useAppStore((s) => s.profileId);
  const myVideos = myProfileId ? allVideos.filter((v) => v.authorId === myProfileId) : [];
  const myPosts = myProfileId ? allPosts.filter((p) => p.authorId === myProfileId) : [];

  const volumeT = (stats.volumeKg / 1000).toFixed(1);

  // The profile photo lives on the server; if it is not there we simply keep the
  // initials avatar — a missing photo is never an error the user must read about.
  useFocusEffect(
    useCallback(() => {
      if (isGuest || !hasSupabaseConfig) return;
      let alive = true;
      getMyProfile()
        .then((me) => alive && setAvatar(avatarOf(me)))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [isGuest])
  );

  if (isGuest) {
    return (
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.topIcons}>
            <PressableScale activeScale={0.9} onPress={() => router.push('/(tabs)/profile/settings')}>
              <Icon name="sliders" size={24} color={palette.inkText} />
            </PressableScale>
          </View>
          <View style={styles.guestCard}>
            <View style={styles.guestIcon}>
              <Icon name="user" size={30} color={palette.voltDeep} />
            </View>
            <AppText variant="title2" style={{ marginTop: 16 }}>Qonaq rejimi</AppText>
            <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, lineHeight: 21, maxWidth: 290 }}>
              Zallara və müəllimlərə baxırsan. Yoldaş tapmaq, söhbət, check-in və məşq tarixçəsi üçün qısa profil yarat — ad və istifadəçi adı, bir ekran.
            </AppText>
            <Button title="Daxil ol" onPress={() => router.push('/onboarding/welcome')} style={{ marginTop: 20, alignSelf: 'stretch' }} />
          </View>

          <View style={styles.guestPerks}>
            {[
              { icon: 'users' as const, t: 'Məşq yoldaşı tap', s: 'Zal, saat, səviyyə və məqsədə görə uyğunluq' },
              { icon: 'dumbbell' as const, t: 'Proqramları izlə', s: 'Gün-gün hərəkət, set və təkrar' },
              // «çəki» was in this list after the weight tracker was deleted —
              // three promises, one of them for a screen that no longer exists.
              { icon: 'flame' as const, t: 'Seriya və statistika', s: 'Check-in, həcm, şəxsi rekordlar' },
            ].map((p) => (
              <View key={p.t} style={styles.perkRow}>
                <View style={styles.perkIcon}>
                  <Icon name={p.icon} size={19} color={palette.inkText} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="headline">{p.t}</AppText>
                  <AppText variant="footnote" color={palette.caption} style={{ marginTop: 2 }}>{p.s}</AppText>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.topIcons}>
          {/* «fitness» was English, and this string leaves the app: it is the text
              the person sends to someone else, so the one place the product spoke
              English was the one place strangers read it. «idman» is the word the
              rest of the app uses («idman zalı»). */}
          <PressableScale activeScale={0.9} onPress={() => Share.share({ message: `${name} — SPOT idman profili.${gym ? ` ${gym.name}.` : ''}${profile.level ? ` ${profile.level} səviyyə.` : ''}` }).catch(() => {})}>
            <Icon name="share" size={24} color={palette.inkText} />
          </PressableScale>
          <PressableScale activeScale={0.9} onPress={() => router.push('/(tabs)/profile/settings')}>
            <Icon name="sliders" size={24} color={palette.inkText} />
          </PressableScale>
        </View>

        <View style={styles.headRow}>
          <Avatar name={name} size={78} uri={avatar} />
          <View style={{ flex: 1 }}>
            <AppText variant="title2">{name}</AppText>
            {/* Only a handle the profile really has — nothing is invented here. */}
            {profile.username ? (
              <AppText variant="subhead" color={palette.caption} style={{ marginTop: 3 }}>
                @{profile.username}
              </AppText>
            ) : null}
            {/* No home gym means the person simply has not picked one — never claim
                "trains at home" on their behalf. */}
            <AppText variant="footnote" color={palette.caption} style={{ marginTop: 5 }}>
              {gym ? gym.name : 'Zal seçilməyib'}
              {profile.level ? ` · ${azLower(profile.level)} səviyyə` : ' · səviyyə seçilməyib'}
            </AppText>
            <View style={styles.badges}>
              {profile.role === 'trainer' ? (
                <View style={[styles.badge, { backgroundColor: 'rgba(10,132,255,0.12)' }]}>
                  <Icon name="verified" size={12} color={palette.blue} />
                  <AppText style={{ fontSize: 11.5, fontWeight: '700', color: palette.blue }}>Müəllim</AppText>
                </View>
              ) : null}
              <PressableScale activeScale={0.94} onPress={() => router.push('/(tabs)/profile/achievements')} style={[styles.badge, { backgroundColor: 'rgba(255,107,53,0.14)' }]}>
                <Icon name="flame" size={12} color={palette.streak} />
                <AppText style={{ fontSize: 11.5, fontWeight: '700', color: '#D14A15' }}>
                  {stats.streakDays > 0 ? `${stats.streakDays} gün` : 'Seriya yoxdur'}
                </AppText>
              </PressableScale>
              {partners > 0 ? (
                <View style={[styles.badge, { backgroundColor: 'rgba(198,255,61,0.30)' }]}>
                  <Icon name="users" size={12} color={palette.voltDeep} />
                  <AppText style={{ fontSize: 11.5, fontWeight: '700', color: '#3F5500' }}>{partners} yoldaş</AppText>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {profile.bio ? (
          <AppText variant="body" color={palette.text3} style={{ marginTop: 14, lineHeight: 21 }}>
            {profile.bio}
          </AppText>
        ) : null}

        <View style={styles.actions}>
          <Button title="Profili redaktə et" onPress={() => router.push('/(tabs)/profile/edit')} style={{ flex: 1, height: 44 }} />
          <PressableScale activeScale={0.94} onPress={() => router.push('/(tabs)/profile/saved')} style={styles.squareBtn}>
            <Icon name="bookmark" size={20} color={palette.inkText} />
          </PressableScale>
        </View>

        <PressableScale activeScale={0.99} onPress={() => router.push('/(tabs)/profile/history')} style={styles.stats}>
          <StatCard value={`${stats.count}`} label="məşq" />
          <StatCard value={`${volumeT} t`} label="həcm" />
          <StatCard value={stats.sinceDays > 0 ? `${stats.sinceDays} gün` : 'Yeni'} label="SPOT-da" />
        </PressableScale>

        {/* PRs */}
        <View style={styles.prCard}>
          <View style={styles.prHead}>
            <AppText variant="headline">Şəxsi rekordlar</AppText>
            {prs.length > 0 ? (
              <PressableScale haptic={false} activeScale={0.94} onPress={() => router.push('/(tabs)/profile/analytics')}>
                <AppText variant="subhead" color={palette.blue}>
                  Hamısı
                </AppText>
              </PressableScale>
            ) : null}
          </View>
          {prs.length > 0 ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {prs.slice(0, 3).map((pr) => (
                <View key={pr.lift} style={styles.pr}>
                  <AppText style={styles.prLabel}>{azUpper(pr.lift)}</AppText>
                  <AppText style={{ fontSize: 17, fontWeight: '700', marginTop: 8 }}>{pr.value} kq</AppText>
                  {pr.delta ? <AppText style={{ fontSize: 10.5, fontWeight: '500', color: palette.voltDeep, marginTop: 6 }}>{pr.delta}</AppText> : null}
                </View>
              ))}
            </View>
          ) : (
            <AppText variant="body" color={palette.textSecondary} style={{ marginTop: 4, lineHeight: 21 }}>
              Hələ rekord yoxdur. Məşqləri qeyd et — ən yaxşı nəticələrin burada görünəcək.
            </AppText>
          )}
        </View>

        {/* One section, so no switcher. «İrəliləyiş» (a bodyweight graph and
            before/after photos) and «Challenge» (a monthly competition nobody
            ever published one of) are both gone: the first is a different
            product from finding a gym and writing down what you lifted, and the
            second told every person who opened it that there was nothing there. */}
        <AppText variant="title3" style={{ marginTop: 20, marginBottom: 12 }}>
          Paylaşdıqların
        </AppText>

        {(
          myVideos.length + myPosts.length === 0 ? (
            <View style={styles.placeholderBox}>
              <Icon name="cam" size={26} color={palette.tertiary} />
              <AppText variant="headline" style={{ marginTop: 12 }}>
                Hələ paylaşmamısan
              </AppText>
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 21, maxWidth: 260 }}>
                Texnika videon və ya zal postun burada toplanacaq.
              </AppText>
              <Button title="Video paylaş" icon="cam" onPress={() => router.push('/(tabs)/feed/share')} style={{ marginTop: 18 }} />
            </View>
          ) : (
            <View>
              {myVideos.length > 0 ? (
                <View style={styles.grid}>
                  {myVideos.map((v) => (
                    <PressableScale
                      key={v.id}
                      activeScale={0.96}
                      onPress={() => router.push({ pathname: '/(tabs)/feed/creator', params: { name: v.author } })}
                      style={styles.gridItem}>
                      <VideoPoster id={v.id} videoUrl={v.videoUrl} gradient={v.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                      <View style={styles.playBadge}>
                        <Icon name="play" size={12} color="rgba(255,255,255,0.95)" />
                      </View>
                      <AppText numberOfLines={2} style={styles.tileCaption}>
                        {v.caption}
                      </AppText>
                    </PressableScale>
                  ))}
                </View>
              ) : null}
              {myPosts.map((p) => (
                <View key={p.id} style={styles.postCard}>
                  <AppText variant="caption" color={palette.caption}>
                    {[p.gym, p.timeAgo].filter(Boolean).join(' · ')}
                  </AppText>
                  <AppText variant="body" color={palette.text3} style={{ marginTop: 6, lineHeight: 21 }}>
                    {p.text}
                  </AppText>
                </View>
              ))}
            </View>
          )
        )}
      </ScrollView>
    </Screen>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.statCard}>
      <AppText style={{ fontSize: 19, fontWeight: '700' }}>{value}</AppText>
      <AppText style={{ fontSize: 11, color: palette.caption, marginTop: 6 }}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingTop: 4, paddingBottom: 40 },
  topIcons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginBottom: 8 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  badges: { flexDirection: 'row', gap: 7, marginTop: 9 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 },
  actions: { flexDirection: 'row', gap: 9, marginTop: 14 },
  squareBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.separator, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statCard: { flex: 1, backgroundColor: palette.white, borderRadius: 16, padding: 14, alignItems: 'center' },
  prCard: { backgroundColor: palette.white, borderRadius: 16, padding: 16, marginTop: 12 },
  prHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  pr: { flex: 1, backgroundColor: palette.grouped, borderRadius: 13, padding: 12 },
  prLabel: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6, color: palette.caption },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  gridItem: { width: '32%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.element, justifyContent: 'flex-end', padding: 7 },
  playBadge: { position: 'absolute', top: 6, right: 6 },
  tileCaption: { color: palette.white, fontSize: 10.5, fontWeight: '600', lineHeight: 13 },
  postCard: { backgroundColor: palette.white, borderRadius: 16, padding: 14, marginTop: 10 },
  placeholderBox: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 30, marginTop: 12, backgroundColor: palette.white, borderRadius: 16 },
  guestCard: { alignItems: 'center', backgroundColor: palette.white, borderRadius: 20, padding: 24, marginTop: 8 },
  guestIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(198,255,61,0.3)', alignItems: 'center', justifyContent: 'center' },
  guestPerks: { backgroundColor: palette.white, borderRadius: 16, padding: 8, marginTop: 14 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 12 },
  perkIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: palette.grouped, alignItems: 'center', justifyContent: 'center' },
});
