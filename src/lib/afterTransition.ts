/**
 * Run work only once the screen transition has settled.
 *
 * Why this exists: expo-router's NativeTabs gates the native tab swap on a
 * `useDeferredValue` render (node_modules/expo-router/build/native-tabs/
 * NativeTabsView.shared.js). That render is low priority, so anything a screen
 * does while it is focusing pushes the *visible* tab change later — which is
 * exactly what made tapping a tab feel like it hung.
 *
 * `InteractionManager.runAfterInteractions` used to be the answer, but React
 * Native 0.86 logs a deprecation warning for it and points at
 * `requestIdleCallback`. Idle is in fact the better fit: it waits for the JS
 * thread to be free rather than for animations to finish. The `timeout` keeps
 * the work from being starved indefinitely on a busy thread, and a `setTimeout`
 * path covers any runtime that does not provide the idle API.
 */

type Cancel = () => void;

const hasIdle =
  typeof globalThis.requestIdleCallback === 'function' && typeof globalThis.cancelIdleCallback === 'function';

/** Schedule `fn` for after the transition. Returns a cancel function — always
 *  call it from the effect cleanup so a screen left early does no work. */
export function afterTransition(fn: () => void, timeout = 500): Cancel {
  if (hasIdle) {
    const handle = globalThis.requestIdleCallback(() => fn(), { timeout });
    return () => globalThis.cancelIdleCallback(handle);
  }
  const handle = setTimeout(fn, 0);
  return () => clearTimeout(handle);
}
