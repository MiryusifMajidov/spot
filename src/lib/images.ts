/**
 * Picking and uploading images (avatars, trainer photos, gym galleries).
 *
 * Every function is honest about failure: nothing here silently pretends an
 * upload happened, and a denied OS permission is said out loud instead of leaving
 * the button dead. Requires supabase/schema8_photos_location.sql (the public
 * `avatars` / `gyms` buckets + the url columns) and a migration creating the
 * PRIVATE `certs` bucket for trainer verification evidence.
 */
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { toast } from '@/store/ui';
import { getMyProfile } from './api';
import { supabase } from './supabase';
import { invalidateFocusCache, invalidateFocusPrefix } from './focusFetch';

/** `certs` holds verification evidence (diplomas, ID photos). It is PRIVATE —
 *  see the storage migration — and is never read through getPublicUrl. */
export type Bucket = 'avatars' | 'gyms';
export const CERT_BUCKET = 'certs';
export type UploadBucket = Bucket | typeof CERT_BUCKET;

/**
 * What Storage will actually accept, per bucket — schema33, re-read from
 * `storage.buckets` on 2026-09-09 (avatars 5 MB, gyms 10 MB, certs 10 MB).
 *
 * These have to be checked on the phone, because the server only answers AFTER
 * the whole file has been sent: a normal 48 MP photo is 8 MB, so picking one for
 * an avatar spent 8 MB of the person's mobile data and came back as a 413 that
 * the caller could only report as «yenidən cəhd et». Tapping again spent it
 * again. Nothing ever said the file was too big.
 */
export const BUCKET_MAX_BYTES: Record<UploadBucket, number> = {
  avatars: 5 * 1024 * 1024,
  gyms: 10 * 1024 * 1024,
  certs: 10 * 1024 * 1024,
};

/**
 * Which ceiling a pick has to clear.
 *
 * Every SQUARE pick in the app is a face for the 5 MB `avatars` bucket
 * (profile/edit, become-trainer → setMyAvatar / setTrainerPhoto); every other one
 * goes to a 10 MB bucket (`gyms`, `certs`). A caller that breaks that pairing
 * must pass `maxBytes` itself — otherwise it would be told the wrong limit.
 */
const pickLimit = (opts?: { square?: boolean; maxBytes?: number }) =>
  opts?.maxBytes ?? (opts?.square ? BUCKET_MAX_BYTES.avatars : BUCKET_MAX_BYTES.gyms);

/** «5,4» — the decimal separator in Azerbaijani is a comma. Rounded to whole MB a
 *  5,4 MB file reads as «5 MB-dır — 5 MB-a qədər qəbul olunur», which looks like
 *  the app refusing a file that fits. */
const mbText = (bytes: number) => (bytes / 1048576).toFixed(1).replace('.', ',');

const limitText = (bytes: number, limit: number) =>
  `Şəkil ${mbText(bytes)} MB-dır — ${Math.round(limit / 1048576)} MB-a qədər qəbul olunur. Daha kiçik şəkil seç.`;

/**
 * The long edge every picked photo is brought down to before it leaves the phone.
 *
 * Nothing in SPOT ever draws an uploaded photo bigger than a full-width gym cover,
 * and an avatar is 36 px on the partner card. The picker hands back whatever the
 * camera shot: a current phone writes a 48 MP, 8–12 MB file, and the app pushed
 * every one of those bytes over mobile data so it could be shown as a thumbnail —
 * slow, expensive, and for the largest files refused by the bucket ceiling only
 * AFTER the data had already been spent.
 */
const MAX_EDGE = 1024;

/**
 * Shrink to MAX_EDGE on the long edge and re-encode as JPEG (~0.8).
 *
 * Only ever shrinks: `resize` would happily ENLARGE a small photo, which costs
 * bytes and adds no detail. A failure here returns the ORIGINAL uri — losing the
 * person's photo because an optimisation did not run would be a far worse bug
 * than uploading it whole, and the ceiling checks below still catch what is
 * genuinely too big.
 */
async function downscale(uri: string, width: number, height: number): Promise<string> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (Math.max(width, height) > MAX_EDGE) {
      // One dimension only — the manipulator derives the other and keeps the ratio.
      ctx.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
    }
    const rendered = await ctx.renderAsync();
    const out = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    return out.uri;
  } catch {
    return uri;
  }
}

