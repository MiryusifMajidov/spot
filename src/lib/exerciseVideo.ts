/**
 * A short clip for ONE exercise inside a program (schema76).
 *
 * This is not the feed. A feed video is a post — it has a caption, an author
 * row, likes and a place in a timeline. This is a demonstration attached to a
 * line in somebody's program: «Skvat, 5 set × 5, and here is how I want you to
 * do it». It goes into the same public `videos` bucket and produces a plain
 * URL, with no `feed_videos` row, so filming a cue for a student does not
 * publish anything to anyone.
 *
 * The 30-second cap is deliberately shorter than the feed's 60: this is a
 * technique cue, and a coach writing eight of them for one day should not be
 * uploading eight minutes of video over a phone connection.
 */
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

/** The videos bucket's own ceiling (schema33), refused before a long upload. */
export const CLIP_MAX_BYTES = 100 * 1024 * 1024;
export const CLIP_MAX_SECONDS = 30;

/** What the picker hands back. Re-exported so callers do not have to import
 *  expo-image-picker only to name the type of a callback. */
export type PickedAsset = ImagePicker.ImagePickerAsset;

/** Why a picked file cannot be used, in Azerbaijani — or null when it can. */
export function clipProblem(a: PickedAsset): string | null {
  /* Read from the PICKER's metadata, before the file is opened. The upload
     path does `fetch(uri).arrayBuffer()`, which pulls the whole clip into JS
     memory — a 4K recording is 200 MB+ and that is how the app dies mid-upload.
     `videoMaxDuration` only trims what the picker RECORDS, so a file chosen
     from the gallery has to be measured here as well. */
  const secs = a.duration != null ? Math.round(a.duration / 1000) : null;
  if (secs != null && secs > CLIP_MAX_SECONDS) {
    return `Video ${secs} saniyədir — ${CLIP_MAX_SECONDS} saniyəyə qədər olmalıdır. Qısaldıb yenidən seç.`;
  }
  if (a.fileSize != null && a.fileSize > CLIP_MAX_BYTES) {
    // One decimal, comma-separated: a 100,4 MB clip rounded to whole MB reads as
    // the app refusing a file that fits.
    return `Video ${(a.fileSize / 1048576).toFixed(1).replace('.', ',')} MB-dır — ${Math.round(
      CLIP_MAX_BYTES / 1048576
    )} MB-a qədər qəbul olunur.`;
  }
  return null;
}

export async function pickClipFromLibrary(): Promise<PickedAsset | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    quality: 0.8,
    videoMaxDuration: CLIP_MAX_SECONDS,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return res.assets[0];
}

/** Records one. Returns null when permission was refused — the caller says so. */
export async function recordClip(): Promise<PickedAsset | null | 'no-permission'> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return 'no-permission';
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    quality: 0.8,
    videoMaxDuration: CLIP_MAX_SECONDS,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return res.assets[0];
}

/**
 * Upload the clip and return its public URL. Throws on failure — the caller
 * must not save a program row claiming a video that never landed.
 */
export async function uploadExerciseClip(uri: string, sizeHint?: number | null): Promise<string> {
  const path = `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.mp4`;

  const res = await fetch(uri);
  if (!res.ok) throw new Error('video-read-failed');
  const blob = await res.blob();
  const bytes = blob.size || sizeHint || 0;
  if (bytes > CLIP_MAX_BYTES) {
    const err = new Error('video-too-large') as Error & { sizeBytes: number };
    err.sizeBytes = bytes;
    throw err;
  }

  const buffer = await new Response(blob).arrayBuffer();
  const { error } = await supabase.storage.from('videos').upload(path, buffer, {
    contentType: 'video/mp4',
    upsert: true,
  });
  if (error) throw error;

  return supabase.storage.from('videos').getPublicUrl(path).data.publicUrl;
}
