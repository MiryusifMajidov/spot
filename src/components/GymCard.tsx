import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Gym } from '@/data/types';
import { useAppStore } from '@/store/appStore';
import { palette, radius, shadow } from '@/theme';
import { AppText } from './ui/AppText';
import { PressableScale } from './ui/PressableScale';
import { Tag } from './ui/Tag';
import { Icon } from './Icon';
import { GymImage } from './GymImage';

export function GymCard({ gym, variant = 'hero', onPress }: { gym: Gym; variant?: 'hero' | 'compact'; onPress?: () => void }) {
  const bookmarks = useAppStore((s) => s.bookmarks);
  const toggle = useAppStore((s) => s.toggleBookmark);
  const saved = bookmarks.includes(gym.id);

  if (variant === 'compact') {
    return (
      <PressableScale onPress={onPress} activeScale={0.98} style={[styles.card, shadow.card as object]}>
        <Cover gym={gym} height={110} />
        <View style={styles.bodySm}>
          <View style={styles.rowBetween}>
            <View style={styles.nameRow}>
              <AppText variant="title3">{gym.name}</AppText>
              {gym.verified && <Icon name="verified" size={15} color={palette.blue} />}
            </View>
            <Price value={gym.priceMonth} />
          </View>
          <AppText variant="footnote" color={palette.caption} style={{ marginTop: 5 }}>
            {[gym.district, gym.distanceKm > 0 ? `${gym.distanceKm} km` : null, gym.hours].filter(Boolean).join(" · ")}
          </AppText>
        </View>
      </PressableScale>
    );
  }

  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={[styles.card, shadow.card as object]}>
      <Cover gym={gym} height={132}>
        {/* A zero is "hələ məlum deyil", not a fact — the badge is dropped entirely. */}
        {gym.rating > 0 || gym.liveCount > 0 ? (
          <View style={styles.badgeRow}>
            {gym.rating > 0 ? (
              <BlurView intensity={30} tint="dark" style={styles.ratingBadge}>
                <Icon name="star" size={11} color={palette.volt} />
                <AppText style={styles.ratingText}>{gym.rating}</AppText>
              </BlurView>
            ) : null}
            {gym.liveCount > 0 ? (
              <View style={styles.liveBadge}>
                <AppText style={styles.liveText}>{gym.liveCount} nəfər burada</AppText>
              </View>
            ) : null}
          </View>
        ) : null}
        <PressableScale
          haptic
          onPress={() => toggle(gym.id)}
          style={styles.bookmark}>
          <Icon name="bookmark" size={17} color={saved ? palette.volt : palette.white} />
        </PressableScale>
      </Cover>

      <View style={styles.body}>
        <View style={styles.rowBetween}>
          <View style={styles.nameRow}>
            <AppText variant="title3">{gym.name}</AppText>
            {gym.verified && <Icon name="verified" size={15} color={palette.blue} />}
          </View>
          <Price value={gym.priceMonth} />
        </View>
        <AppText variant="footnote" color={palette.caption} style={{ marginTop: 5 }}>
          {[gym.district, gym.distanceKm > 0 ? `${gym.distanceKm} km` : null, gym.hours, gym.members > 0 ? `${gym.members} üzv` : null]
            .filter(Boolean)
            .join(" · ")}
        </AppText>
        <View style={styles.tags}>
          {gym.tags.map((t) => (
            <Tag key={t} label={t} />
          ))}
        </View>
      </View>
    </PressableScale>
  );
}

/**
 * Cover photo: the gym's real image when it has one, otherwise the branded
 * gradient placeholder. A scrim keeps the overlay badges readable on a photo.
 */
function Cover({ gym, height, children }: { gym: Gym; height: number; children?: ReactNode }) {
  if (!gym.imageUrl) {
    return (
      <GymImage name={gym.name} height={height}>
        {children}
      </GymImage>
    );
  }
  return (
    <View style={{ height, backgroundColor: palette.element }}>
      <Image source={{ uri: gym.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      {children ? <LinearGradient colors={['rgba(11,11,14,0.35)', 'transparent']} style={styles.scrim} /> : null}
      {children}
    </View>
  );
}

/* A blank price is an ABSENCE, not «free».
   `create-gym.tsx` does not require the price fields and coerces a blank to zero
   (`Number(priceMonth) || 0`), so a gym owner who prices per quarter and left
   «Aylıq (₼)» empty was advertised at «0 ₼/ay» next to gyms at 45 and 60 — read
   by every new user as free membership. Nobody measured a zero here. */
function Price({ value }: { value: number }) {
  if (!value || value <= 0) {
    return (
      <AppText style={{ fontSize: 12, color: palette.caption }}>Qiymət göstərilməyib</AppText>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <AppText style={{ fontSize: 16, fontWeight: '700', color: palette.inkText }}>{value} ₼</AppText>
      <AppText style={{ fontSize: 12, color: palette.caption }}>/ay</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.white, borderRadius: radius.cardLg, overflow: 'hidden' },
  body: { padding: 16 },
  bodySm: { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 15 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeRow: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', gap: 6 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, overflow: 'hidden' },
  ratingText: { color: palette.white, fontSize: 11.5, fontWeight: '600' },
  liveBadge: { backgroundColor: 'rgba(198,255,61,0.92)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, justifyContent: 'center' },
  liveText: { color: palette.inkText, fontSize: 11.5, fontWeight: '600' },
  bookmark: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(11,11,14,0.55)', alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', gap: 6, marginTop: 11, flexWrap: 'wrap' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, height: '52%' },
});
