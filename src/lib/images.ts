/**
 * Picking and uploading images (avatars, trainer photos, gym galleries).
 *
 * Every function is honest about failure: nothing here silently pretends an
 * upload happened, and a denied OS permission is said out loud instead of leaving
 * the button dead. Requires supabase/schema8_photos_location.sql (the public
 * `avatars` / `gyms` buckets + the url columns) and a migration creating the
 * PRIVATE `certs` bucket for trainer verification evidence.
 */
import * as ImagePicker from 'expo-image-picker';

import { toast } from '@/store/ui';
import { getMyProfile } from './api';
import { supabase } from './supabase';
import { invalidateFocusCache, invalidateFocusPrefix } from './focusFetch';

/** `certs` holds verification evidence (diplomas, ID photos). It is PRIVATE —
 *  see the storage migration — and is never read through getPublicUrl. */
export type Bucket = 'avatars' | 'gyms';
export const CERT_BUCKET = 'certs';

/** Open the library and return a local uri, or null if the user cancelled. */
export async function pickImage(opts?: { square?: boolean }): Promise<string | null> {
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
  return res.assets[0].uri;
}

/** Take a new photo with the camera, or null if cancelled / not permitted. */
export async function shootImage(opts?: { square?: boolean }): Promise<string | null> {
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
  return res.assets[0].uri;
}

/** Upload a local image into `bucket` and return the STORAGE PATH. Throws on failure. */
async function uploadToBucket(bucket: string, localUri: string, prefix: string): Promise<string> {
  const ext = (localUri.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const path = `${prefix}-${Date.now().toString(36)}.${ext === 'png' || ext === 'webp' ? ext : 'jpg'}`;
  const bytes = await (await fetch(localUri)).arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType: type, upsert: true });
  if (error) throw error;
  return path;
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
  const url = await uploadImage('avatars', localUri, `p-${me.id}`);
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', me.id);
  if (error) throw error;
  invalidateFocusPrefix('partners:'); // my card at the gym now has a face
  return url;
}

/** Trainer profile photo (`trainers.photo_url`). */
export async function setTrainerPhoto(trainerId: string, localUri: string): Promise<string> {
  const url = await uploadImage('avatars', localUri, `t-${trainerId}`);
  const { error } = await supabase.from('trainers').update({ photo_url: url }).eq('id', trainerId);
  if (error) throw error;
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
  const url = await uploadImage('gyms', localUri, `g-${gymId}`);
  const { error } = await supabase.from('gyms').update({ image_url: url }).eq('id', gymId);
  if (error) throw error;
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
  const { data, error: readErr } = await supabase.from('gyms').select('photos').eq('id', gymId).maybeSingle();
  if (readErr) throw readErr;
  if (!data) throw new Error('gym not found');
  const next = (((data as { photos?: string[] | null }).photos) ?? []).filter((u) => u !== url);
  const { error } = await supabase.from('gyms').update({ photos: next }).eq('id', gymId);
  if (error) throw error;
  invalidateFocusCache('gyms');
  return next;
}
