import { useEvent } from 'expo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Dimensions, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { PressableScale } from '@/components/ui/PressableScale';
import { exerciseById, exerciseLibrary } from '@/store/db';
import { dark, palette } from '@/theme';

const { width } = Dimensions.get('window');

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export default function ExerciseVideo() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const ex = (id ? exerciseById(id) : null) ?? exerciseLibrary[0];

  const [playing, setPlaying] = useState(true);
  const [half, setHalf] = useState(false);
  const [muted, setMuted] = useState(true);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  /* No exercise in the library carries footage yet. Rendering the player anyway
     produced a black rectangle with a play button, a 0.5x control and a scrubber
     — a full video UI in front of nothing. The screen is still worth opening for
     the target sets/reps, the most common mistake and the substitutes, so those
     stay; only the pretend player goes. */
  const hasVideo = !!ex.videoUrl;
  const player = useVideoPlayer(hasVideo ? ex.videoUrl : null, (p) => {
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
  useEffect(() => {
    player.playbackRate = half ? 0.5 : 1;
  }, [half, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

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

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {/* Video — or, when there is none, just the header over a plain ground. */}
      <View style={hasVideo ? styles.video : styles.videoEmpty}>
        {hasVideo ? (
          <VideoView player={player} contentFit="contain" nativeControls={false} surfaceType="textureView" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[styles.videoTop, { paddingTop: insets.top + 4 }]}>
          <PressableScale activeScale={0.9} onPress={() => router.back()} style={styles.circle}>
            <Icon name="x" size={18} color={palette.white} />
          </PressableScale>
          <PressableScale
            activeScale={0.9}
            onPress={() => Share.share({ message: `${ex.name} — düzgün texnika. SPOT-da bax.` }).catch(() => {})}
            style={styles.circle}>
            <Icon name="share" size={17} color={palette.white} />
          </PressableScale>
        </View>
        {hasVideo ? (
        <View style={styles.controls}>
          <PressableScale activeScale={0.9} onPress={() => setHalf((h) => !h)} style={[styles.sideCtrl, half && { backgroundColor: palette.volt }]}>
            <AppText style={{ fontSize: 12, fontWeight: '600', color: half ? palette.inkText : palette.white }}>0.5x</AppText>
          </PressableScale>
          <PressableScale activeScale={0.9} onPress={() => setPlaying((p) => !p)} style={styles.playBig}>
            <Icon name={playing ? 'timer' : 'play'} size={26} color={palette.inkText} />
          </PressableScale>
          <PressableScale activeScale={0.9} onPress={() => setMuted((m) => !m)} style={[styles.sideCtrl, !muted && { backgroundColor: palette.volt }]}>
            <Icon name={muted ? 'mute' : 'sound'} size={18} color={muted ? palette.white : palette.inkText} />
          </PressableScale>
        </View>
        ) : null}
        {hasVideo ? (
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
        ) : null}
      </View>

      {/* Info */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <AppText style={styles.title}>{ex.name}</AppText>
        <View style={styles.authorRow}>
          <AppText style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5 }}>
            {ex.muscle} · {ex.equipment} · {ex.defaultSets} set × {ex.reps}
          </AppText>
          {ex.isCompound ? (
            <View style={styles.compoundTag}>
              <AppText style={{ color: palette.inkText, fontSize: 10.5, fontWeight: '700' }}>ƏSAS</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.mistakeCard}>
          <Icon name="shield" size={18} color={palette.streak} />
          <View style={{ flex: 1 }}>
            <AppText style={{ color: '#FFB394', fontSize: 13, fontWeight: '600' }}>Ən çox edilən səhv</AppText>
            <AppText style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 20, marginTop: 5 }}>{ex.commonMistake}</AppText>
          </View>
        </View>

        <View style={styles.subsHead}>
          <AppText style={{ color: palette.white, fontSize: 15, fontWeight: '600' }}>Əvəzedici hərəkətlər</AppText>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {ex.substitutes.map((s) => (
            <View key={s} style={styles.subCard}>
              <AppText style={{ color: palette.white, fontSize: 13, fontWeight: '600' }}>{s}</AppText>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // No footage: a short header band instead of a tall empty video frame.
  videoEmpty: { height: 128, backgroundColor: '#17171C' },
  root: { flex: 1, backgroundColor: palette.inkText },
  video: { height: 380, backgroundColor: '#1A1A20' },
  videoTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,11,14,0.5)', alignItems: 'center', justifyContent: 'center' },
  controls: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  sideCtrl: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(11,11,14,0.4)', alignItems: 'center', justifyContent: 'center' },
  playBig: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
  progressWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 14 },
  trackHit: { paddingVertical: 10 },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: palette.volt, borderRadius: 2 },
  knob: { position: 'absolute', top: -4, width: 11, height: 11, borderRadius: 6, backgroundColor: palette.volt, marginLeft: -5 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  time: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, fontWeight: '500' },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 40 },
  title: { color: palette.white, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  compoundTag: { backgroundColor: palette.volt, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  mistakeCard: { flexDirection: 'row', gap: 11, backgroundColor: 'rgba(255,107,53,0.14)', borderRadius: 16, padding: 14, marginTop: 16 },
  subsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 11 },
  subCard: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
});
