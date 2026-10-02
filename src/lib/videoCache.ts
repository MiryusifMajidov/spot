import { setVideoCacheSizeAsync, type BufferOptions, type VideoSource } from 'expo-video';

/**
 * Every clip SPOT plays goes through the player's DISK cache.
 *
 * Without it each view streamed the whole file from Supabase again — the feed's
 * four-second clips loop, the exercise page replays the same demo set after set,
 * and the poster generator downloaded the file once more just to grab a frame. All
 * of that was egress, the quota the free plan ran out of, and all of it waited on
 * Sydney. With the cache a phone downloads a clip once; every replay, loop and
 * poster after that reads it from disk and starts instantly.
 *
 * The files are public and immutable (each upload gets a unique name), so a
 * cached copy can never go stale.
 */
export function cachedVideo(uri: string | null | undefined): VideoSource {
  return uri ? { uri, useCaching: true } : null;
}

/**
 * How much a player may hold in memory ahead of the playhead.
 *
 * THE FEED CRASH. Every «SPOT keeps closing» report from the feed (1.4.6, on
 * the owner's phone, a friend's and an emulator) was a java.lang.OutOfMemoryError:
 * the 256 MB Java heap full, the last allocation failing wherever it happened to
 * be — okhttp, Fabric, and inside ExoPlayer while it queued the next loop. On
 * Android expo-video buffers 20 s ahead with no byte ceiling (ExoPlayer then
 * allows ~125 MB of video per player, all of it Java heap), and a looping clip is
 * buffered again for every repetition: a 4-second, 7 MB clip is five copies of
 * itself in memory. The feed keeps two or three pages — players — alive at once.
 *
 * 8 s / 12 MB per player is two loops of a feed clip and several seconds of a
 * long one; three players stay under 40 MB.
 */
export const LEAN_BUFFER: BufferOptions = {
  preferredForwardBufferDuration: 8,
  maxBufferBytes: 12 * 1024 * 1024,
  minBufferForPlayback: 1,
};

/** Least-recently-used eviction above this. expo-video's default is 1 GB — a lot
 *  of someone's phone for a fitness app; 512 MB still holds hundreds of clips. */
const VIDEO_CACHE_BYTES = 512 * 1024 * 1024;

/**
 * Set once per launch, before any player exists — expo-video refuses the call
 * while a player is alive, and the value is persistent anyway, so a refusal
 * (a player that beat us to it) only means last launch's size still applies.
 */
export function configureVideoCache(): void {
  setVideoCacheSizeAsync(VIDEO_CACHE_BYTES).catch(() => {});
}
