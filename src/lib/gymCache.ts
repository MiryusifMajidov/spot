import type { Gym } from '@/data/types';

/**
 * The gym catalogue, cached so a synchronous lookup can find a REAL gym.
 *
 * `gymById()` used to search `src/data/mock.ts` — four hard-coded seed rows —
 * and nothing else. Every screen that resolves a gym id synchronously therefore
 * could not see a gym somebody had actually registered:
 *
 *   · the swipe cards printed «Zal · 0 km» for a real gym, because the name was
 *     unknown and every seed carried `distanceKm: 0`;
 *   · onboarding's last step told a person «evdə məşq edirsən» right after they
 *     picked their gym;
 *   · the Məşq tab's starter roadmap kept saying «Zalını seç» to somebody who
 *     already had.
 *
 * The list arrives asynchronously, so a lookup cannot fetch. It reads this map
 * instead, which every real read of the catalogue fills. `undefined` still means
 * «not known here» and every caller already treats it that way — the difference
 * is that it is now the truth rather than an artefact of looking in the wrong
 * place.
 */
const byId = new Map<string, Gym>();

/** Called by every path that reads the real catalogue. */
export function cacheGyms(list: Gym[] | null | undefined): void {
  for (const g of list ?? []) if (g?.id) byId.set(g.id, g);
}

export function cachedGym(id: string | null | undefined): Gym | undefined {
  return id ? byId.get(id) : undefined;
}

/** Only for sign-out / account deletion: the next account's catalogue is its own. */
export function clearGymCache(): void {
  byId.clear();
}
