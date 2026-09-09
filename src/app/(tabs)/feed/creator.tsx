import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { VideoPoster } from '@/components/VideoPoster';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import type { FeedVideo } from '@/data/feed';
import { displayAuthor, isPlaceholderName } from '@/lib/authorName';
import { useAuthGate } from '@/lib/authGate';
import { useFeedVideos, useTrainers } from '@/lib/hooks';
import { followProfile, unfollowProfile } from '@/lib/social';
import { hasSupabaseConfig } from '@/lib/supabase';
import { toast } from '@/store/ui';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';
import { azLower } from '@/lib/az';

const sameText = (a: string, b: string) => azLower(a.trim()) === azLower(b.trim());

export default function Creator() {
  const params = useLocalSearchParams<{ name?: string; authorId?: string; verified?: string; isTrainer?: string }>();
  const name = params.name ?? '';
  const router = useRouter();
  /* Identity is the profile id, never the display name: two SPOT users can share
     one name, and a plain user's name can equal a listed trainer's, which used to
     graft that trainer's badge, bio, şagird count and booking button onto a
     stranger's page. Whenever the route carries `authorId` both the video grid and
     the trainer block resolve by it. The name compare is the last resort only —
     rows written before schema13 added `feed_videos.author_id`, the seed slug
     trainers, and the two entry points that still push a bare name. */
  const authorId = params.authorId || null;
  const videos = useFeedVideos().filter((v) => (authorId ? v.authorId === authorId : v.author === name));
  const trainer = useTrainers().find((t) => (authorId ? t.id === authorId : t.name === name));
  const isTrainer = params.isTrainer === '1' || !!trainer;
  /* Keyed by profile id, not by the display name that used to be in this array:
     the launch-time `syncSocial` replaces the store with the server's ids, so a
     name-keyed flag was erased on every restart. */
  const following = useAppStore((s) => (authorId ? s.following.includes(authorId) : false));
  const toggleFollow = useAppStore((s) => s.toggleFollow);
  /* Is this page my own profile? Resolved by id when the route carries one, and
     only otherwise by a trimmed case-insensitive name compare. A guest is nobody,
     so nothing is ever "theirs": they keep the normal follow / booking buttons. */
  const gate = useAuthGate();

  const onFollow = () =>
    gate(() => {
      // `followProfile` (schema43) is the real record; the store is the instant
      // answer and is rolled back when the write is refused.
      if (!authorId) {
        toast('Bu profilin kimliyi qeyd olunmayıb — izləmək mümkün deyil', 'error');
        return;
      }
      const next = !following;
      toggleFollow(authorId);
      if (!hasSupabaseConfig) return;
      (next ? followProfile(authorId) : unfollowProfile(authorId)).catch(() => {
        toggleFollow(authorId);
        toast('İzləmə göndərilmədi — yenidən cəhd et', 'error');
      });
    }, 'İzləmək üçün');

  const guest = useAppStore((s) => s.guest);
  const onboarded = useAppStore((s) => s.onboarded);
  const myName = useAppStore((s) => s.profile.name);
  const myUsername = useAppStore((s) => s.profile.username);
  const myId = useAppStore((s) => s.profileId);
  const signedIn = !guest && onboarded && !!myName.trim();
  const isMe = signedIn && (authorId ? authorId === myId : sameText(name, myName));
  const myHandle = isMe ? myUsername?.trim() || undefined : undefined;
  /* The route carries whatever name was frozen into the post. If that is the
     anonymous placeholder it must not be shown back as «Sən», and there is no
     real person to follow either — the follow button would attach to a label. */
  const shown = displayAuthor(name);
  const unknownAuthor = isPlaceholderName(name);

  return (
    <Screen edges={['top']}>
      <NavBar title="" />
      <FlatList
        data={videos}
        keyExtractor={(v) => v.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        columnWrapperStyle={{ paddingHorizontal: spacing.screen, gap: 10 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Avatar name={shown} size={84} />
              <View style={styles.nameRow}>
                <AppText variant="title2">{shown}</AppText>
                {params.verified === '1' ? <Icon name="verified" size={18} color={palette.blue} /> : null}
              </View>
              {/* Own profile only, and only if a handle really exists. */}
              {myHandle ? (
                <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 4 }}>
                  @{myHandle}
                </AppText>
              ) : null}
              {isTrainer ? (
                <View style={styles.trainerTag}>
                  <Icon name="verified" size={12} color={palette.blue} />
                  <AppText style={{ color: palette.blue, fontSize: 12, fontWeight: '700' }}>MÜƏLLİM{trainer ? ` · ${trainer.specialty}` : ''}</AppText>
                </View>
              ) : null}
              {trainer?.bio ? (
                <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 12, lineHeight: 21, paddingHorizontal: 8 }}>
                  {trainer.bio}
                </AppText>
              ) : null}
              <View style={styles.stats}>
                {/* A client count or rating of 0 means nobody has hired or rated
                    this trainer yet. Printing «0» / «0.0» would state that as a
                    measured result, so an absent figure shows as «—». */}
                <Stat value={`${videos.length}`} label="video" />
                <Stat value={trainer && trainer.clients > 0 ? `${trainer.clients}` : '—'} label="şagird" />
                <Stat value={trainer && trainer.rating > 0 ? trainer.rating.toFixed(1) : '—'} label="reytinq" />
              </View>
              {/* Your own page: you cannot follow yourself, and you cannot book
                  yourself as a trainer — both controls go away, and the honest
                  affordance left is editing the profile you are looking at. */}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, paddingHorizontal: spacing.screen, alignSelf: 'stretch' }}>
                {isMe ? (
                  <Button title="Profili redaktə et" variant="secondary" icon="edit" full onPress={() => router.push('/(tabs)/profile/edit')} style={{ flex: 1 }} />
                ) : unknownAuthor ? null : (
                  <>
                    <Button title={following ? 'İzlənir' : 'İzlə'} variant={following ? 'secondary' : 'primary'} full onPress={() => onFollow()} style={{ flex: 1 }} />
                    {trainer ? (
                      <Button title="Rezervasiya" variant="volt" full onPress={() => router.push({ pathname: '/(tabs)/discover/reserve/[id]', params: { id: trainer.id } })} style={{ flex: 1 }} />
                    ) : null}
                  </>
                )}
              </View>
            </View>
            <AppText variant="overline" color={palette.caption} style={{ paddingHorizontal: spacing.screen, marginTop: 22, marginBottom: 12 }}>
              VİDEOLAR
            </AppText>
          </View>
        }
        renderItem={({ item }) => <VideoTile v={item} />}
        ListEmptyComponent={
          <AppText variant="body" color={palette.textSecondary} center style={{ paddingTop: 30 }}>
            Hələ video paylaşılmayıb.
          </AppText>
        }
      />
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <AppText variant="title3">{value}</AppText>
      <AppText variant="caption" color={palette.caption} style={{ marginTop: 3 }}>
        {label}
      </AppText>
    </View>
  );
}

