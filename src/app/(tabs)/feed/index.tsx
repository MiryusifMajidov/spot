import { useEvent } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, useWindowDimensions, View, ViewToken } from 'react-native';
import { afterTransition } from '@/lib/afterTransition';
import { displayAuthor } from '@/lib/authorName';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconName } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { CommunityPost, FeedVideo } from '@/data/feed';
import { useAuthGate } from '@/lib/authGate';
import { useFetchPhase } from '@/lib/focusFetch';
import { useCommunityPosts, useFeedVideos, useGyms } from '@/lib/hooks';
import { showReportReasons } from '@/lib/moderation';
import { hasSupabaseConfig, supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/appStore';
import { findProgram, gymById } from '@/store/db';
import { actionSheet, openComments, toast, useUi } from '@/store/ui';
import { palette, spacing } from '@/theme';
import { azLower } from '@/lib/az';
import { likeVideo, unlikeVideo, myVideoLikes, myVideoSaves, saveVideo, unsaveVideo, videoSaveCount, likePost, unlikePost, myPostLikes, followProfile, unfollowProfile } from '@/lib/social';

type Mode = 'video' | 'community';

/** The one key a piece of content is known by: it is `comments.target_key` on the
 *  server AND the entry in the persisted like list, so a video like and a post like
 *  can never collide in `appStore.likedPosts`. */
const videoKey = (id: string) => `video:${id}`;
const postKey = (id: string) => `post:${id}`;

/* ---------------- comment counts, or none at all ----------------
 *
 * `feed_videos.comments` / `community_posts.comments` are seeded columns that no
 * write path anywhere in the app maintains — decoration, not data — so they are
 * never rendered. Comments themselves live in `public.comments` (one row each,
 * keyed by exactly these `video:` / `post:` strings, readable by anyone), and
 * that table is the only place a true number exists.
 *
 * One request covers a whole screenful: we ask for nothing but the `target_key`
 * column of the comments belonging to the items currently listed, and tally them
 * here. Until that answer arrives — and forever, if it never does — the button
 * carries its label and NO number. A missing count tells the reader nothing; an
 * invented one tells them something false. */
type CommentCounts = Record<string, number>;
/** Stable "nothing is known yet" value — a fresh {} each render would re-render forever. */
const NO_COUNTS: CommentCounts = {};

/** How many keys one request may ask about. The list is virtualised and nobody
 *  scrolls past this before the next focus refreshes the tally anyway; the cap is
 *  there so the query string cannot grow without bound. */
const COUNT_BATCH = 80;

/** Server-truth comment counts for `keys`. A key missing from the result means
 *  "not known" (still loading, offline, or the request failed) — never zero.
 *  `keys` must be a memoised array, or this refetches on every render. */
function useCommentCounts(keys: string[]): CommentCounts {
  const [counts, setCounts] = useState<CommentCounts>(NO_COUNTS);
  // The sheet is the only way to write a comment, so its closing is the single
  // moment a count can have changed under us. Reading it as a boolean keeps the
  // selector returning a primitive.
  const sheetOpen = useUi((s) => s.comments != null);
  // A string, so the effect compares the keys themselves and not the array identity.
  const joined = useMemo(() => keys.slice(0, COUNT_BATCH).join('\n'), [keys]);

  useEffect(() => {
    if (!hasSupabaseConfig || !joined || sheetOpen) return;
    const wanted = joined.split('\n');
    let alive = true;
    // Same reason as the deferred player mount: no network work during the tab swap.
    const cancel = afterTransition(() => {
      void (async () => {
        try {
          const { data, error } = await supabase.from('comments').select('target_key').in('target_key', wanted);
          // A failed read leaves every count unknown — the labels stay bare rather
          // than falling back to a zero we did not actually measure.
          if (!alive || error || !data) return;
          const next: CommentCounts = {};
          for (const k of wanted) next[k] = 0; // asked about ⇒ answered: zero is now known
          for (const row of data as { target_key: string }[]) next[row.target_key] = (next[row.target_key] ?? 0) + 1;
          setCounts(next);
        } catch {
          // Offline. Nothing is claimed.
        }
      })();
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [joined, sheetOpen]);

  return counts;
}

/** What the comment button says: the real number once we have one, otherwise the
 *  plain invitation. Zero also reads as «Şərh» — "be the first" is the useful
 *  thing to say there, and a lone 0 is noise. */
const commentLabel = (n: number | undefined) => (n && n > 0 ? String(n) : 'Şərh');

/** The name of the gym the user actually picked, or null if they picked none.
 *  Community posts carry the gym NAME (see api.createCommunityPost), so the name
 *  is what the "Zalım" tab filters on. */
function useHomeGymName(): string | null {
  const homeGymId = useAppStore((s) => s.profile.homeGymId);
  const gyms = useGyms();
  if (!homeGymId) return null;
  return gyms.find((g) => g.id === homeGymId)?.name ?? gymById(homeGymId)?.name ?? null;
}

/** Height of the scrub strip that sits between the caption and the bottom edge. */
const SCRUB_H = 34;

/* The native tab bar reserves its own space, so the feed scene already stops above
   it — this is only the small breathing room under the scrubber. (Do NOT add
   `insets.bottom` here: under NativeTabs this device reports ~220px for it, which
   would shove the whole overlay into the middle of the screen.) */
const BOTTOM_GAP = 10;

/** Trimmed, case-insensitive text match. Used for gym names, and as the
 *  fallback identity check on author display names (see useMyIdentity). */
const sameText = (a: string, b: string) => azLower(a.trim()) === azLower(b.trim());

/** Who the signed-in person is, for "is this row mine?" checks.
 *
 *  A guest — or someone who never finished onboarding — is nobody, so `isMe`
 *  is always false for them: a guest cannot be the author of anything.
 *
 *  Identity is the author's `profiles.id` (schema13 added `feed_videos.author_id`),
 *  never their display name — two people can share a name and a name can change.
 *  Rows written before that column existed carry a null id; for those we fall
 *  back to a name compare, which is the best that data supports. */
function useMyIdentity() {
  const guest = useAppStore((s) => s.guest);
  const onboarded = useAppStore((s) => s.onboarded);
  const myName = useAppStore((s) => s.profile.name);
  const myUsername = useAppStore((s) => s.profile.username);
  const myId = useAppStore((s) => s.profileId);
  const signedIn = !guest && onboarded && !!myName.trim();
  return {
    username: signedIn ? myUsername?.trim() || undefined : undefined,
    isMe: (authorId: string | null | undefined, author?: string | null) => {
      if (!signedIn) return false;
      if (authorId) return !!myId && authorId === myId;
      // Legacy row with no recorded author — name compare is all there is.
      return !!author && sameText(author, myName);
    },
  };
}

export default function Feed() {
  const [mode, setMode] = useState<Mode>('video');
  const homeGymName = useHomeGymName();
  return mode === 'video' ? (
    <VideoFeed mode={mode} setMode={setMode} homeGymName={homeGymName} />
  ) : (
    <CommunityFeed mode={mode} setMode={setMode} homeGymName={homeGymName} />
  );
}

function Toggle({
  mode,
  setMode,
  homeGymName,
  dark: isDark,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  homeGymName: string | null;
  dark?: boolean;
}) {
  const on = isDark ? palette.white : palette.inkText;
  const off = isDark ? 'rgba(255,255,255,0.5)' : palette.caption;
  // "Zalım" only when there really is a gym behind the tab; otherwise the tab shows
  // every gym's posts, so it must not call itself "my gym".
  const communityLabel = homeGymName ? 'Zalım' : 'İcma';
  return (
    <View style={styles.toggle}>
      {(['community', 'video'] as const).map((m) => (
        <PressableScale key={m} haptic activeScale={0.94} onPress={() => setMode(m)} style={{ alignItems: 'center', gap: 6 }}>
          <AppText style={{ fontSize: 16, fontWeight: mode === m ? '700' : '600', color: mode === m ? on : off }}>
            {m === 'video' ? 'Videolar' : communityLabel}
          </AppText>
          {mode === m ? <View style={styles.toggleBar} /> : <View style={{ height: 3 }} />}
        </PressableScale>
      ))}
    </View>
  );
}

function VideoFeed({ mode, setMode, homeGymName }: { mode: Mode; setMode: (m: Mode) => void; homeGymName: string | null }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const gate = useAuthGate();
  // Pause + mute everything when the feed tab isn't the focused screen.
  const [isFocused, setIsFocused] = useState(true);
  /* Building the video players is a native ExoPlayer setup, and expo-router gates
     the native tab swap on a deferred render — so doing it during the transition
     is what made tapping "Feed" feel like it hung for a second. The screen paints
     first; the players are attached on the next interaction tick. */
  const [playersReady, setPlayersReady] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      const cancel = afterTransition(() => setPlayersReady(true));
      return () => {
        cancel();
        setIsFocused(false);
      };
    }, [])
  );
  /* Ordering is done in `useFeedVideos` now: followed authors first (by profile
     id, from the `follows` table), then newest first.

     What was here before sorted by `s.following.includes(v.author)` — the
     device's list, keyed by DISPLAY NAME. Two people called «Yusif» were the
     same person to it, a rename silently broke the link, and it was reordering
     a list the server had already returned in an arbitrary order anyway, since
     every row's sort key was `ord: 0`. */
  const videos = useFeedVideos();
  const videoPhase = useFetchPhase('feed_videos');
  const commentKeys = useMemo(() => videos.map((v) => videoKey(v.id)), [videos]);
  const commentCounts = useCommentCounts(commentKeys);

  /* What the SERVER says this account liked and saved.
     The hearts and bookmarks are drawn from the device store so they answer the
     finger instantly, but nothing ever checked that store against the server:
     a like the server refused stayed filled in forever, and on a second device
     every video you had already liked came up empty. */
  useEffect(() => {
    if (!hasSupabaseConfig || !videos.length) return;
    let alive = true;
    const ids = videos.map((v) => v.id);
    Promise.all([myVideoLikes(ids), myVideoSaves(ids)])
      .then(([likes, saves]) => {
        if (!alive) return;
        useAppStore.getState().reconcileSocial(
          ids.map(videoKey),
          [...likes].map(videoKey),
          [...saves]
        );
      })
      // A failed check leaves the cached flags as they are. Clearing them would
      // claim the account liked nothing, which is not what a failed read means.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [videos]);
  const [h, setH] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((it) => it.isViewable);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const openCreator = () => {
    const av = videos[activeIndex];
    if (av) {
      router.push({
        pathname: '/(tabs)/feed/creator',
        params: { name: av.author, authorId: av.authorId ?? '', verified: av.verified ? '1' : '', isTrainer: av.isTrainer ? '1' : '' },
      });
    }
  };
  // Horizontal swipes: right → Zalım (community), left → the creator's profile.
  const swipe = Gesture.Exclusive(
    Gesture.Fling()
      .direction(Directions.RIGHT)
      .onEnd(() => runOnJS(setMode)('community')),
    Gesture.Fling()
      .direction(Directions.LEFT)
      .onEnd(() => runOnJS(openCreator)())
  );

  const openShare = () => gate(() => router.push('/(tabs)/feed/share'), 'Video paylaşmaq üçün');

  return (
    <GestureDetector gesture={swipe}>
      <View style={{ flex: 1, backgroundColor: palette.inkText }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        <StatusBar style="light" />
        {h > 0 && playersReady && (
          <FlatList
            data={videos}
            keyExtractor={(v) => v.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            renderItem={({ item, index }) => (
              <VideoPage
                bottomInset={BOTTOM_GAP}
                v={item}
                height={h}
                topInset={insets.top}
                active={index === activeIndex && isFocused}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                commentCount={commentCounts[videoKey(item.id)]}
                onOpenComments={() => openComments(videoKey(item.id))}
              />
            )}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            windowSize={2}
            maxToRenderPerBatch={1}
            initialNumToRender={1}
            removeClippedSubviews
            ListEmptyComponent={
              /* «Boş» ilə «oxuya bilmədik» eyni şey deyil. The fetch layer now
                 reports which one it was (lib/focusFetch), so a failed read no
                 longer claims nobody has ever posted anything. */
              <View style={[styles.videoEmpty, { height: h, paddingTop: insets.top + 80 }]}>
                <Icon name={videoPhase === 'failed' ? 'x' : 'video'} size={30} color="rgba(255,255,255,0.6)" />
                <AppText style={{ color: palette.white, fontSize: 17, fontWeight: '700', marginTop: 14 }}>
                  {videoPhase === 'failed' ? 'Videolar yüklənmədi' : 'Hələ video yoxdur'}
                </AppText>
                <AppText style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 260 }}>
                  {videoPhase === 'failed'
                    ? 'Serverlə əlaqə alınmadı — bu, feed-in boş olduğu demək deyil. İnterneti yoxlayıb yenidən aç.'
                    : 'Bu feed-də hələ heç nə paylaşılmayıb. Birinci sən ol — texnika videonu yüklə.'}
                </AppText>
                {videoPhase === 'failed' ? null : (
                  <Button title="Video paylaş" variant="volt" icon="cam" onPress={openShare} style={{ marginTop: 20 }} />
                )}
              </View>
            }
          />
        )}
        <View style={[styles.videoHeader, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <PressableScale activeScale={0.9} onPress={openShare}>
            <Icon name="cam" size={24} color={palette.white} />
          </PressableScale>
          <Toggle mode={mode} setMode={setMode} homeGymName={homeGymName} dark />
          <PressableScale activeScale={0.9} onPress={() => router.push('/(tabs)/discover')}>
            <Icon name="search" size={24} color={palette.white} />
          </PressableScale>
        </View>

      </View>
    </GestureDetector>
  );
}

function VideoPage({ v, height, topInset, bottomInset, active, muted, onToggleMute, commentCount, onOpenComments }: { v: FeedVideo; height: number; topInset: number; bottomInset: number; active: boolean; muted: boolean; onToggleMute: () => void; commentCount: number | undefined; onOpenComments: () => void }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [paused, setPaused] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const gate = useAuthGate();

  const following = useAppStore((s) => (v.authorId ? s.following.includes(v.authorId) : false));
  const toggleFollow = useAppStore((s) => s.toggleFollow);
  // Your own video: nobody follows themselves, so the control is not shown at all.
  const me = useMyIdentity();
  const isMine = me.isMe(v.authorId, v.author);
  const saved = useAppStore((s) => s.savedVideos.includes(v.id));
  const toggleSaved = useAppStore((s) => s.toggleSavedVideo);
  // Likes live in the persisted store (not component state) so they survive FlatList
  // recycling and app restarts. No invented aggregate count is shown.
  const liked = useAppStore((s) => s.likedPosts.includes(videoKey(v.id)));
  const toggleLike = useAppStore((s) => s.toggleLikedPost);
  const linkedProgram = v.linkedProgramId ? findProgram(v.linkedProgramId) : undefined;

  /* The like count as the server last reported it, plus this device's own
     un-acknowledged tap. Without the adjustment the number sits still while the
     heart fills — the video would say «12» to someone who just became the 13th.
     `v.likes` is trigger-maintained (schema43/44); nothing here writes it. */
  const [likedAtLoad] = useState(liked);
  const likeCount = Math.max(0, (v.likes ?? 0) + (liked === likedAtLoad ? 0 : liked ? 1 : -1));

  /* Save count: the author's own number, fetched only on the author's own
     video. `video_save_count` returns null for anyone else, and null draws
     nothing rather than a «0» that would read as «nobody saved it». */
  const [saveCount, setSaveCount] = useState<number | null>(null);
  const refreshSaveCount = useCallback(() => {
    if (!isMine || !hasSupabaseConfig) return;
    videoSaveCount(v.id).then(setSaveCount).catch(() => {});
  }, [isMine, v.id]);
  useEffect(() => {
    refreshSaveCount();
  }, [refreshSaveCount]);

  const share = () => {
    Share.share({ message: `${displayAuthor(v.author)}: ${v.caption}\n\n${v.videoUrl}` }).catch(() => {});
  };
  const openCreator = () =>
    router.push({ pathname: '/(tabs)/feed/creator', params: { name: v.author, authorId: v.authorId ?? '', verified: v.verified ? '1' : '', isTrainer: v.isTrainer ? '1' : '' } });

  /* A row whose `video_url` is null used to be handed a cartoon sample clip.
     It now arrives as an empty string, and there is nothing honest to play —
     so no source is given to the player and the card says so instead. */
  const hasSource = !!v.videoUrl;
  const player = useVideoPlayer(hasSource ? v.videoUrl : null, (p) => {
    p.loop = true;
    p.muted = muted;
    p.timeUpdateEventInterval = 0.25;
  });

  const timeEvt = useEvent(player, 'timeUpdate');
  const currentTime = timeEvt?.currentTime ?? 0;
  const duration = player.duration || 0;
  const progress = dragRatio != null ? dragRatio : duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const commitSeek = (ratio: number) => {
    const d = player.duration || 0;
    if (d > 0) player.currentTime = ratio * d;
    setDragRatio(null);
  };
  const scrub = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onStart((e) => runOnJS(setDragRatio)(Math.min(1, Math.max(0, e.x / width))))
    .onUpdate((e) => runOnJS(setDragRatio)(Math.min(1, Math.max(0, e.x / width))))
    .onEnd((e) => runOnJS(commitSeek)(Math.min(1, Math.max(0, e.x / width))));

  // Play only the visible page; pause the rest. Reset manual pause when it scrolls away.
  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);

  useEffect(() => {
    if (!active) setPaused(false);
  }, [active]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  /* The stage is the page minus the floating tab bar's footprint. Nothing visual
     is allowed under the bar: not the video, not the scrubber, not the caption. */
  const stage = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: bottomInset };

  return (
    <View style={{ height, width: '100%' }}>
      <LinearGradient colors={v.gradient} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
      {hasSource ? (
        /* `contain`, never `cover`.
         *
         * Most of what people post here is a technique demo — a squat, a
         * deadlift, a press — and it is very often filmed in landscape or from a
         * gym mirror. `cover` crops to fill the phone, and what it crops is
         * exactly what the viewer came to judge: the bar path, the feet, the
         * back angle. A letterboxed frame the viewer can actually read beats a
         * full-bleed one that hides the lift. The gradient behind fills the gap. */
        <VideoView player={player} contentFit="contain" nativeControls={false} surfaceType="textureView" style={stage} />
      ) : (
        <View style={[stage, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }]}>
          <Icon name="video" size={30} color="rgba(255,255,255,0.6)" />
          <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '600', marginTop: 12 }}>Video açılmadı</AppText>
          <AppText style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 }}>
            Bu paylaşımın video faylı yüklənməyib.
          </AppText>
        </View>
      )}

      {/* tap anywhere on the video to pause/resume */}
      <Pressable style={stage} onPress={() => setPaused((p) => !p)}>
        {paused && active ? (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={styles.playBadge}>
              <Icon name="play" size={30} color={palette.white} />
            </View>
          </View>
        ) : null}
      </Pressable>

      <PressableScale activeScale={0.85} onPress={onToggleMute} style={[styles.muteBtn, { top: topInset + 52 }]}>
        <Icon name={muted ? 'mute' : 'sound'} size={17} color={palette.white} />
      </PressableScale>

      <LinearGradient
        colors={['transparent', 'rgba(11,11,14,0.85)']}
        style={[styles.bottomScrim, { bottom: bottomInset }]}
        pointerEvents="none"
      />

      {/* Caption + action rail clear both the scrubber and the bar. */}
      <View style={[styles.pageBottom, { bottom: bottomInset + SCRUB_H }]}>
        <View style={{ flex: 1 }}>
          <View style={styles.authorRow}>
            <PressableScale activeScale={0.94} onPress={openCreator} style={styles.authorTap}>
              <Avatar name={displayAuthor(v.author)} size={36} />
              <View>
                <View style={styles.authorNameRow}>
                  <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '600' }}>{displayAuthor(v.author)}</AppText>
                  {v.verified ? <Icon name="verified" size={14} color={palette.blue} /> : null}
                </View>
                {/* Only your own handle, and only once it really exists. */}
                {isMine && me.username ? <AppText style={styles.authorHandle}>@{me.username}</AppText> : null}
              </View>
            </PressableScale>
            {isMine ? null : (
              <PressableScale
                activeScale={0.92}
                onPress={() =>
                  gate(() => {
                    /* The follow row is what makes it real: `followProfile` was
                       written in schema43 and never called from anywhere, so
                       «İzlə» only ever touched the device store — the author
                       never learned, the feed's followed-first ordering had an
                       empty set to work with, and the next launch's `syncSocial`
                       wiped the flag. */
                    if (!v.authorId) {
                      toast('Bu videonun müəllifi qeyd olunmayıb — izləmək mümkün deyil', 'error');
                      return;
                    }
                    const next = !following;
                    toggleFollow(v.authorId);
                    if (!hasSupabaseConfig) return;
                    (next ? followProfile(v.authorId) : unfollowProfile(v.authorId)).catch(() => {
                      toggleFollow(v.authorId!);
                      toast('İzləmə göndərilmədi — yenidən cəhd et', 'error');
                    });
                  }, 'İzləmək üçün')
                }
                style={[styles.follow, following && { backgroundColor: palette.volt, borderColor: palette.volt }]}>
                <AppText style={{ fontSize: 12, fontWeight: '600', color: following ? palette.inkText : palette.white }}>{following ? 'İzlənir' : 'İzlə'}</AppText>
              </PressableScale>
            )}
          </View>
          <AppText style={styles.caption}>{v.caption}</AppText>
          {v.hashtags.length > 0 ? (
            <View style={styles.hashtags}>
              {v.hashtags.map((t) => (
                <View key={t} style={styles.hashtag}>
                  <AppText style={{ color: palette.white, fontSize: 11.5, fontWeight: '600' }}>{t}</AppText>
                </View>
              ))}
            </View>
          ) : null}
          {linkedProgram ? (
            <PressableScale
              activeScale={0.98}
              onPress={() => router.push({ pathname: '/(tabs)/workout/program/[id]', params: { id: linkedProgram.id } })}
              style={styles.programCard}>
              <Icon name="dumbbell" size={18} color={palette.volt} />
              <View style={{ flex: 1 }}>
                <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{v.linkedProgramTitle || linkedProgram.title}</AppText>
                <AppText style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: 3 }}>Proqrama bax →</AppText>
              </View>
              <Icon name="chevR" size={17} color="rgba(255,255,255,0.7)" />
            </PressableScale>
          ) : null}
        </View>

        <View style={styles.rail}>
          <RailBtn
            icon="heart"
            active={liked}
            activeColor={palette.red}
            count={likeCount}
            onPress={() =>
              gate(() => {
                /* The device flag flips first so the heart answers the finger,
                   then the server row decides whether it is real. A like that
                   only this phone knows about is the bug schema43 fixed — the
                   author would never learn about it — so a failed write puts the
                   heart back rather than leaving it filled. */
                const next = !liked;
                toggleLike(videoKey(v.id));
                if (!hasSupabaseConfig) return;
                (next ? likeVideo(v.id) : unlikeVideo(v.id)).catch(() => {
                  toggleLike(videoKey(v.id));
                  toast('Bəyənmə göndərilmədi — yenidən cəhd et', 'error');
                });
              }, 'Bəyənmək üçün')
            }
          />
          {/* The only text left is a real count — never a word for the state. */}
          <RailBtn icon="msg" count={commentCount} onPress={onOpenComments} />
          <RailBtn
            icon={saved ? 'bookmarkOn' : 'bookmark'}
            active={saved}
            activeColor={palette.volt}
            /* Only the author sees how many people saved it — see social.ts.
               On everybody else's video this is null and no number is drawn. */
            count={saveCount}
            onPress={() =>
              gate(() => {
                /* Same shape as the heart: the device flag flips first, the
                   server row decides. Saving used to write ONLY to the device
                   store, so a reinstall emptied the shelf and the author never
                   learned the clip was worth keeping (schema45). */
                const next = !saved;
                toggleSaved(v.id);
                if (!hasSupabaseConfig) return;
                (next ? saveVideo(v.id) : unsaveVideo(v.id))
                  .then(() => {
                    if (isMine) refreshSaveCount();
                  })
                  .catch(() => {
                    toggleSaved(v.id);
                    toast('Saxlanılmadı — yenidən cəhd et', 'error');
                  });
              }, 'Saxlamaq üçün')
            }
          />
          <RailBtn icon="share" onPress={share} />
        </View>
      </View>

      {/* Reels-style scrubber — drag to seek back and forth */}
      <GestureDetector gesture={scrub}>
        <View style={[styles.scrubHit, { bottom: bottomInset }]}>
          <View style={[styles.scrubTrack, dragRatio != null && styles.scrubTrackActive]}>
            <View style={[styles.scrubFill, { width: progress * width }]} />
            {dragRatio != null ? <View style={[styles.scrubKnob, { left: progress * width }]} /> : null}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

