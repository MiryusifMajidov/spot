import { useEvent } from 'expo';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Dimensions, Platform, ScrollView, Share, StatusBar, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { repsText } from '@/lib/duration';
import { useFormat, useT } from '@/lib/useT';
import { exerciseById, LibExercise } from '@/store/db';
import { dark, iconSize, palette } from '@/theme';

const { width } = Dimensions.get('window');
/* The pan reports x relative to the track's own hit area, which progressWrap
   insets by 16 px on each side. Dividing by the full window width meant the last
   ~8% of a clip could never be reached by dragging. */
const TRACK_W = width - 32;

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export default function ExerciseVideo() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Named `num`, not `fmt`: that name is already the clip-time formatter above.
  const num = useFormat();
  /* `name`/`video`/`sets`/`reps` arrive when the move came from somebody's
     PROGRAM rather than from SPOT's library: a coach may write a move the
     library has never heard of and film it themselves (schema76), and that clip
     has to be watchable by the person following the program. */
  const params = useLocalSearchParams<{
    id?: string;
    name?: string;
    video?: string;
    sets?: string;
    reps?: string;
    muscle?: string;
  }>();
  const id = params.id;
  const known = id ? exerciseById(id) : null;
  /* NOT `?? exerciseLibrary[0]`. An id the library does not have used to open
     this screen showing «Ştanqla skvat» — its video, its target sets, its common
     mistake — under whatever the person had tapped. A wrong exercise presented
     with full confidence is worse than no screen. */
  const ex: LibExercise | null = known
    ? {
        ...known,
        // The author's own clip beats the library's, when they filmed one.
        videoUrl: params.video || known.videoUrl,
        defaultSets: Number(params.sets) || known.defaultSets,
        reps: params.reps || known.reps,
      }
    : params.name
      ? {
          id: id ?? 'own',
          name: params.name,
          muscle: params.muscle ?? '',
          equipment: '—',
          defaultSets: Number(params.sets) || 3,
          reps: params.reps ?? '',
          videoUrl: params.video ?? '',
          commonMistake: '',
          substitutes: [],
          isCompound: false,
        }
      : null;

  /* The clock over this dark screen. A mount-time <StatusBar style="light" /> sat
     here and the iPhone still drew the clock black on black. The screen is a plain
     push inside the Məşq stack (not a modal), so presentation is not the reason.
     What can leave the wrong style is React Native's status-bar stack itself:
     - a component entry is pushed once, when the screen MOUNTS, and tab screens are
       never unmounted. Its place in the stack is decided by mount order rather than
       by what is on screen, and it outlives the moment it was meant for — switch
       tabs from here and the light clock stayed on over the next, white, screen.
     - on iOS only, the stack skips the native call whenever it believes the bar
       already has the wanted style, so a bar changed outside the stack is never
       put right again.
     So the entry is pushed on every FOCUS (on top while this screen is the one in
     front), popped on blur, and on iOS the native style is also set directly so
     that de-duplication cannot swallow it. setBarStyle also rewrites the stack's
     bottom default; the root layout's own entry always sits above that default, so
     it never becomes what another screen shows.
     This path needs UIViewControllerBasedStatusBarAppearance = NO, which is what
     Expo's prebuild template writes into Info.plist. */
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios') StatusBar.setBarStyle('light-content', true);
      const entry = StatusBar.pushStackEntry({ barStyle: 'light-content', animated: true });
      return () => StatusBar.popStackEntry(entry);
    }, [])
  );

  const [playing, setPlaying] = useState(true);
  const [half, setHalf] = useState(false);
  const [muted, setMuted] = useState(true);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  /* No exercise in the library carries footage yet. Rendering the player anyway
     produced a black rectangle with a play button, a 0.5x control and a scrubber
     — a full video UI in front of nothing. The screen is still worth opening for
     the target sets/reps, the most common mistake and the substitutes, so those
     stay; only the pretend player goes. */
  const hasVideo = !!ex?.videoUrl;
  const player = useVideoPlayer(hasVideo && ex ? ex.videoUrl : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  const timeEvt = useEvent(player, 'timeUpdate');
  const currentTime = timeEvt?.currentTime ?? 0;
  const duration = player.duration || 0;
  const progress = dragRatio != null ? dragRatio : duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    if (playing) player.play();
    else player.pause();
  }, [playing, player]);
  /* `player` is not a React value: expo-video hands back a handle onto the native
     player, and https://docs.expo.dev/versions/v57.0.0/sdk/video/ documents
     `playbackRate`, `muted` and `currentTime` as properties you assign to — there
     is no setter to call instead. react-hooks/immutability cannot tell that apart
     from mutating state returned by a hook, and every assignment below happens in
     an effect or a gesture handler, never while rendering. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.playbackRate = half ? 0.5 : 1;
  }, [half, player]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    player.muted = muted;
  }, [muted, player]);

  const commitSeek = (ratio: number) => {
    const d = player.duration || 0;
    // eslint-disable-next-line react-hooks/immutability
    if (d > 0) player.currentTime = ratio * d;
    setDragRatio(null);
  };
  const scrub = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onStart((e) => runOnJS(setDragRatio)(Math.min(1, Math.max(0, e.x / TRACK_W))))
    .onUpdate((e) => runOnJS(setDragRatio)(Math.min(1, Math.max(0, e.x / TRACK_W))))
    .onEnd((e) => runOnJS(commitSeek)(Math.min(1, Math.max(0, e.x / TRACK_W))));

  /* After the hooks, so their order never changes between renders. An id that
     resolves to nothing used to render the library's first exercise; now it
     says what actually happened. */
  if (!ex) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
        <AppText style={{ color: palette.white, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>
          {t('Hərəkət tapılmadı')}
        </AppText>
        <AppText style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 8 }}>
          {t('Bu hərəkət SPOT kitabxanasında yoxdur. Proqramın müəllifi onu özü yazıbsa, təfərrüatı proqram səhifəsində görünür.')}
        </AppText>
        <PressableScale activeScale={0.95} onPress={() => router.back()} hitSlop={14} style={{ marginTop: 20 }}>
          <AppText style={{ color: palette.volt, fontSize: 15, fontWeight: '600' }}>{t('Geri')}</AppText>
        </PressableScale>
      </View>
    );
  }

  /* X and share, shared by both states below. 44 pt circles — the old 34 pt ones
     with 17–18 px glyphs were under the minimum tap size and looked undersized
     beside the 44 pt video controls. The x glyph only fills half of its 24-unit
     box and the share glyph most of it, so 24/22 reads as one size. */
  const circleFill = hasVideo ? styles.circleOnVideo : styles.circlePlain;
  const headerButtons = (
    <>
      <PressableScale
        activeScale={0.9}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={t('Bağla')}
        style={[styles.circle, circleFill]}>
        <Icon name="x" size={iconSize.inCircle} color={palette.white} />
      </PressableScale>
      <PressableScale
        activeScale={0.9}
        onPress={() => Share.share({ message: t('{name} — düzgün texnika. SPOT-da bax.', { name: t(ex.name) }) }).catch(() => {})}
        accessibilityRole="button"
        accessibilityLabel={t('Paylaş')}
        style={[styles.circle, circleFill]}>
        <Icon name="share" size={iconSize.inCircle} color={palette.white} />
      </PressableScale>
    </>
  );

  /* A move written into somebody's program arrives with no muscle, «—» for
     equipment and possibly no reps; joining the fields blindly printed «· — · 3
     set × » with dangling separators. */
  const reps = repsText(ex.reps, t);
  const meta = [
    ex.muscle ? t(ex.muscle) : '',
    ex.equipment && ex.equipment !== '—' ? t(ex.equipment) : '',
    reps
      ? t('{sets} set × {reps}', { sets: ex.defaultSets, reps, count: ex.defaultSets })
      : t('{n} set', { n: ex.defaultSets, count: ex.defaultSets }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.root}>
      {hasVideo ? (
        <View style={styles.video}>
          <VideoView player={player} contentFit="contain" nativeControls={false} surfaceType="textureView" style={StyleSheet.absoluteFill} />
          {/* box-none: this layer fills the frame only to centre its buttons. As a
              plain View it took every touch inside the frame, so X and share could
              not be pressed whenever a clip was playing. */}
          <View style={styles.controls} pointerEvents="box-none">
            <PressableScale activeScale={0.9} onPress={() => setHalf((h) => !h)} style={[styles.sideCtrl, half && { backgroundColor: palette.volt }]}>
              {/* «0,5x» in Azerbaijani and Russian — a decimal comma, like every other number in the app. */}
              <AppText style={{ fontSize: 12, fontWeight: '600', color: half ? palette.inkText : palette.white }}>{num.decimal(0.5)}x</AppText>
            </PressableScale>
            <PressableScale activeScale={0.9} onPress={() => setPlaying((p) => !p)} style={styles.playBig}>
              {/* Two bars, not the timer glyph that stood in for «pause» — the icon
                  set has no pause symbol, and a stopwatch on a play button reads
                  as something else entirely. */}
              {playing ? (
                <View style={styles.pause}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
              ) : (
                <Icon name="play" size={26} color={palette.inkText} />
              )}
            </PressableScale>
            <PressableScale activeScale={0.9} onPress={() => setMuted((m) => !m)} style={[styles.sideCtrl, !muted && { backgroundColor: palette.volt }]}>
              <Icon name={muted ? 'mute' : 'sound'} size={18} color={muted ? palette.white : palette.inkText} />
            </PressableScale>
          </View>
          <View style={styles.progressWrap}>
            <GestureDetector gesture={scrub}>
              <View style={styles.trackHit}>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${progress * 100}%` }]} />
                  <View style={[styles.knob, { left: `${progress * 100}%` }]} />
                </View>
              </View>
            </GestureDetector>
            <View style={styles.times}>
              <AppText style={styles.time}>{fmt(currentTime)}</AppText>
              <AppText style={styles.time}>{fmt(duration)}</AppText>
            </View>
          </View>
          {/* Painted last, so no layer of the player sits on top of its buttons. */}
          <View style={[styles.videoTop, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
            {headerButtons}
          </View>
        </View>
      ) : (
        /* No footage: an ordinary header row on the screen's own ground. This used
           to be a 128 pt band in a different shade holding only these two buttons,
           which read as a video player that had failed to load. */
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>{headerButtons}</View>
      )}

      {/* Info. On iPhone the Liquid Glass tab bar floats over this screen instead of
          taking space, and inside a tab UIKit's bottom safe area already includes
          it — so the last row pads by that inset or it ends under the glass.
          Android's Material bar reserves its own space (expo-router pads the tab
          scene), while the inset reported here is still the system bar's; adding
          it there would only leave a dead band. */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: hasVideo ? 18 : 6, paddingBottom: 40 + (Platform.OS === 'ios' ? insets.bottom : 0) },
        ]}>
        <AppText style={styles.title}>{t(ex.name)}</AppText>
        <View style={styles.authorRow}>
          <AppText style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, flexShrink: 1 }}>{meta}</AppText>
          {ex.isCompound ? (
            <View style={styles.compoundTag}>
              <AppText style={{ color: palette.inkText, fontSize: 10.5, fontWeight: '700' }}>{t('ƏSAS')}</AppText>
            </View>
          ) : null}
        </View>

        {/* Both sections are empty for a move the program's author wrote
            themselves; a heading over nothing looked like content failing to load. */}
        {ex.commonMistake ? (
          <View style={styles.mistakeCard}>
            <Icon name="shield" size={18} color={palette.streak} />
            <View style={{ flex: 1 }}>
              <AppText style={{ color: '#FFB394', fontSize: 13, fontWeight: '600' }}>{t('Ən çox edilən səhv')}</AppText>
              <AppText style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20, marginTop: 5 }}>{t(ex.commonMistake)}</AppText>
            </View>
          </View>
        ) : null}

        {ex.substitutes.length > 0 ? (
          <>
            <View style={styles.subsHead}>
              <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '600' }}>{t('Əvəzedici hərəkətlər')}</AppText>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              {ex.substitutes.map((s) => (
                <View key={s} style={styles.subCard}>
                  <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{t(s)}</AppText>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.inkText },
  // No footage: a normal header row, same ground as the page — no empty stage.
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 4 },
  video: { height: 380, backgroundColor: '#1A1A20' },
  videoTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // Over footage the scrim keeps the glyph readable on any frame; on the plain
  // ground a scrim is invisible, so the circle takes the dark-screen fill instead.
  circleOnVideo: { backgroundColor: palette.overlay },
  circlePlain: { backgroundColor: dark.fill },
  controls: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  sideCtrl: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(11,11,14,0.4)', alignItems: 'center', justifyContent: 'center' },
  playBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
  pause: { flexDirection: 'row', gap: 6 },
  pauseBar: { width: 5, height: 20, borderRadius: 1.5, backgroundColor: palette.inkText },
  progressWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 14 },
  trackHit: { paddingVertical: 10 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: palette.volt, borderRadius: 2 },
  knob: { position: 'absolute', top: -4, width: 11, height: 11, borderRadius: 6, backgroundColor: palette.volt, marginLeft: -5 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, fontWeight: '500' },
  // paddingTop / paddingBottom are set inline: they depend on the video and the insets.
  content: { paddingHorizontal: 20 },
  title: { color: palette.white, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  compoundTag: { backgroundColor: palette.volt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  mistakeCard: { flexDirection: 'row', gap: 11, backgroundColor: 'rgba(255,107,53,0.14)', borderRadius: 16, padding: 14, marginTop: 16 },
  subsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 11 },
  subCard: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
});
