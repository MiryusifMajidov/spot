import { Exercise, Gym, Partner, Program, Trainer } from './types';

/** Onboarding option lists (matching = these params only). */
export const GOALS = ['Kütlə yığmaq', 'Arıqlamaq', 'Güc', 'Dözümlülük', 'Forma saxlamaq', 'Sağlamlıq'];
export const LEVELS = ['Başlanğıc', 'Orta', 'İrəli'] as const;
export const WORKOUT_TYPES = ['Sərbəst ağırlıq', 'Kardio', 'Funksional', 'CrossFit', 'Bodybuilding', 'Powerlifting', 'Yoga', 'Boks'];
export const DAYS = ['B.e', 'Ç.a', 'Çər', 'C.a', 'Cüm', 'Şən', 'Baz'];
export const TIME_SLOTS = ['Səhər 6–9', 'Gündüz 9–17', 'Axşam 17–21', 'Gecə 21–24'];

export const gyms: Gym[] = [
  {
    id: 'iron-bay',
    lat: 40.4093,
    lng: 49.8671, // Nərimanov rayonunun mərkəzi — nümunə zalı üçün təxmini yer
    approxLocation: true,
    name: 'Iron Bay',
    verified: false, // no admin ever approved an ownership claim for a seed gym
    district: 'Nərimanov',
    distanceKm: 0, // a distance can only come from the gyms_near RPC with a real fix; the screens hide 0
    hours: '6:00–24:00',
    priceMonth: 45,
    dayPass: 5,
    members: 0,      // derived from real profiles by schema11; never a seeded figure
    trainers: 9,
    rating: 0,       // derived from real reviews by schema11
    reviewCount: 0,  // idem
    liveCount: 0,
    amenities: ['Sərbəst ağırlıq', 'Duş', 'Park', 'Sauna', 'Kardio zonası', 'Wi-Fi'],
    tags: ['Sərbəst ağırlıq', 'Duş', 'Park', '9 müəllim'],
    about:
      'Nərimanovda sərbəst ağırlıq üzərində qurulmuş güc zalı. Geniş kardio zonası, təmiz duş və park daxil. Səhər tezdən gecəyə qədər açıqdır.',
  },
  {
    id: 'volt-gym',
    lat: 40.3777,
    lng: 49.809, // Yasamal rayonunun mərkəzi — nümunə zalı üçün təxmini yer
    approxLocation: true,
    name: 'Volt Gym',
    verified: false,
    district: 'Yasamal',
    distanceKm: 0, // a distance can only come from the gyms_near RPC with a real fix; the screens hide 0
    hours: '24 saat',
    priceMonth: 60,
    dayPass: 7,
    members: 0,      // derived from real profiles by schema11; never a seeded figure
    trainers: 14,
    rating: 0,       // derived from real reviews by schema11
    reviewCount: 0,  // idem
    liveCount: 0,
    amenities: ['24 saat', 'Duş', 'Kardio zonası', 'Qrup dərsləri'],
    tags: ['24 saat', 'Kardio', '14 müəllim'],
    about: '24 saat açıq, müasir avadanlıqlı şəhər zalı. Qrup dərsləri və geniş kardio zonası ilə.',
  },
  {
    id: 'atlas-fit',
    lat: 40.386,
    lng: 49.896, // Xətai rayonunun mərkəzi — nümunə zalı üçün təxmini yer
    approxLocation: true,
    name: 'Atlas Fitness',
    verified: false, // no admin ever approved an ownership claim for a seed gym
    district: 'Xətai',
    distanceKm: 0, // a distance can only come from the gyms_near RPC with a real fix; the screens hide 0
    hours: '7:00–23:00',
    priceMonth: 50,
    dayPass: 6,
    members: 0,      // derived from real profiles by schema11; never a seeded figure
    trainers: 7,
    rating: 0,       // derived from real reviews by schema11
    reviewCount: 0,  // idem
    liveCount: 0,
    amenities: ['Sərbəst ağırlıq', 'Basseyn', 'Sauna', 'Duş'],
    tags: ['Basseyn', 'Sauna', '7 müəllim'],
    about: 'Basseyn və sauna daxil olmaqla tam kompleks. Ailəvi mühit, təcrübəli müəllim heyəti.',
  },
  {
    id: 'peak-house',
    lat: 40.396,
    lng: 49.842, // Nəsimi rayonunun mərkəzi — nümunə zalı üçün təxmini yer
    approxLocation: true,
    name: 'Peak House',
    verified: false,
    district: 'Nəsimi',
    distanceKm: 0, // a distance can only come from the gyms_near RPC with a real fix; the screens hide 0
    hours: '8:00–22:00',
    priceMonth: 40,
    dayPass: 4,
    members: 0,      // derived from real profiles by schema11; never a seeded figure
    trainers: 5,
    rating: 0,       // derived from real reviews by schema11
    reviewCount: 0,  // idem
    liveCount: 0,
    amenities: ['Funksional', 'CrossFit', 'Duş'],
    tags: ['Funksional', 'CrossFit', '5 müəllim'],
    about: 'Funksional və CrossFit yönümlü butik zal. Kiçik qruplarla intensiv məşqlər.',
  },
];

