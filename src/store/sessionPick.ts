import { create } from 'zustand';

/**
 * Hand-off from the exercise picker back to a workout that is already running.
 *
 * «+ Hərəkət əlavə et» in the session opens the same picker the program builder
 * uses. A pushed screen cannot return a value through the router, and the
 * session must stay mounted underneath (its sets, timer and draft live there),
 * so the picker leaves its choice here and the session takes it when it comes
 * back into focus. `take()` empties the slot, so a choice is applied once.
 */
interface SessionPickState {
  pending: { ids: string[]; typed: string[] } | null;
  put: (ids: string[], typed: string[]) => void;
  take: () => { ids: string[]; typed: string[] } | null;
}

export const useSessionPick = create<SessionPickState>((set, get) => ({
  pending: null,
  put: (ids, typed) => set({ pending: { ids, typed } }),
  take: () => {
    const p = get().pending;
    if (p) set({ pending: null });
    return p;
  },
}));