/** Bytes of a local file, or null when it cannot be read (a `content://` pick on
 *  Android never opens as a File). Needed because the picker's `fileSize`
 *  describes the ORIGINAL image, not the one we are about to send. */
function localBytes(uri: string): number | null {
  try {
    const f = new File(uri);
    return f.exists ? f.size : null;
  } catch {
    return null;
  }
}

/**
 * Downscale the pick, then hold the RESULT to the bucket's ceiling.
 *
 * Returns null (exactly what a cancel returns, so the caller stays quiet and the
 * message below is what the user sees) when the file is still too big. Measuring
 * the file we actually produced matters: `quality: 0.8` does not bound the
 * picker's output — the SDK 57 docs say it is ignored outright for a .png chosen
 * from the library on iOS — and judging the resized file by `asset.fileSize`
 * would refuse a photo the resize had already made small enough.
 */
async function prepare(asset: ImagePicker.ImagePickerAsset, limit: number): Promise<string | null> {
  const uri = await downscale(asset.uri, asset.width, asset.height);
  const bytes = localBytes(uri) ?? (uri === asset.uri ? (asset.fileSize ?? null) : null);
  if (bytes != null && bytes > limit) {
    toast(limitText(bytes, limit), 'error');
    return null;
  }
  return uri;
}

/**
 * The message for the ONE upload failure that retrying can never fix, or null for
 * every other error so the caller keeps its own «yenidən cəhd et».
 *
 * uploadToBucket throws this when the file cleared the pick check only because the
 * picker never reported a size. Every caller used to report it as «Şəkil yüklənmədi
 * — yenidən cəhd et», which sends somebody to tap again at a wall: the same file is
 * over the same ceiling every single time, and nothing on screen ever said so.
 */
export function imageTooLargeMessage(e: unknown): string | null {
  if (!(e instanceof Error) || e.message !== 'image-too-large') return null;
  const { sizeBytes, maxBytes } = e as Error & { sizeBytes?: number; maxBytes?: number };
  const limit = maxBytes ?? BUCKET_MAX_BYTES.avatars;
  if (sizeBytes == null) return `Şəkil çox böyükdür — ${Math.round(limit / 1048576)} MB-a qədər qəbul olunur. Daha kiçik şəkil seç.`;
  return limitText(sizeBytes, limit);
}

/** Open the library and return a local uri, or null if the user cancelled. */
export async function pickImage(opts?: { square?: boolean; maxBytes?: number }): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  // A denied permission used to make the button completely inert — the user could
  // not tell the app from a frozen screen. Say what happened and where to fix it.
  if (!perm.granted) {
    toast('Şəkil üçün icazə verilməyib — cihaz Ayarlarından SPOT-a qalereya icazəsi ver', 'error');
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: opts?.square ? [1, 1] : [4, 3],
    quality: 0.8,
  });
  if (res.canceled || !res.assets?.length) return null;
  // Shrunk (and if need be refused) here, before a byte leaves the phone.
  return prepare(res.assets[0], pickLimit(opts));
}

/** Take a new photo with the camera, or null if cancelled / not permitted. */
export async function shootImage(opts?: { square?: boolean; maxBytes?: number }): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    toast('Kamera üçün icazə verilməyib — cihaz Ayarlarından SPOT-a kamera icazəsi ver', 'error');
    return null;
  }
  const res = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: opts?.square ? [1, 1] : [4, 3],
    quality: 0.8,
  });
  if (res.canceled || !res.assets?.length) return null;
  return prepare(res.assets[0], pickLimit(opts));
}

/** Upload a local image into `bucket` and return the STORAGE PATH. Throws on failure. */
async function uploadToBucket(bucket: UploadBucket, localUri: string, prefix: string): Promise<string> {
  const ext = (localUri.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `${prefix}-${Date.now().toString(36)}.${ext === 'png' || ext === 'webp' ? ext : 'jpg'}`;
  const bytes = await (await fetch(localUri)).arrayBuffer();
  /* Second line of defence, and the exact per-bucket ceiling: the picker does not
     always report `fileSize`, the downscale can fail, and a file that got past the
     pick check would otherwise be pushed over the network only for Storage to
     answer 413. The real numbers ride along on the error — a caller that only
     knows «image-too-large» cannot tell the person how big the file was or what
     fits, and «yenidən cəhd et» is a lie about a file that can never succeed. */
  if (bytes.byteLength > BUCKET_MAX_BYTES[bucket]) {
    const err = new Error('image-too-large') as Error & { sizeBytes: number; maxBytes: number };
    err.sizeBytes = bytes.byteLength;
    err.maxBytes = BUCKET_MAX_BYTES[bucket];
    throw err;
  }
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: type, upsert: true });
  if (error) throw error;
  return path;
}

