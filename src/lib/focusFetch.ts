import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { hasSupabaseConfig } from '@/lib/supabase';
import { afterTransition } from '@/lib/afterTransition';

/* ---------------- focus refetch, without stalling the tab switch ----------------
 * expo-router's NativeTabs gates the native tab swap on a `useDeferredValue`
 * render (see node_modules/expo-router/build/native-tabs/NativeTabsView.shared.js).
 * That render is low priority, so any work a screen does while it is focusing
 * pushes the *visible* tab change later — which is exactly the lag you feel when
 * you tap a tab. Two rules keep the switch instant:
 *   1. data fetched moments ago is reused instead of refetched, and
 *   2. the fetch that does run starts only after the transition has settled.
 * The cache is shared by key, so a second screen asking for the same data gets
 * what the first one already loaded rather than falling back to the seeds. */
const FRESH_MS = 60_000;
type CacheEntry = { at: number; value: unknown };
const focusCache = new Map<string, CacheEntry>();

/** Drop cached data after a write, so the next focus reloads for real instead of
 *  showing the user a catalogue that does not yet contain what they just created. */
export function invalidateFocusCache(...keys: string[]) {
  if (!keys.length) {
    focusCache.clear();
    return;
  }
  for (const k of keys) focusCache.delete(k);
}

/** Also drop every per-id entry under a prefix (e.g. all `partners:*`). */
export function invalidateFocusPrefix(prefix: string) {
  for (const k of [...focusCache.keys()]) if (k.startsWith(prefix)) focusCache.delete(k);
}

/** `load` returns null to mean "nothing worth showing" — the fallback then stands.
 *  An empty `key` disables the hook entirely (used when a local value already wins). */
export function useFocusFetch<T>(key: string, fallback: T, load: () => Promise<T | null>): T {
  const [data, setData] = useState<T>(() => (focusCache.get(key)?.value as T) ?? fallback);
  // Held in a ref so callers don't each have to memoise their fetcher.
  const loadRef = useRef(load);
  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      if (!hasSupabaseConfig || !key) return;
      let alive = true;

      const hit = focusCache.get(key);
      if (hit) setData(hit.value as T); // stable reference: React bails out when unchanged
      if (hit && Date.now() - hit.at < FRESH_MS) return; // still fresh — no network, no render

      const cancel = afterTransition(() => {
        loadRef
          .current()
          .then((value) => {
            if (value == null) return;
            focusCache.set(key, { at: Date.now(), value });
            if (alive) setData(value);
          })
          .catch(() => {});
      });

      return () => {
        alive = false;
        cancel();
      };
    }, [key])
  );

  return data;
}

/** A list is only worth replacing the seeds with when the server actually has rows. */
export const nonEmpty = <T,>(rows: T[] | null | undefined): T[] | null => (rows && rows.length ? rows : null);