/** One video in the grid. The gradient is the FALLBACK, not the picture: a real
 *  frame from the clip is drawn over it as soon as the device has made one
 *  (see lib/videoPoster). Without it every tile in the grid looked the same.
 *
 *  Tapping plays it. This was a plain `View` with a play badge and no handler, so
 *  every tile on a creator's page — «12 video», twelve play triangles — did
 *  nothing at all when touched. The badge is an affordance and it now leads
 *  somewhere: the feed, opened on this clip. */
function VideoTile({ v }: { v: FeedVideo }) {
  const router = useRouter();
  return (
    <PressableScale
      activeScale={0.97}
      onPress={() => router.push({ pathname: '/(tabs)/feed', params: { videoId: v.id } })}
      style={styles.tile}>
      <VideoPoster id={v.id} videoUrl={v.videoUrl} gradient={v.gradient} />
      <View style={styles.tilePlay}>
        <Icon name="play" size={16} color="rgba(255,255,255,0.9)" />
      </View>
      <AppText numberOfLines={2} style={styles.tileCaption}>
        {v.caption}
      </AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', paddingTop: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  trainerTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(10,132,255,0.1)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, marginTop: 10 },
  stats: { flexDirection: 'row', gap: 30, marginTop: 18 },
  tile: { flex: 1, height: 190, borderRadius: 14, overflow: 'hidden', marginBottom: 10, justifyContent: 'flex-end', padding: 10 },
  tilePlay: { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  tileCaption: { color: palette.white, fontSize: 12, fontWeight: '600', lineHeight: 16 },
});
