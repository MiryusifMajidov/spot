import { useEffect, useSyncExternalStore } from 'react';

import { hasSupabaseConfig, supabase } from './supabase';

/**
 * Profile photos by profile id, for every place that knows WHO but not the photo.
 *
 * Only the own profile, the trainer page and the edit screen ever drew a photo:
 * the feed, chats, requests, comments, partner cards and the partner's own page
 * were handed a name and nothing else, so everybody else always looked like their
 * initials. Rather than widen a dozen queries, an <Avatar profileId=…> asks here.
 * Requests made in the same moment go out as ONE query, and an answer — photo or
 * no photo — is kept for the session.
 */
type Entry = string | null; // the URL, or null = this profile has no photo
const cache = new Map<string, Entry>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

async function flush() {
  timer = null;
  const ids = [...waiting].slice(0, 100);
  ids.forEach((id) => waiting.delete(id));
  if (waiting.size) timer = setTimeout(flush, 0);
  if (!ids.length) return;
  const { data, error } = await supabase.from('profiles').select('id,avatar_url').in('id', ids);
  // A failed read stays unknown (not «no photo»), so a later screen asks again.
  if (error) return;
  const got = new Map(((data ?? []) as { id: string; avatar_url: string | null }[]).map((r) => [r.id, r.avatar_url]));
  // A profile the server did not return (blocked, hidden) has no photo to show.
  ids.forEach((id) => cache.set(id, got.get(id) ?? null));
  emit();
}

function request(id: string) {
  if (cache.has(id) || waiting.has(id) || !hasSupabaseConfig) return;
  waiting.add(id);
  if (!timer) timer = setTimeout(flush, 30);
}

/** Tell the cache about a photo this screen already knows (or just changed). */
export function rememberAvatar(id: string, url: string | null) {
  cache.set(id, url);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The photo URL for this profile, or null while unknown / when there is none. */
export function useAvatarUrl(profileId: string | null | undefined): string | null {
  useEffect(() => {
    if (profileId) request(profileId);
  }, [profileId]);
  return useSyncExternalStore(subscribe, () => (profileId ? cache.get(profileId) ?? null : null));
}

// ------------------------------------------------------------------- peek ----
/** The enlarged photo shown while an avatar is held (Instagram's press-and-hold). */
export type Peek = { uri: string; name: string } | null;
let peek: Peek = null;
const peekListeners = new Set<() => void>();
export function setAvatarPeek(next: Peek) {
  peek = next;
  peekListeners.forEach((l) => l());
}
export function useAvatarPeek(): Peek {
  return useSyncExternalStore(
    (l) => {
      peekListeners.add(l);
      return () => {
        peekListeners.delete(l);
      };
    },
    () => peek
  );
}
