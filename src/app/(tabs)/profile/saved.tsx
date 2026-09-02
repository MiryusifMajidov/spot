import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { GymCard } from '@/components/GymCard';
import { Icon } from '@/components/Icon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { NavBar } from '@/components/ui/NavBar';
import { PressableScale } from '@/components/ui/PressableScale';
import { Screen } from '@/components/ui/Screen';
import { Segmented } from '@/components/ui/Segmented';
import { useFeedVideos, useGyms } from '@/lib/hooks';
import { useAppStore } from '@/store/appStore';
import { palette, spacing } from '@/theme';

/** Everything the user actually saved — the feed's "Saxla" rail and the gym bookmark
 *  both wrote here; until now nothing displayed them. No placeholders: an empty list
 *  says so and points at where saving happens. */
export default function Saved() {
  const router = useRouter();
  const [seg, setSeg] = useState(0);
  const savedVideos = useAppStore((s) => s.savedVideos);
  const bookmarks = useAppStore((s) => s.bookmarks);
  const videos = useFeedVideos().filter((v) => savedVideos.includes(v.id));
  const gyms = useGyms().filter((g) => bookmarks.includes(g.id));

  return (
    <Screen edges={['top']}>
      <NavBar title="Saxlanılanlar" />
      <View style={{ paddingHorizontal: spacing.screen, paddingBottom: 12 }}>
        <Segmented options={['Videolar', 'Zallar']} value={seg} onChange={setSeg} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {seg === 0 ? (
          videos.length === 0 ? (
            <Empty
              icon="bookmark"
              title="Saxlanılmış video yoxdur"
              text="Feed-də videonun yanındakı 'Saxla' düyməsinə toxun — burada toplanacaq."
              action={<Button title="Feed-ə keç" onPress={() => router.push('/(tabs)/feed')} style={{ marginTop: 18 }} />}
            />
          ) : (
            <View style={styles.grid}>
              {videos.map((v) => (
                <PressableScale
                  key={v.id}
                  activeScale={0.97}
                  onPress={() => router.push({ pathname: '/(tabs)/feed/creator', params: { name: v.author, verified: v.verified ? '1' : '', isTrainer: v.isTrainer ? '1' : '' } })}
                  style={styles.tile}>
                  <LinearGradient colors={v.gradient} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
                  <View style={styles.tilePlay}>
                    <Icon name="play" size={15} color="rgba(255,255,255,0.9)" />
                  </View>
                  <AppText numberOfLines={2} style={styles.tileCaption}>
                    {v.caption}
                  </AppText>
                  <AppText style={styles.tileAuthor}>{v.author}</AppText>
                </PressableScale>
              ))}
            </View>
          )
        ) : gyms.length === 0 ? (
          <Empty
            icon="dumbbell"
            title="Saxlanılmış zal yoxdur"
            text="Zal səhifəsindəki bookmark düyməsi zalı bura əlavə edir."
            action={<Button title="Zallara bax" onPress={() => router.push('/(tabs)/discover')} style={{ marginTop: 18 }} />}
          />
        ) : (
          <View style={{ gap: 12 }}>
            {gyms.map((g) => (
              <GymCard key={g.id} gym={g} variant="compact" onPress={() => router.push({ pathname: '/(tabs)/discover/gym/[id]', params: { id: g.id } })} />
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Empty({ icon, title, text, action }: { icon: 'bookmark' | 'dumbbell'; title: string; text: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Icon name={icon} size={28} color={palette.tertiary} />
      <AppText variant="headline" style={{ marginTop: 12 }}>
        {title}
      </AppText>
      <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, lineHeight: 21, maxWidth: 270 }}>
        {text}
      </AppText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.screen, paddingBottom: 40 },
  empty: { alignItems: 'center', paddingTop: 60 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', height: 190, borderRadius: 14, overflow: 'hidden', justifyContent: 'flex-end', padding: 10 },
  tilePlay: { position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  tileCaption: { color: palette.white, fontSize: 12, fontWeight: '600', lineHeight: 16 },
  tileAuthor: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 4 },
});
