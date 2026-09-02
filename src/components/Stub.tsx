import { StyleSheet, View } from 'react-native';

import { Icon, IconName } from './Icon';
import { AppText } from './ui/AppText';
import { LargeHeader } from './ui/LargeHeader';
import { Screen } from './ui/Screen';
import { palette, spacing } from '@/theme';

/** Temporary branded placeholder for tabs still under construction. */
export function Stub({ title, note, icon }: { title: string; note: string; icon: IconName }) {
  return (
    <Screen>
      <LargeHeader title={title} />
      <View style={styles.center}>
        <View style={styles.badge}>
          <Icon name={icon} size={30} color={palette.voltDeep} />
        </View>
        <AppText variant="headline" style={{ marginTop: 16 }}>
          Tezliklə
        </AppText>
        <AppText variant="body" color={palette.textSecondary} center style={{ marginTop: 6, maxWidth: 260 }}>
          {note}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.screen, paddingBottom: 80 },
  badge: { width: 68, height: 68, borderRadius: 22, backgroundColor: 'rgba(198,255,61,0.22)', alignItems: 'center', justifyContent: 'center' },
});
