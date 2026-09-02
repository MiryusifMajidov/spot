import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/theme';
import { AppText } from './AppText';

/**
 * Avatar — a real photo when `uri` is given, otherwise a deterministic gradient
 * disc with initials. The gradient stays underneath the photo so a slow or
 * broken image never flashes an empty hole.
 */
export function Avatar({ name, size = 44, uri }: { name: string; size?: number; uri?: string | null }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const pair = GRADIENTS[hash(name) % GRADIENTS.length];

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <LinearGradient colors={pair} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <AppText style={{ color: palette.white, fontWeight: '700', fontSize: size * 0.36 }}>{initials}</AppText>
        </View>
      )}
    </View>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const GRADIENTS: [string, string][] = [
  ['#8E9EAB', '#636B72'],
  ['#B8C0C8', '#8A929B'],
  ['#A3A7B0', '#6E7480'],
  ['#9BA8B4', '#6B7885'],
  ['#AEB6BD', '#7C848C'],
];

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
