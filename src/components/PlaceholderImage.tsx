import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { Icon, IconName } from './Icon';

/** Photo stub — a soft gradient block with a faint icon. Real images drop in later. */
export function PlaceholderImage({
  height = 132,
  icon = 'cam',
  children,
  style,
  colors = ['#D6D6DC', '#EDEDF0'],
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
        <Icon name={icon} size={30} color="rgba(11,11,14,0.14)" />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