/* Empty on purpose — four invented coaches with ratings (4.9, 4.8), client
 * counts (38, 44) and certifications including «Iron Bay təsdiqi». Kəşf →
 * Müəllimlər reads the server (`useTrainers`), so these never showed; they were
 * a ready-made fallback with exactly the numbers schema27 stopped anyone from
 * writing. A coach's rating and client count must be earned, not seeded. */
export const trainers: Trainer[] = [];


/* Empty on purpose — the same twelve invented people in a second place.
 * Nothing imports `partners` (only DAYS/GOALS/LEVELS/TIME_SLOTS/WORKOUT_TYPES
 * and getGym are used from this file), so removing the rows changes no screen
 * and removes a second copy of the trap. */
export const partners: Partner[] = [];


export const pushExercises: Exercise[] = [
  { id: 'bench', name: 'Ştanqla bench press', muscle: 'Sinə', sets: 4, reps: '6–8', lastTime: '80kg × 8', commonMistake: 'Dirsəkləri həddən artıq açmaq — çiyinə yük düşür.', substitutes: ['Dumbbell press', 'Maşında press'] },
  { id: 'ohp', name: 'Çiyin press', muscle: 'Çiyin', sets: 3, reps: '8–10', lastTime: '45kg × 9', commonMistake: 'Beli aşırı əymək.', substitutes: ['Dumbbell çiyin press'] },
  { id: 'dips', name: 'Paralel dips', muscle: 'Triseps', sets: 3, reps: '10–12', commonMistake: 'Çox aşağı enmək — çiyini incidir.', substitutes: ['Triseps pushdown'] },
];

export const programs: Program[] = [
  {
    id: 'ppl-strength',
    title: 'Push Pull Legs — Güc',
    creatorName: 'SPOT', // these starter plans are SPOT's own; they were credited to invented trainers
    creatorType: 'spot',
    creatorVerified: false,
    weeks: 8,
    daysPerWeek: 6,
    level: 'Orta',
    goal: 'Güc',
    paid: false,
    rating: 0,
    minutes: 55,
    videoCount: 0,
    doneBy: 0,
    tags: ['Sərbəst ağırlıq', 'Güc', 'Zal'],
    saves: 0,
    days: [
      { title: 'Gün 1 · Push', focus: 'Sinə, çiyin, triseps', exercises: pushExercises },
      { title: 'Gün 2 · Pull', focus: 'Kürək, biseps', exercises: [] },
      { title: 'Gün 3 · Legs', focus: 'Ayaq, gluteus', exercises: [] },
    ],
  },
  {
    id: 'home-basics',
    title: 'Evdə başlanğıc — avadanlıqsız',
    creatorName: 'SPOT', // these starter plans are SPOT's own; they were credited to invented trainers
    creatorType: 'spot',
    creatorVerified: false,
    weeks: 4,
    daysPerWeek: 3,
    level: 'Başlanğıc',
    goal: 'Forma saxlamaq',
    paid: false,
    rating: 0,
    minutes: 20,
    videoCount: 0,
    doneBy: 0,
    tags: ['Evdə', 'Avadanlıqsız', 'Bodyweight'],
    saves: 0,
    days: [
      { title: 'Gün 1 · Tam bədən', focus: 'Bütün əzələ qrupları', exercises: [] },
      { title: 'Gün 2 · Kardio + core', focus: 'Ürək-damar, qarın', exercises: [] },
    ],
  },
  {
    id: 'fat-loss-8',
    title: '8 həftəlik arıqlama',
    creatorName: 'SPOT', // these starter plans are SPOT's own; they were credited to invented trainers
    creatorType: 'spot',
    creatorVerified: false,
    weeks: 8,
    daysPerWeek: 4,
    level: 'Başlanğıc',
    goal: 'Arıqlamaq',
    paid: false,
    rating: 0,
    minutes: 45,
    videoCount: 0,
    doneBy: 0,
    hasMealPlan: true,
    tags: ['Funksional', 'Kardio', 'Arıqlama'],
    saves: 0,
    days: [{ title: 'Gün 1 · HIIT', focus: 'Yüksək intensivlik', exercises: [] }],
  },
  {
    id: 'strength-5x5',
    title: 'Güc bazası — 5x5',
    creatorName: 'SPOT', // these starter plans are SPOT's own; they were credited to invented trainers
    creatorType: 'spot',
    creatorVerified: false,
    weeks: 12,
    daysPerWeek: 3,
    level: 'Orta',
    goal: 'Güc',
    // SPOT takes no money, and this plan is SPOT's own — see schema17.
    paid: false,
    rating: 0,
    minutes: 50,
    videoCount: 0,
    doneBy: 0,
    tags: ['Sərbəst ağırlıq', 'Güc', '5x5'],
    saves: 0,
    days: [{ title: 'Gün A', focus: 'Skvat, bench, dartma', exercises: [] }],
  },
];

// ---- accessors ----
export const getGym = (id: string) => gyms.find((g) => g.id === id);
export const getTrainer = (id: string) => trainers.find((t) => t.id === id);
export const getPartner = (id: string) => partners.find((p) => p.id === id);
export const getProgram = (id: string) => programs.find((p) => p.id === id);
export const trainersForGym = (gymId: string) => trainers.filter((t) => t.gymId === gymId);
export const partnersForGym = (gymId: string) => partners.filter((p) => p.gymId === gymId);
export const partnersHereNow = (gymId: string) => partnersForGym(gymId).filter((p) => p.hereNow);

export const HERO_GYM_ID = 'iron-bay';
