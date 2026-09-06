import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { useVideoPoster } from '@/lib/videoPoster';

/**
 * The background of a video tile: a real frame from the clip when the device has
 * one, and the video's gradient until then.
 *
 * Every grid in the app — the profile, the creator's page, the saved shelf —
 * used to draw only the gradient, so six clips were six near-identical
 * rectangles and the caption was the only way to tell them apart.
 *
 * The frame is generated on the device and kept in expo-image's disk cache; see
 * lib/videoPoster for why it is not stored on the server. A video whose frame
 * cannot be read keeps the gradient rather than showing a broken image.
 */
export function VideoPoster({
  id,
  videoUrl,
  gradient,
  start = { x: 0.2, y: 0 },
  end = { x: 0.8, y: 1 },
}: {
  id: string;
  videoUrl: string;
  gradient: [string, string];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}) {
  const poster = useVideoPoster(id, videoUrl);
  return (
    <>
      <LinearGradient colors={gradient} start={start} end={end} style={StyleSheet.absoluteFill} />
      {poster ? <Image source={poster} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} /> : null}
    </>
  );
}
