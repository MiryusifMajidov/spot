/**
 * Kəşf (discover) & söhbət preferences — persisted, local-first.
 *
 * This holds the state the discover/social screens need but that is NOT domain
 * data: the gym & partner filters (so the filter sheets actually filter), which
 * threads the user has read (so the unread dot is honest), saved partners, and
 * the frozen weekly picks. Nothing here is invented — every value is written by
 * a real user action.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { Gym, Partner } from '@/data/types';

// ------------------------------------------------------------------ filters
export interface GymFilter {
  maxDistanceKm: number | null;
  maxPrice: number | null;
  hours: 'open' | '24h' | null;
  amenities: string[];
}

export interface PartnerFilter {
  levels: string[];
  goals: string[];
  types: string[];
  slots: string[];
  womenOnly: boolean;
  /** 0 = 18–25, 1 = 26–35, 2 = 35+ */
  ageBucket: number | null;
}

export const emptyGymFilter: GymFilter = { maxDistanceKm: null, maxPrice: null, hours: null, amenities: [] };
export const emptyPartnerFilter: PartnerFilter = { levels: [], goals: [], types: [], slots: [], womenOnly: false, ageBucket: null };

export const AGE_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '18–25', min: 18, max: 25 },
  { label: '26–35', min: 26, max: 35 },
  { label: '35+', min: 36, max: 200 },
];

/** How many filter dimensions the user actually set (drives the "Filtr · N" chip). */
export function gymFilterCount(f: GymFilter): number {
  return (f.maxDistanceKm !== null ? 1 : 0) + (f.maxPrice !== null ? 1 : 0) + (f.hours !== null ? 1 : 0) + f.amenities.length;
}

export function partnerFilterCount(f: PartnerFilter, viewerIsWoman = false): number {
  // The women-only flag only counts as an active filter for the people it
  // applies to — otherwise a stale flag shows «Filtr · 1» that changes nothing.
  return f.levels.length + f.goals.length + f.types.length + f.slots.length + (f.womenOnly && viewerIsWoman ? 1 : 0) + (f.ageBucket !== null ? 1 : 0);
}

const HHMM = /(\d{1,2})[:.](\d{2})\s*[–—-]\s*(\d{1,2})[:.](\d{2})/;

function isOpenNow(hours: string): boolean | null {
  if (!hours) return null;
  if (/24\s*saat/i.test(hours)) return true;
  const m = HHMM.exec(hours);
  if (!m) return null; // unknown format — never hide a gym because we could not parse it
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const from = Number(m[1]) * 60 + Number(m[2]);
  const to = Number(m[3]) * 60 + Number(m[4]);
  if (to <= from) return mins >= from || mins < to; // crosses midnight
  return mins >= from && mins < to;
}

export function applyGymFilter(gyms: Gym[], f: GymFilter): Gym[] {
  return gyms.filter((g) => {
    // distanceKm <= 0 means "unknown" (no geolocation yet) — never filter those out.
    if (f.maxDistanceKm !== null && g.distanceKm > 0 && g.distanceKm > f.maxDistanceKm) return false;
    if (f.maxPrice !== null && g.priceMonth > f.maxPrice) return false;
    if (f.hours === '24h' && !/24\s*saat/i.test(g.hours)) return false;
    if (f.hours === 'open' && isOpenNow(g.hours) === false) return false;
    if (f.amenities.length && !f.amenities.every((a) => g.amenities.includes(a))) return false;
    return true;
  });
}

/** Match a TIME_SLOTS bucket ("Axşam 17–21") against a partner's display time ("Axşam 18:00–20:00"). */
function slotMatches(usualTime: string, slot: string): boolean {
  const word = slot.split(' ')[0];
  return usualTime.startsWith(word);
}

/**
 * @param viewerIsWoman  «Yalnız qadınlar» is a woman's own safety choice, so it
 *   is honoured only for her. Enforced HERE and not only by hiding the switch:
 *   the flag is persisted, so anybody who turned it on before the switch was
 *   restricted would otherwise keep a women-only list with no way to clear it.
 */
