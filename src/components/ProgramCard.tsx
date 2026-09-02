import { StyleSheet, View } from 'react-native';

import { Program } from '@/data/types';
import { palette, radius, shadow } from '@/theme';
import { CreatorBadge } from './CreatorBadge';
import { Icon } from './Icon';
import { PlaceholderImage } from './PlaceholderImage';
import { AppText } from './ui/AppText';
import { PressableScale } from './ui/PressableScale';

function PriceOrFree({ program }: { program: Program }) {
  if (program.paid && program.price) {
    return (
      <View style={[styles.cornerBadge, { backgroundColor: palette.ink }]}>
        <AppText style={{ fontSize: 10.5, fontWeight: '700', color: palette.volt }}>{program.price} ₼</AppText>
      </View>
    );
  }
  return (
    <View style={[styles.cornerBadge, { backgroundColor: palette.volt }]}>
      <AppText style={{ fontSize: 10.5, fontWeight: '700', color: palette.inkText }}>PULSUZ</AppText>
    </View>
  );
}

/** Program card — featured (large) or row (compact). Creator is always visible.
 *
 *  No image slot. A `Program` has no cover image field at all, so the grey
 *  "video" block these cards used to open with was a placeholder for content
 *  that could never arrive — it just told every reader a video was missing. */
export function ProgramCard({ program, variant = 'row', onPress }: { program: Program; variant?: 'featured' | 'row'; onPress?: () => void }) {
  if (variant === 'featured') {
    return (
      <PressableScale onPress={onPress} activeScale={0.98} style={[styles.card, shadow.card as object]}>
        <View style={{ padding: 16 }}>
          <View style={styles.featuredTop}>
            <AppText variant="title3" style={{ flex: 1 }}>
              {program.title}
            </AppText>
            <PriceOrFree program={program} />
          </View>
          <View style={{ marginTop: 9 }}>
            <CreatorBadge name={program.creatorName} type={program.creatorType} verified={program.creatorVerified} avatarSize={24} />
          </View>
          <Meta program={program} />
        </View>
      </PressableScale>
    );
  }

  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={[styles.rowCard, shadow.card as object]}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <AppText variant="headline" style={{ flex: 1 }}>
            {program.title}
          </AppText>
          {program.paid && program.price ? (
            <View style={[styles.cornerBadge, { backgroundColor: palette.ink, position: 'relative', top: 0, left: 0 }]}>
              <AppText style={{ fontSize: 10.5, fontWeight: '700', color: palette.volt }}>{program.price} ₼</AppText>
            </View>
          ) : null}
        </View>
        <View style={{ marginTop: 8 }}>
          <CreatorBadge name={program.creatorName} type={program.creatorType} verified={program.creatorVerified} />
        </View>
        <Meta program={program} compact />
      </View>
    </PressableScale>
  );
}

/** A zero here means "nobody has rated or run this yet" — never a measured 0.
 *  Printing «★ 0 · 0 nəfər edir» would state a fact the app never obtained, so
 *  each figure appears only once it is real, and the plan's own properties
 *  (days/week, minutes) carry the row on their own. */
function Meta({ program, compact }: { program: Program; compact?: boolean }) {
  /* The real number of days the program defines, not the number it advertises.
     «Push Pull Legs» claimed 6 gün/həftə on the card while the detail screen
     listed 3 — the card was quoting a seed field the content does not back up. */
  const days = program.days?.length || program.daysPerWeek;
  const parts = [
    `${days} gün/həftə`,
    `${program.minutes} dəq`,
    program.doneBy > 0 ? `${program.doneBy} nəfər edir` : null,
  ].filter(Boolean);

  return (
    <View style={[styles.meta, { marginTop: compact ? 8 : 11 }]}>
      {program.rating > 0 ? (
        <>
          <Icon name="star" size={12} color={palette.streak} />
          <AppText style={styles.rating}>{program.rating}</AppText>
          <AppText style={styles.metaDim}>· {parts.join(' · ')}</AppText>
        </>
      ) : (
        <AppText style={styles.metaDim}>{parts.join(' · ')}</AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.white, borderRadius: radius.cardLg, overflow: 'hidden' },
  featuredTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowCard: { backgroundColor: palette.white, borderRadius: radius.cardLg, padding: 14, flexDirection: 'row', gap: 13 },
  thumb: { width: 76, height: 76, borderRadius: 14, overflow: 'hidden' },
  topBadge: { position: 'absolute', top: 11, left: 11, backgroundColor: 'rgba(11,11,14,0.72)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  videoCount: { color: palette.white, fontSize: 11, fontWeight: '600' },
  topRight: { position: 'absolute', top: 11, right: 11 },
  cornerBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rating: { fontSize: 12, fontWeight: '600', color: palette.inkText },
  metaDim: { fontSize: 12.5, color: palette.caption },
});
