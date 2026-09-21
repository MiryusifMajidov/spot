/**
 * `const t = useT()` — the component-side half of src/lib/i18n.ts.
 *
 * It returns the same `t`, and subscribes this component to language changes so
 * the screen re-renders when somebody switches. The alternative — remounting
 * the whole tree on a language change — resets navigation and loses whatever
 * the person was in the middle of.
 *
 * `useSyncExternalStore` rather than a state+effect pair: the language lives
 * outside React (a toast fired from an API error handler has no component
 * around it), and this is the sanctioned way to read an external source without
 * tearing during a concurrent render.
 */
import { useSyncExternalStore } from 'react';

import { getLang, subscribeLang, t } from './i18n';

export function useLang() {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

export function useT(): typeof t {
  // Subscribes; the returned function is the module-level one, so nothing here
  // allocates a new closure per render for the compiler to memoize around.
  useLang();
  return t;
}