/** One action in the right-hand rail — an icon, and nothing else unless there is
 *  a real number to show.
 *
 *  State is carried by COLOUR, not by a word: the heart fills red when liked, the
 *  bookmark fills volt when saved. The labels it used to carry («Bəyəndin»,
 *  «Saxlanıldı») were both noise and a layout problem — they are wider than the
 *  inactive words, so acting on a video reflowed the whole overlay sideways. */
function RailBtn({
  icon,
  active,
  activeColor,
  count,
  onPress,
}: {
  icon: IconName;
  active?: boolean;
  activeColor?: string;
  count?: number | null;
  onPress?: () => void;
}) {
  return (
    <PressableScale activeScale={0.85} onPress={onPress} style={styles.railBtn}>
      <Icon name={icon} size={30} color={active ? (activeColor ?? palette.volt) : palette.white} />
      {/* A count of 0 or an unknown one shows nothing — a bare «0» would state
          that nobody commented, which is not the same as not having counted. */}
      {count ? (
        <AppText numberOfLines={1} style={styles.railLabel}>
          {count}
        </AppText>
      ) : null}
    </PressableScale>
  );
}

function CommunityFeed({ mode, setMode, homeGymName }: { mode: Mode; setMode: (m: Mode) => void; homeGymName: string | null }) {
  // The floating tab bar takes no layout space, so the list clears it itself.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const gate = useAuthGate();
  const allPosts = useCommunityPosts();
  const postPhase = useFetchPhase('community_posts');
  const [hidden, setHidden] = useState<string[]>([]);
  // With a home gym the tab shows THAT gym only — that is what "Zalım" promises.
  // Without one there is nothing to filter by, so we show every gym and the tab
  // is labelled "İcma" instead (see Toggle).
  const posts = useMemo(
    () => (homeGymName ? allPosts.filter((p) => p.gym && sameText(p.gym, homeGymName)) : allPosts),
    [allPosts, homeGymName]
  );
  const visible = useMemo(() => posts.filter((p) => !hidden.includes(p.id)), [posts, hidden]);
  const commentKeys = useMemo(() => visible.map((p) => postKey(p.id)), [visible]);
  const commentCounts = useCommentCounts(commentKeys);

  // Same reconcile as the video feed: the server decides which of these this
  // account really liked, and a failed read changes nothing.
  useEffect(() => {
    if (!hasSupabaseConfig || !visible.length) return;
    let alive = true;
    const ids = visible.map((p) => p.id);
    myPostLikes(ids)
      .then((likes) => {
        if (!alive) return;
        useAppStore.getState().reconcileSocial(ids.map(postKey), [...likes].map(postKey));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible]);

  const swipeBack = Gesture.Fling()
    .direction(Directions.LEFT)
    .onEnd(() => runOnJS(setMode)('video'));
  const openCompose = () => gate(() => router.push('/(tabs)/feed/compose'), 'Post paylaşmaq üçün');
  return (
    <Screen>
      <View style={styles.communityTop}>
        <View style={{ flex: 1 }}>
          <Toggle mode={mode} setMode={setMode} homeGymName={homeGymName} />
        </View>
        <PressableScale activeScale={0.9} onPress={openCompose} style={styles.composeBtn}>
          <Icon name="plus" size={18} color={palette.inkText} />
        </PressableScale>
      </View>
      {!homeGymName ? (
        <PressableScale
          activeScale={0.98}
          onPress={() => router.push('/(tabs)/profile/edit')}
          style={styles.noGymBanner}>
          <Icon name="dumbbell" size={17} color={palette.textSecondary} />
          <AppText variant="footnote" color={palette.textSecondary} style={{ flex: 1, lineHeight: 18 }}>
            Əsas zalın seçilməyib — burada bütün zalların postları görünür. Zalını seç, yalnız onun postlarını göstərək.
          </AppText>
          <Icon name="chevR" size={16} color={palette.tertiary} />
        </PressableScale>
      ) : null}
      <GestureDetector gesture={swipeBack}>
        <FlatList
          data={visible}
          keyExtractor={(p) => p.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 40, flexGrow: 1 }}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              commentCount={commentCounts[postKey(item.id)]}
              onOpenComments={() => openComments(postKey(item.id))}
              onHide={() => setHidden((h) => [...h, item.id])}
            />
          )}
          ListEmptyComponent={
            <View style={styles.communityEmpty}>
              <Icon name={postPhase === 'failed' ? 'x' : 'msg'} size={28} color={palette.tertiary} />
              <AppText variant="headline" center style={{ marginTop: 14 }}>
                {postPhase === 'failed'
                  ? 'Postlar yüklənmədi'
                  : homeGymName
                    ? `${homeGymName} zalında hələ post yoxdur`
                    : 'Hələ post yoxdur'}
              </AppText>
              <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 8, lineHeight: 21, maxWidth: 270 }}>
                {postPhase === 'failed'
                  ? 'Serverlə əlaqə alınmadı — burada post olmadığı demək deyil. İnterneti yoxlayıb yenidən aç.'
                  : homeGymName
                    ? 'Nailiyyətini, sualını və ya motivasiyanı yaz — zalındakılar görəcək. Digər zalların postları burada göstərilmir.'
                    : 'İcmada hələ heç nə paylaşılmayıb. Birinci sən ol.'}
              </AppText>
              {postPhase === 'failed' ? null : (
                <Button title="İlk postu yaz" icon="plus" onPress={openCompose} style={{ marginTop: 20 }} />
              )}
            </View>
          }
        />
      </GestureDetector>
    </Screen>
  );
}

