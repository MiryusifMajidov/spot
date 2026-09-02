import { azLower } from '@/lib/az';

/** `spot` = a starter plan written by SPOT itself. It exists so those plans stop
 *  being attributed to a trainer who never wrote them. */
export type CreatorType = 'trainer' | 'user' | 'spot';
export type Level = 'Başlanğıc' | 'Orta' | 'İrəli';

/** Coerce whatever the server holds into a Level the UI can show.
 *
 *  Older seeding scripts wrote English values ('beginner', 'intermediate',
 *  'advanced') and the screens printed the stored string verbatim — so an
 *  Azerbaijani-only product rendered «Günel Rəhimova · beginner». schema16
 *  normalises the rows and adds a CHECK, but the client must not depend on the
 *  data being clean: an unrecognised value returns null so the field is simply
 *  omitted rather than guessed at. */
export function toLevel(raw: string | null | undefined): Level | null {
  const v = azLower((raw ?? '').trim());
  if (!v) return null;
  if (v === 'başlanğıc' || v === 'baslangic' || v === 'beginner' || v === 'basic' || v === 'novice') return 'Başlanğıc';
  if (v === 'orta' || v === 'intermediate' || v === 'medium') return 'Orta';
  if (v === 'irəli' || v === 'i̇rəli' || v === 'ireli' || v === 'advanced' || v === 'expert' || v === 'pro') return 'İrəli';
  return null;
}
export type Gender = 'kişi' | 'qadın';

export interface Gym {
  id: string;
  name: string;
  verified: boolean;
  district: string;
  distanceKm: number;
  hours: string;
  priceMonth: number;
  dayPass: number;
  members: number;
  trainers: number;
  rating: number;
  reviewCount: number;
  liveCount: number; // people checked-in right now
  amenities: string[];
  tags: string[];
  about: string;
  imageUrl?: string | null;
  photos?: string[];
  lat?: number | null;
  lng?: number | null;
  /** True when the pin is a district-centre approximation, not a recorded address.
   *  Only the seed catalogue sets this; a gym located by its owner never does. */
  approxLocation?: boolean;
}

export interface Trainer {
  id: string;
  name: string;
  verified: boolean;
  gymId: string;
  specialty: string;
  rating: number;
  clients: number;
  responseTime: string; // "2 saat"
  priceFrom: number;
  bio: string;
  certifications: string[];
  photoUrl?: string | null;
}

export interface Partner {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  gymId: string;
  level: Level;
  goals: string[];
  types: string[];
  usualTime: string; // "Axşam 18:00–20:00"
  /** 0–100, or `null` when the score could not be computed at all (no profile of
   *  my own to compare against). null is NOT zero: a 0 means «we compared and
   *  nothing matched», null means «nothing was compared» — the screen must show
   *  «hesablanmadı» / «Profilini tamamla» there instead of «0% uyğun». */
  compatibility: number | null;
  /** Dimensions that lined up («Eyni zal», «Eyni saat», a shared goal). */
  matchReasons: string[];
  /** Dimensions that did NOT line up («Səviyyə fərqi», «Fərqli saat»). The design
   *  forbids a black box: the screen shows these next to matchReasons, styled as
   *  misses. Optional so seed/mock partners need not carry it. */
  mismatches?: string[];
  hereNow: boolean;
  minutesLeft?: number; // if here now
  prs: { lift: string; value: number }[];
}

export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  sets: number;
  reps: string;
  lastTime?: string; // "60kg × 8"
  commonMistake: string;
  substitutes: string[];
}

export interface Program {
  id: string;
  title: string;
  creatorName: string;
  creatorType: CreatorType;
  creatorVerified: boolean;
  weeks: number;
  daysPerWeek: number;
  level: Level;
  goal: string;
  paid: boolean;
  price?: number;
  rating: number;
  minutes: number; // per session
  videoCount: number;
  doneBy: number; // how many people run it
  hasMealPlan?: boolean;
  tags: string[];
  saves: number;
  days: { title: string; focus: string; exercises: Exercise[] }[];
}