/** The object path inside `bucket` for one of ITS public URLs, or null when the
 *  url is not one of ours (a legacy row, or a link from somewhere else). */
function objectPath(bucket: UploadBucket, url: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split('?')[0];
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Delete an object that nothing points at any more.
 *
 * The buckets are PUBLIC with an unrestricted read policy, so a file that is only
 * dropped from its column stays fetchable by URL forever: deleting a gallery shot
 * that showed a member's face removed it from the gallery and left the image
 * serving to anyone who had kept the link. schema33 added the owner DELETE policy
 * for exactly this and no code path used it.
 *
 * Storage refuses a delete the same way PostgREST does — `error: null` and an
 * EMPTY list — so the returned rows are what says it happened, not the absence of
 * an error. Best effort by design: the column write is what the caller reports.
 */
async function removeObject(bucket: UploadBucket, url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  const path = objectPath(bucket, url);
  if (!path) return false;
  try {
    const { data, error } = await supabase.storage.from(bucket).remove([path]);
    return !error && !!data?.length;
  } catch {
    return false;
  }
}

/** Upload a local image to a public bucket and return its public URL. Throws on failure. */
export async function uploadImage(bucket: Bucket, localUri: string, prefix: string): Promise<string> {
  const path = await uploadToBucket(bucket, localUri, prefix);
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** A short-lived link to one certificate. Verification evidence lives in a PRIVATE
 *  bucket, so there is no permanent URL — every viewer has to be authorised again.
 *  Returns null when the object (or the bucket) is not reachable. */
export async function signedCertUrl(pathOrUrl: string, ttlSec = 300): Promise<string | null> {
  // Tolerate rows written before the private bucket existed: those hold a full URL.
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const { data, error } = await supabase.storage.from(CERT_BUCKET).createSignedUrl(pathOrUrl, ttlSec);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Pick → upload → write `profiles.avatar_url`. Returns the new URL. */
export async function setMyAvatar(localUri: string): Promise<string> {
  const me = await getMyProfile();
  if (!me) throw new Error('no profile');
  // PROFILE_COLS selects `avatar_url` but the `DbProfile` interface (api.ts) does
  // not declare it, so it is read through a narrow cast rather than left unused.
  const previous = (me as { avatar_url?: string | null }).avatar_url ?? null;
  const url = await uploadImage('avatars', localUri, `p-${me.id}`);
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', me.id);
  if (error) throw error;
  /* Column first, THEN the old object: a failed delete leaves an unreachable
     orphan, while a failed write would have left the row pointing at a file that
     no longer exists. Replacing an avatar used to leave the old face public. */
  if (previous && previous !== url) await removeObject('avatars', previous);
  invalidateFocusPrefix('partners:'); // my card at the gym now has a face
  return url;
}

/** Trainer profile photo (`trainers.photo_url`). */
export async function setTrainerPhoto(trainerId: string, localUri: string): Promise<string> {
  // Read the photo we are about to supersede so it can be deleted afterwards. A
  // failed read only costs us the cleanup, so it must not stop the new photo.
  const { data: before } = await supabase.from('trainers').select('photo_url').eq('id', trainerId).maybeSingle();
  const previous = (before as { photo_url?: string | null } | null)?.photo_url ?? null;
  const url = await uploadImage('avatars', localUri, `t-${trainerId}`);
  const { error } = await supabase.from('trainers').update({ photo_url: url }).eq('id', trainerId);
  if (error) throw error;
  if (previous && previous !== url) await removeObject('avatars', previous);
  invalidateFocusCache('trainers');
  return url;
}

/**
 * Add a certificate image to a trainer's verification evidence.
 *
 * The screen promises «yalnız SPOT komandası görür», so the file MUST NOT go to the
 * public `avatars` bucket — anyone holding the anon key could read `trainers.cert_urls`
 * and open the trainer's diploma or ID over plain HTTP. It goes to the private
 * `certs` bucket and we store the storage PATH, never a public URL; readers get a
 * short-lived link from `signedCertUrl()`.
 *
 * If the migration that creates the bucket has not run yet the upload throws
 * ('Bucket not found') — the caller must show that failure, never a success toast.
 */
export async function addTrainerCert(trainerId: string, localUri: string): Promise<string[]> {
  const path = await uploadToBucket(CERT_BUCKET, localUri, `cert-${trainerId}`);
  // The write below REPLACES the whole array, so it may only be built from a read
  // we actually got. A swallowed read error here would overwrite every diploma and
  // ID already queued for verification with just this one path.
  const { data, error: readErr } = await supabase
    .from('trainers')
    .select('cert_urls')
    .eq('id', trainerId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!data) throw new Error('trainer not found');
  const next = [...(((data as { cert_urls?: string[] | null }).cert_urls) ?? []), path];
  const { error } = await supabase.from('trainers').update({ cert_urls: next }).eq('id', trainerId);
  if (error) throw error;
  return next;
}

/** Gym cover photo (`gyms.image_url`). */
export async function setGymCover(gymId: string, localUri: string): Promise<string> {
  // The cover we are replacing, plus the gallery — the same url can legitimately
  // sit in both, and deleting the object would then blank a photo still listed.
  const { data: before } = await supabase.from('gyms').select('image_url,photos').eq('id', gymId).maybeSingle();
  const prev = before as { image_url?: string | null; photos?: string[] | null } | null;
  const previous = prev?.image_url ?? null;
  const url = await uploadImage('gyms', localUri, `g-${gymId}`);
  const { error } = await supabase.from('gyms').update({ image_url: url }).eq('id', gymId);
  if (error) throw error;
  if (previous && previous !== url && !(prev?.photos ?? []).includes(previous)) {
    await removeObject('gyms', previous);
  }
  invalidateFocusCache('gyms');
  return url;
}

/** Append a photo to the gym gallery (`gyms.photos`). Returns the new list. */
export async function addGymPhoto(gymId: string, localUri: string): Promise<string[]> {
  const url = await uploadImage('gyms', localUri, `g-${gymId}`);
  // Same rule as addTrainerCert: never write a derived array from a read we did
  // not verify — a failed read would persist this one photo as the whole gallery.
  const { data, error: readErr } = await supabase.from('gyms').select('photos').eq('id', gymId).maybeSingle();
  if (readErr) throw readErr;
  if (!data) throw new Error('gym not found');
  const next = [...(((data as { photos?: string[] | null }).photos) ?? []), url];
  const { error } = await supabase.from('gyms').update({ photos: next }).eq('id', gymId);
  if (error) throw error;
  invalidateFocusCache('gyms');
  return next;
}

/** Remove one photo from the gym gallery. */
export async function removeGymPhoto(gymId: string, url: string): Promise<string[]> {
  // Without this check a failed read filters an empty list and the update wipes
  // the entire gallery — deleting one photo would erase them all.
  const { data, error: readErr } = await supabase.from('gyms').select('photos,image_url').eq('id', gymId).maybeSingle();
  if (readErr) throw readErr;
  if (!data) throw new Error('gym not found');
  const row = data as { photos?: string[] | null; image_url?: string | null };
  const next = (row.photos ?? []).filter((u) => u !== url);
  const { error } = await supabase.from('gyms').update({ photos: next }).eq('id', gymId);
  if (error) throw error;
  /* «Sil» on a gallery photo is a privacy action — the owner deletes the shot
     that caught a member's face. Dropping it from the array alone left the file
     serving over plain HTTP to anyone holding the link, with the gallery showing
     it as gone. The object goes too, unless it is still the cover. */
  if (url !== row.image_url) {
    const gone = await removeObject('gyms', url);
    // Said out loud, because "it disappeared from the gallery" is exactly what
    // makes the owner believe the picture is off the internet. Neither caller
    // toasts on success, so this is the message that stays on screen.
    if (!gone) toast('Şəkil qalereyadan silindi, amma fayl serverdən silinmədi — hələ də linklə açıla bilər', 'error');
  }
  invalidateFocusCache('gyms');
  return next;
}