/**
 * May THIS viewer's women-only filter be honoured?
 *
 * The switch is only rendered for women (partner-filter.tsx), so nobody else can
 * turn it on. But `viewerIsWoman = gender === 'qadın'` also made the filter
 * silently vanish for anyone whose gender field is blank — including a woman who
 * cleared it after setting the filter — and a safety filter that quietly stops
 * applying is worse than one that was never offered. So the rule is «not a man»:
 * a man is still excluded (he cannot turn it on and it is not honoured for him),
 * and an unstated gender errs toward the safer side.
 */
export function womenOnlyAllowed(gender: string | null | undefined): boolean {
  return (gender ?? '').trim() !== 'kişi';
}

export function applyPartnerFilter(list: Partner[], f: PartnerFilter, viewerIsWoman = false): Partner[] {
  return list.filter((p) => {
    if (f.womenOnly && viewerIsWoman && p.gender !== 'qadın') return false;
    if (f.levels.length && !f.levels.includes(p.level)) return false;
    if (f.goals.length && !f.goals.some((g) => p.goals.includes(g))) return false;
    if (f.types.length && !f.types.some((t) => p.types.includes(t))) return false;
    if (f.slots.length && !f.slots.some((s) => slotMatches(p.usualTime, s))) return false;
    if (f.ageBucket !== null) {
      const b = AGE_BUCKETS[f.ageBucket];
      // An age of 0 means "not recorded", not "zero years old" — filtering on it
      // would silently hide every user who has never entered one.
      if (b && p.age > 0 && (p.age < b.min || p.age > b.max)) return false;
    }
    return true;
  });
}

/** ISO week key, e.g. "2026-W35" — used to freeze the weekly picks for a week. */
export function isoWeekKey(d: Date = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ store
interface DiscoverPrefs {
  gymFilter: GymFilter;
  partnerFilter: PartnerFilter;
  /** threadId → ISO timestamp of the last time the user opened it */
  lastRead: Record<string, string>;
  savedPartners: string[];
  weeklyPicks: { week: string; ids: string[] } | null;

  setGymFilter: (patch: Partial<GymFilter>) => void;
  resetGymFilter: () => void;
  setPartnerFilter: (patch: Partial<PartnerFilter>) => void;
  resetPartnerFilter: () => void;
  markThreadRead: (id: string) => void;
  toggleSavedPartner: (id: string) => void;
  setWeeklyPicks: (week: string, ids: string[]) => void;
}

export const useDiscoverPrefs = create<DiscoverPrefs>()(
  persist(
    (set) => ({
      gymFilter: emptyGymFilter,
      partnerFilter: emptyPartnerFilter,
      lastRead: {},
      savedPartners: [],
      weeklyPicks: null,

      setGymFilter: (patch) => set((s) => ({ gymFilter: { ...s.gymFilter, ...patch } })),
      resetGymFilter: () => set({ gymFilter: emptyGymFilter }),
      setPartnerFilter: (patch) => set((s) => ({ partnerFilter: { ...s.partnerFilter, ...patch } })),
      resetPartnerFilter: () => set({ partnerFilter: emptyPartnerFilter }),
      markThreadRead: (id) => set((s) => ({ lastRead: { ...s.lastRead, [id]: new Date().toISOString() } })),
      toggleSavedPartner: (id) =>
        set((s) => ({
          savedPartners: s.savedPartners.includes(id) ? s.savedPartners.filter((x) => x !== id) : [...s.savedPartners, id],
        })),
      setWeeklyPicks: (week, ids) => set({ weeklyPicks: { week, ids } }),
    }),
    {
      name: 'spot-discover-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DiscoverPrefs>;
        return {
          ...current,
          ...p,
          gymFilter: { ...emptyGymFilter, ...(p.gymFilter ?? {}) },
          partnerFilter: { ...emptyPartnerFilter, ...(p.partnerFilter ?? {}) },
        };
      },
      partialize: (s) => ({
        gymFilter: s.gymFilter,
        partnerFilter: s.partnerFilter,
        lastRead: s.lastRead,
        savedPartners: s.savedPartners,
        weeklyPicks: s.weeklyPicks,
      }),
    }
  )
);
