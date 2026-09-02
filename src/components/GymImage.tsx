import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { Icon, IconName } from './Icon';

/**
 * Branded photo placeholder for gyms — a moody dark gradient (varied per gym)
 * with a faint equipment mark. Reads as a real gym interior until real photos land.
 */
const GRADIENTS: [string, string][] = [
  ['#23262B', '#3B424B'],
  ['#1F2A24', '#33413A'],
  ['#262330', '#3E3846'],
  ['#22272E', '#39434E'],
  ['#2A2622', '#443C34'],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function GymImage({
  name,
  height = 132,
  icon = 'dumbbell',
  children,
  style,
}: {
  name: string;
  height?: number;
  icon?: IconName;
  children?: ReactNode;
  style?: ViewStyle;
}) {
  const pair = GRADIENTS[hash(name) % GRADIENTS.length];
  return (
    <View style={[{ height }, style]}>
      <LinearGradient colors={pair} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Icon name={icon} size={54} color="rgba(255,255,255,0.10)" />
      </View>
      {/* soft top sheen */}
      <LinearGradient colors={['rgba(255,255,255,0.06)', 'transparent']} style={styles.sheen} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  sheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%' },
});