function PostCard({ post, commentCount, onOpenComments, onHide }: { post: CommunityPost; commentCount: number | undefined; onOpenComments: () => void; onHide: () => void }) {
  const gate = useAuthGate();
  const liked = useAppStore((s) => s.likedPosts.includes(postKey(post.id)));
  const toggleLike = useAppStore((s) => s.toggleLikedPost);
  const [likedAtLoad] = useState(liked);
  const likeCount = Math.max(0, (post.likes ?? 0) + (liked === likedAtLoad ? 0 : liked ? 1 : -1));

  /* This used to call `toggleLike` and stop there — the like was written to the
     device store and nowhere else, so the author never learned about it and it
     vanished on reinstall. `post_likes` (schema43) is the real record; the
     counter on the row follows from a trigger. */
  const onLike = () =>
    gate(() => {
      const next = !liked;
      toggleLike(postKey(post.id));
      if (!hasSupabaseConfig) return;
      (next ? likePost(post.id) : unlikePost(post.id)).catch(() => {
        toggleLike(postKey(post.id));
        toast('Bəyənmə göndərilmədi — yenidən cəhd et', 'error');
      });
    }, 'Bəyənmək üçün');

  const onMore = () =>
    actionSheet({
      title: post.author,
      actions: [
        {
          label: 'Şikayət et',
          style: 'destructive',
          // Concrete reason, always: the category is what decides the moderator's SLA
          // (təhlükəsizlik = 2 saat) — a bare «digər» made that lane unreachable.
          onPress: () =>
            showReportReasons({
              title: 'Postu şikayət et',
              target: { type: 'content', id: post.id },
              note: [`İcma postu · ${post.author}`, post.gym, post.text?.slice(0, 180)]
                .filter(Boolean)
                .join(' · '),
            }),
        },
        { label: 'Bu postu gizlət', onPress: () => { onHide(); toast('Post gizlədildi', 'info'); } },
        { label: 'Ləğv et', style: 'cancel' },
      ],
    });
  return (
    <View style={styles.post}>
      <View style={styles.postHead}>
        <Avatar name={displayAuthor(post.author)} size={40} />
        <View style={{ flex: 1 }}>
          <AppText variant="headline">{displayAuthor(post.author)}</AppText>
          <AppText variant="caption" color={palette.caption} style={{ marginTop: 2 }}>
            {[post.gym, post.timeAgo].filter(Boolean).join(' · ')}
          </AppText>
        </View>
        <PressableScale activeScale={0.9} haptic={false} onPress={onMore} hitSlop={10}>
          <Icon name="more" size={20} color={palette.tertiary} />
        </PressableScale>
      </View>

      {post.type === 'progress' ? (
        <View style={styles.progressImages}>
          {['Əvvəl', 'Sonra'].map((label) => (
            <View key={label} style={styles.progressImg}>
              <LinearGradient colors={['#D2D2D8', '#EDEDF0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <View style={styles.progressTag}>
                <AppText style={{ color: palette.white, fontSize: 10.5, fontWeight: '700' }}>{label}</AppText>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <AppText variant="body" color={palette.text3} style={{ marginTop: 12, lineHeight: 21 }}>
        {post.text}
      </AppText>

      {post.stats ? (
        <View style={styles.statsRow}>
          {post.stats.map((s) => (
            <View key={s.label} style={styles.statChip}>
              <AppText style={{ fontSize: 15, fontWeight: '700' }}>{s.value}</AppText>
              <AppText style={{ fontSize: 11, color: palette.caption, marginTop: 2 }}>{s.label}</AppText>
            </View>
          ))}
        </View>
      ) : null}

      {post.trainerComment ? (
        <View style={styles.trainerComment}>
          <Icon name="verified" size={14} color={palette.blue} />
          <View style={{ flex: 1 }}>
            <AppText style={{ fontSize: 12.5, fontWeight: '700' }}>{post.trainerComment.name} · müəllim</AppText>
            <AppText variant="footnote" color={palette.text3} style={{ marginTop: 3, lineHeight: 18 }}>
              {post.trainerComment.text}
            </AppText>
          </View>
        </View>
      ) : null}

      <View style={styles.postActions}>
        {/* Colour, not a word — same reason as the video rail. */}
        <PressableScale activeScale={0.9} onPress={onLike} style={styles.postAction}>
          <Icon name="heart" size={20} color={liked ? palette.red : palette.textSecondary} />
          {/* A real count only. Zero shows nothing — «0 bəyənmə» under someone's
              first post is a verdict nobody asked for. */}
          {likeCount ? (
            <AppText variant="subhead" color={palette.textSecondary}>
              {likeCount}
            </AppText>
          ) : null}
        </PressableScale>
        <PressableScale activeScale={0.9} haptic={false} onPress={onOpenComments} style={styles.postAction}>
          <Icon name="msg" size={19} color={palette.textSecondary} />
          <AppText variant="subhead" color={palette.textSecondary}>
            {commentLabel(commentCount)}
          </AppText>
        </PressableScale>
        <View style={{ flex: 1 }} />
        <PressableScale activeScale={0.95} onPress={onOpenComments} style={styles.feedbackBtn}>
          <AppText style={{ fontSize: 12.5, fontWeight: '600', color: palette.inkText }}>Feedback ver</AppText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', justifyContent: 'center', gap: 22, alignItems: 'flex-start' },
  toggleBar: { width: 22, height: 3, borderRadius: 2, backgroundColor: palette.volt },
  videoHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: spacing.screen },
  videoEmpty: { alignItems: 'center', paddingHorizontal: 30 },
  bottomScrim: { position: 'absolute', left: 0, right: 0, height: 300 },
  playBadge: { width: 68, height: 68, borderRadius: 999, backgroundColor: 'rgba(11,11,14,0.42)', alignItems: 'center', justifyContent: 'center' },
  muteBtn: { position: 'absolute', right: spacing.screen, width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(11,11,14,0.4)', alignItems: 'center', justifyContent: 'center' },
  scrubHit: { position: 'absolute', left: 0, right: 0, height: SCRUB_H, justifyContent: 'flex-end', paddingBottom: 6 },
  scrubTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.28)', justifyContent: 'center' },
  scrubTrackActive: { height: 5 },
  scrubFill: { height: '100%', backgroundColor: palette.volt },
  scrubKnob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: palette.white, marginLeft: -7, top: -4.5 },
  pageBottom: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: 14, alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 6 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  authorTap: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  authorNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  authorHandle: { color: 'rgba(255,255,255,0.62)', fontSize: 12, marginTop: 1 },
  follow: { borderWidth: 1.2, borderColor: 'rgba(255,255,255,0.5)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  caption: { color: 'rgba(255,255,255,0.92)', fontSize: 14.5, lineHeight: 21, marginTop: 11 },
  hashtags: { flexDirection: 'row', gap: 7, marginTop: 11, flexWrap: 'wrap' },
  hashtag: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  programCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 13, padding: 11, marginTop: 13 },
  rail: { alignItems: 'center', gap: 22, paddingBottom: 8 },
  railBtn: { alignItems: 'center', gap: 5, minWidth: 44 },
  railLabel: { color: palette.white, fontSize: 11.5, fontWeight: '600', textAlign: 'center' },
  communityTop: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.screen, paddingBottom: 8 },
  communityEmpty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  noGymBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.white,
    borderRadius: 14,
    padding: 12,
    marginHorizontal: spacing.screen,
    marginBottom: 10,
  },
  composeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.volt, alignItems: 'center', justifyContent: 'center' },
  post: { backgroundColor: palette.white, borderRadius: 18, padding: 16, marginBottom: 12 },
  postHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressImages: { flexDirection: 'row', gap: 8, marginTop: 14 },
  progressImg: { flex: 1, height: 180, borderRadius: 14, overflow: 'hidden' },
  progressTag: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(11,11,14,0.6)', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statChip: { flex: 1, backgroundColor: palette.grouped, borderRadius: 13, padding: 12, alignItems: 'center' },
  trainerComment: { flexDirection: 'row', gap: 9, backgroundColor: 'rgba(10,132,255,0.08)', borderRadius: 13, padding: 13, marginTop: 14 },
  postActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 14 },
  postAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34 },
  feedbackBtn: { backgroundColor: palette.grouped, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
