import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { setAvatarPeek, useAvatarUrl } from '@/lib/avatars';
import { tapFeedback } from '@/lib/feedback';
import { t } from '@/lib/i18n';
import { palette } from '@/theme';
import { AppText } from './AppText';

/**
 * Avatar — a real photo when `uri` is given, otherwise a deterministic gradient
 * disc with initials. The gradient stays underneath the photo so a slow or
 * broken image never flashes an empty hole.
 *
 * `profileId`: the photo is looked up by profile when the caller has only the
 * person, not the URL (lib/avatars.ts). `peek`: press and hold shows the photo
 * large, release puts it away — Instagram's gesture. Only where the avatar is
 * not itself inside something tappable: a held avatar takes the touch.
 */
export function Avatar({
  name,
  size = 44,
  uri,
  profileId,
  peek,
}: {
  name: string;
  size?: number;
  uri?: string | null;
  profileId?: string | null;
  peek?: boolean;
}) {
  const looked = useAvatarUrl(uri ? null : profileId);
  const photo = uri || looked;
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const pair = GRADIENTS[hash(name) % GRADIENTS.length];

  const disc = (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
      <LinearGradient colors={pair} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {photo ? (
        <Image source={{ uri: photo }} recyclingKey={photo} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <AppText style={{ color: palette.onDark, fontWeight: '700', fontSize: size * 0.36 }}>{initials}</AppText>
        </View>
      )}
    </View>
  );

  if (!peek || !photo) return disc;
  return (
    <Pressable
      delayLongPress={220}
      onLongPress={() => {
        tapFeedback();
        setAvatarPeek({ uri: photo, name });
      }}
      onPressOut={() => setAvatarPeek(null)}
      accessibilityRole="imagebutton"
      accessibilityLabel={name}
      accessibilityHint={t('Böyütmək üçün basıb saxla')}>
      {disc}
    </Pressable>
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
