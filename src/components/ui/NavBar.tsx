import { useRouter } from 'expo-router';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette, spacing } from '@/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';
import { Icon } from '../Icon';

/** Compact top nav bar with a back chevron, optional inline title, and right actions. */
export function NavBar({ title, right, onBack }: { title?: string; right?: ReactNode; onBack?: () => void }) {
  const router = useRouter();
  return (
    <View style={styles.bar}>
      <PressableScale activeScale={0.9} onPress={onBack ?? (() => router.back())} style={styles.back}>
        <Icon name="chevL" size={26} color={palette.blue} />
      </PressableScale>
      {title ? (
        <AppText variant="headline" numberOfLines={1} style={styles.title}>
          {title}
        </AppText>
      ) : (
        <View style={styles.title} />
      )}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, gap: 8 },
  back: { width: 32, height: 32, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
  right: { minWidth: 32, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14 },
});
