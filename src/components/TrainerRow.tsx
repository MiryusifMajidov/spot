import { StyleSheet, View } from 'react-native';

import { Trainer } from '@/data/types';
import { palette } from '@/theme';
import { Avatar } from './ui/Avatar';
import { AppText } from './ui/AppText';
import { PressableScale } from './ui/PressableScale';
import { Icon } from './Icon';

/** Trainer list row. Unverified trainers read faded + get an explicit label (transparency, not hiding). */
export function TrainerRow({ trainer, onPress }: { trainer: Trainer; onPress?: () => void }) {
  // A rating of 0 means nobody has rated this trainer yet — an absence, not a score.
  // Same rule as the detail screen: say "new" instead of printing a zero.
  const rating = trainer.rating ?? 0;
  const clients = trainer.clients ?? 0;
  const isNew = rating === 0 && clients === 0;
  const meta = [
    isNew ? 'Yeni müəllim' : clients > 0 ? `${clients} şagird` : null,
    trainer.priceFrom > 0 ? `${trainer.priceFrom} ₼-dən` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={styles.row}>
      <View style={{ opacity: trainer.verified ? 1 : 0.6 }}>
        {/* Real photo when the trainer uploaded one; initials otherwise. */}
        <Avatar name={trainer.name} size={52} uri={trainer.photoUrl} />
      </View>
      <View style={styles.mid}>
        <View style={styles.nameRow}>
          <AppText variant="headline">{trainer.name}</AppText>
          {trainer.verified ? (
            <Icon name="verified" size={15} color={palette.blue} />
          ) : (
            <View style={styles.unverified}>
              <AppText style={styles.unverifiedText}>Doğrulanmayıb</AppText>
            </View>
          )}
        </View>
        <AppText variant="footnote" color={palette.textSecondary} style={{ marginTop: 2 }}>
          {trainer.specialty}
        </AppText>
        <View style={styles.metaRow}>
          {rating > 0 ? (
            <>
              <Icon name="star" size={12} color={palette.volt} />
              <AppText style={styles.meta}>{rating}</AppText>
            </>
          ) : null}
          {meta ? <AppText style={styles.metaDim}>{rating > 0 ? `· ${meta}` : meta}</AppText> : null}
        </View>
      </View>
      <Icon name="chevR" size={18} color={palette.tertiary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  mid: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unverified: { backgroundColor: palette.grouped, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  unverifiedText: { fontSize: 10, fontWeight: '600', color: palette.textSecondary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
  meta: { fontSize: 12.5, fontWeight: '600', color: palette.inkText },
  metaDim: { fontSize: 12.5, color: palette.caption },
});
