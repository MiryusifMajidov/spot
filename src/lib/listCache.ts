import { Directory, File, Paths } from 'expo-file-system';

/**
 * The last good copy of the public lists, kept on disk between launches.
 *
 * `useFocusFetch` caches in memory only, so every cold start asked Sydney for the
 * gyms, the trainers, the program library and the feed again — about half a
 * second a request from Baku — and each screen sat on its seed data until the
 * answer came. Now the screen opens on what it showed last time and the fresh
 * copy replaces it when it arrives (stale-while-revalidate). A failed refresh
 * leaves the old list up, which is better than an empty screen.
 *
 * Only these lists. Nothing live or private is kept: chats, notifications,
 * «who is at the gym now», check-ins and per-person pages always come from the
 * server.
 *
 * Files in the OS CACHE directory, not AsyncStorage: on Android AsyncStorage is
 * one 6 MB database shared with the workout history, and a cache that filled it
 * would make the next workout fail to save. The cache directory has no such
 * ceiling, and the OS may clear it when space runs low — which a cache survives.
 */
const PERSISTED = new Set(['gyms', 'trainers', 'programs', 'feed_videos', 'community_posts']);

/** Bump when the shape of a cached list changes, so an old file is ignored
 *  instead of handed to code that expects the new one. */
const VERSION = 1;
/** Older than this is no longer «last time», it is wrong. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** A list bigger than this is not worth the write on every refresh. */
const MAX_CHARS = 1_000_000;

const dir = () => new Directory(Paths.cache, 'spot-lists');
const fileFor = (key: string) => new File(dir(), `${key}.json`);

export const isPersistedList = (key: string) => PERSISTED.has(key);

/** The saved copy, or null when there is none, it is too old, or unreadable. */
export async function readList<T>(key: string): Promise<T | null> {
  try {
    const f = fileFor(key);
    if (!f.exists) return null;
    const saved = JSON.parse(await f.text()) as { v?: number; at?: number; value?: T };
    if (saved?.v !== VERSION || typeof saved.at !== 'number' || Date.now() - saved.at > MAX_AGE_MS) return null;
    return saved.value ?? null;
  } catch {
    return null;
  }
}

/** Best effort: a cache that cannot be written is simply a cache miss next time. */
export function writeList(key: string, value: unknown): void {
  try {
    const body = JSON.stringify({ v: VERSION, at: Date.now(), value });
    if (body.length > MAX_CHARS) return;
    const d = dir();
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
    const f = fileFor(key);
    if (!f.exists) f.create();
    f.write(body);
  } catch {
    /* disk full, or the OS cleared the directory mid-write */
  }
}

/** Sign-out and account deletion: the next person starts from the server. */
export function clearLists(): void {
  try {
    const d = dir();
    if (d.exists) d.delete();
  } catch {
    /* nothing to clear */
  }
}
