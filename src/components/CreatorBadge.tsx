import { StyleSheet, View } from 'react-native';

import { CreatorType } from '@/data/types';
import { palette } from '@/theme';
import { Avatar } from './ui/Avatar';
import { AppText } from './ui/AppText';
import { Icon } from './Icon';

/** Shows who authored a program — never hidden.
 *  The label must match reality: "Doğrulanmış müəllim" is claimed ONLY when the
 *  trainer is actually verified (it used to appear for every trainer-authored
 *  program), and a SPOT starter plan says so instead of borrowing a person. */
export function CreatorBadge({
  name,
  type,
  verified,
  avatarSize = 20,
}: {
  name: string;
  type: CreatorType;
  verified: boolean;
  avatarSize?: number;
}) {
  const tag =
    type === 'spot'
      ? { label: 'SPOT proqramı', color: palette.textSecondary, bg: palette.element }
      : type === 'trainer'
        ? verified
          ? { label: 'Doğrulanmış müəllim', color: palette.blue, bg: 'rgba(10,132,255,0.12)' }
          : { label: 'Müəllim', color: palette.textSecondary, bg: palette.element }
        : { label: 'İstifadəçi', color: palette.textSecondary, bg: palette.element };

  return (
    <View style={styles.row}>
      <Avatar name={name} size={avatarSize} />
      <AppText style={styles.name}>{name}</AppText>
      {verified && type !== 'spot' && <Icon name="verified" size={13} color={palette.blue} />}
      <View style={[styles.tag, { backgroundColor: tag.bg }]}>
        <AppText style={[styles.tagText, { color: tag.color }]}>{tag.label}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 12.5, fontWeight: '500', color: palette.inkText },
  tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 10.5, fontWeight: '600' },
});
