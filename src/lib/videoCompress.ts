import { requireOptionalNativeModule } from 'expo';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/**
 * Videos leave the phone at 720p H.264, not at whatever the camera recorded.
 *
 * A 60-second phone recording is 100–300 MB (1080p/4K at 15–50 Mbit/s): a long
 * upload on mobile data, a full download for every viewer, and most of a free
 * plan's monthly egress — for a technique demo whose point (bar path, joints)
 * reads perfectly at 720p, where the same minute is ~20 MB.
 *
 *   · iOS: the picker transcodes itself (`videoExportPreset`, both the library
 *     and the camera) — no native code of ours.
 *   · Android: the picker cannot, so `modules/spot-video-compress` re-encodes
 *     with Media3 Transformer right after the pick.
 *
 * Compression is an optimisation, never a gate: if it is unavailable or fails,
 * the original file goes on exactly as it did before, and the size limits still
 * apply to whatever is uploaded.
 */

/** Spread into every video `launchImageLibraryAsync` / `launchCameraAsync`. */
export const VIDEO_PICKER_OPTIONS = {
  mediaTypes: ['videos'] as ImagePicker.MediaType[],
  quality: 0.8,
  videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
};

const SHORT_SIDE = 720;
const BITRATE = 2_500_000;

type Native = {
  compressAsync(uri: string, shortSide: number, bitrate: number): Promise<{ uri: string; size: number }>;
};
// Android only (expo-module.config.json); null on iOS, where nothing is needed.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('SpotVideoCompress') : null;

/** True when `prepareVideo` will actually re-encode — the caller shows a spinner. */
export const compressesOnDevice = !!native;

/** The asset to upload: the 720p copy when one can be made, otherwise the original. */
export async function prepareVideo(asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> {
  if (!native) return asset;
  // Already small (or already 720p): re-encoding would only cost time and quality.
  const short = Math.min(asset.width || 0, asset.height || 0);
  if (short > 0 && short <= SHORT_SIDE && (asset.fileSize ?? Infinity) <= 25 * 1024 * 1024) return asset;
  try {
    const out = await native.compressAsync(asset.uri, SHORT_SIDE, BITRATE);
    // A «compressed» file that came out bigger (a clip that was already lean) is
    // not an improvement.
    if (!out?.uri || (asset.fileSize != null && out.size >= asset.fileSize)) return asset;
    return { ...asset, uri: out.uri, fileSize: out.size, mimeType: 'video/mp4' };
  } catch {
    return asset;
  }
}
