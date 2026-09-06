/**
 * A real still frame for a video, instead of a coloured rectangle.
 *
 * The Saxlanilanlar shelf, the creator's page and the profile grid all drew
 * every video as a two-colour gradient with a play triangle on it - so a row of
 * three clips was three near-identical rectangles, and the caption was the only
 * thing telling them apart.
 *
 * WHY THERE IS NO STORED POSTER. `feed_videos.poster_url` exists (schema46) but
 * filling it means uploading image bytes, and nothing installed can produce
 * them: `VideoThumbnail` is a native reference and expo-image has no
 * `saveAsync`. Writing it into expo-image's own disk cache does not work either
 * - `writeToCacheAsync` accepts a URL or an expo-image `Image`, and rejects a
 * video thumbnail as the wrong native class. A poster that survives a restart
 * needs a new native dependency (expo-image-manipulator) and a rebuild.
 *
 * So the frame is generated on the device and kept in memory for the session.
 * Two costs are deliberately bounded:
 *
 *   - a video player per thumbnail, so only ONE runs at a time, which is
 *     exactly the memory problem F-17 was about;
 *   - a decoded bitmap per poster, so they are small (320px wide, roughly
 *     0.7 MB each) and the cache holds at most 24.
 */
import type { ImageRef } from 'expo-image';
import { createVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';

/** Decoded frames, oldest first. Bounded - see the note above. */
const MAX_CACHED = 24;
const cache = new Map<string, ImageRef>();

/** Ids already tried and failed: a dead URL or an undecodable clip is not
 *  retried on every scroll. */
const failed = new Set<string>();

/** One player at a time, in the order the tiles asked. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/** A freshly created player is `idle`, and an idle player returns no frame.
 *  Without this wait nothing was ever produced. */
async function waitUntilReady(player: { status: string }, timeoutMs = 15000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (player.status === 'readyToPlay') return true;
    if (player.status === 'error') return false;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function generate(videoId: string, videoUrl: string): Promise<ImageRef | null> {
  const player = createVideoPlayer(videoUrl);
  try {
    if (!(await waitUntilReady(player))) return null;
    // One second in, not zero: the first frame of a phone recording is very
    // often black or a half-exposed blur.
    const [thumb] = await player.generateThumbnailsAsync(1, { maxWidth: 320 });
    if (!thumb) return null;
    /* Rendered directly by expo-image's `source`, which is what expo-video's
       own documentation says to do with it. The declarations do not line up
       (VideoThumbnail carries no `scale`/`mediaType`), so the cast is the
       typing catching up with the API. */
    return thumb as unknown as ImageRef;
  } finally {
    // Always, including on failure - a leaked player holds a decoder.
    player.release();
  }
}

function remember(videoId: string, ref: ImageRef) {
  cache.set(videoId, ref);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * The poster for one video, or null while there is none.
 *
 * Null is drawn as the gradient the tile already had - never as a broken image,
 * and never as a frame borrowed from another video.
 */
export function useVideoPoster(videoId: string, videoUrl: string): ImageRef | null {
  /* Only what THIS hook generated. The cache is read during render instead of
     being copied into state, so a tile that mounts after another tile already
     made the frame shows it on its first paint — no effect, no flash of
     gradient, and no setState-in-effect. */
  const [made, setMade] = useState<{ id: string; ref: ImageRef } | null>(null);
  const ref = cache.get(videoId) ?? (made?.id === videoId ? made.ref : null);

  useEffect(() => {
    if (!videoId || !videoUrl) return;
    if (cache.has(videoId) || failed.has(videoId)) return;

    let alive = true;
    enqueue(() => generate(videoId, videoUrl))
      .then((m) => {
        if (!m) {
          failed.add(videoId);
          return;
        }
        remember(videoId, m);
        if (alive) setMade({ id: videoId, ref: m });
      })
      .catch((e) => {
        failed.add(videoId);
        if (__DEV__) console.log('[poster] alinmadi', videoId, String(e));
      });

    return () => {
      alive = false;
    };
  }, [videoId, videoUrl]);

  return ref;
}
