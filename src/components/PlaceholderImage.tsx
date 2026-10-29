import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { palette } from '@/theme';
import { Icon, IconName } from './Icon';

/** Photo stub — a soft gradient block with a faint icon. Real images drop in later. */
export function PlaceholderImage({
  height = 132,
  icon = 'cam',
  children,
  style,
  colors = [palette.stubFrom, palette.stubTo],
}: {
  height?: number;
  icon?: IconName;
  children?: ReactNode;
  style?: ViewStyle;
  colors?: [string, string];
}) {
  return (
    <View style={[{ height }, style]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Icon name={icon} size={30} color={palette.stubGlyph} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
