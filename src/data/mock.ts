import { Exercise, Partner, Program, Trainer } from './types';

/** Onboarding option lists (matching = these params only). */
export const GOALS = ['Kütlə yığmaq', 'Arıqlamaq', 'Güc', 'Dözümlülük', 'Forma saxlamaq', 'Sağlamlıq'];
export const LEVELS = ['Başlanğıc', 'Orta', 'İrəli'] as const;
export const WORKOUT_TYPES = ['Sərbəst ağırlıq', 'Kardio', 'Funksional', 'CrossFit', 'Bodybuilding', 'Powerlifting', 'Yoga', 'Boks'];
export const DAYS = ['B.e', 'Ç.a', 'Çər', 'C.a', 'Cüm', 'Şən', 'Baz'];
export const TIME_SLOTS = ['Səhər 6–9', 'Gündüz 9–17', 'Axşam 17–21', 'Gecə 21–24'];

/* There are no seeded gyms any more.
 *
 * Four lived here — Iron Bay, Volt Gym, Atlas Fitness, Peak House — with monthly
 * prices, day-pass prices, opening hours, amenity lists, «about» copy, ratings,
 * member counts and coordinates that a seed script invented, attributed to
 * named businesses that never agreed to any of it. They were the ENTIRE
 * catalogue: onboarding step 4 offered exactly these, Kəşf listed exactly these,
 * the map plotted exactly these, and because `useGyms` is local-first they also
 * stood in whenever the network was down — so `discover/index.tsx`'s honest
 * «Hələ zal yoxdur» state could never appear.
 *
 * Their coordinates were district centres, so a person standing inside the real
 * gym was told it was 1.4 km away and could not check in. Their tags still read
 * «9 müəllim» for a gym with no trainers — the exact string schema23 exists to
 * strip from the database.
 *
 * schema66 deletes the rows; these literals go with them. A gym now exists only
 * when a real one registers, and the empty states that were already written are
 * what a person sees until then.
 */

export const trainers: Trainer[] = [];


/* Empty on purpose — the same twelve invented people in a second place.
 * Nothing imports `partners` (only DAYS/GOALS/LEVELS/TIME_SLOTS/WORKOUT_TYPES
 * and getGym are used from this file), so removing the rows changes no screen
 * and removes a second copy of the trap. */
export const partners: Partner[] = [];


/* The starter plans' days.
 *
 * Only «Gün 1 · Push» was ever filled: every other day of every seeded program
 * had `exercises: []`, so the second workout in the app's own core loop hit
 * «Bu günə hərəkət təyin olunmayıb» and the loop ended there. Verified on the
 * device — PPL day 3 read «0 hərəkət».
 *
 * These are built from the SAME movements the app's exercise library already
 * holds (src/store/db.ts `exerciseLibrary`), with that library's own rep ranges.
 * Nothing here is a new claim about anybody — it is SPOT's own programming, the
 * way the day titles and focus lines already were.
 *
 * `lastTime` is gone. It carried «80kg × 8» and «45kg × 9» — a previous session
 * for somebody who has never trained. The session screen reads the real previous
 * set out of the user's own history and shows «—» when there is none, so the
 * field was a fabrication that survived only because nothing rendered it.
 */
export const pushExercises: Exercise[] = [
  { id: 'bench', name: 'Ştanqla bench press', muscle: 'Sinə', sets: 4, reps: '6–8', commonMistake: 'Dirsəkləri həddən artıq açmaq — çiyinə yük düşür.', substitutes: ['Maili dumbbell press', 'Maşında press'] },
  { id: 'ohp', name: 'Ştanqla çiyin press', muscle: 'Çiyin', sets: 3, reps: '6–8', commonMistake: 'Beli aşırı əymək — qarını sıx, qabırğanı aşağı saxla.', substitutes: ['Dumbbell çiyin press'] },
  { id: 'incline', name: 'Maili dumbbell press', muscle: 'Sinə', sets: 3, reps: '8–10', commonMistake: 'Skamyanı çox dik qoymaq — yük sinədən çiyinə keçir.', substitutes: ['Ştanqla maili press'] },
  { id: 'lateral', name: 'Yan qaldırma (lateral raise)', muscle: 'Çiyin', sets: 3, reps: '12–15', commonMistake: 'Çəkini yellətmək — yüngül götür, nəzarətlə qaldır.', substitutes: ['Kabellə yan qaldırma'] },
  { id: 'dips', name: 'Paralel dips', muscle: 'Triseps', sets: 3, reps: '8–12', commonMistake: 'Çox aşağı enmək — çiyini incidir.', substitutes: ['Triseps pushdown'] },
  { id: 'pushdown', name: 'Triseps pushdown', muscle: 'Triseps', sets: 3, reps: '10–12', commonMistake: 'Dirsəyi bədəndən ayırmaq — yalnız said hərəkət etməlidir.', substitutes: ['Paralel dips'] },
];

export const pullExercises: Exercise[] = [
  { id: 'deadlift', name: 'Deadlift', muscle: 'Kürək', sets: 3, reps: '3–5', commonMistake: 'Beli yumrulamaq — sinəni aç, ştanqı bədənə yaxın apar.', substitutes: ['Romanian deadlift'] },
  { id: 'pullup', name: 'Dartılma (pull-up)', muscle: 'Kürək', sets: 3, reps: '6–10', commonMistake: 'Yarımçıq enmək — hər təkrarda qolu tam aç.', substitutes: ['Lat pulldown'] },
  { id: 'row', name: 'Ştanqla dartma (row)', muscle: 'Kürək', sets: 4, reps: '8–10', commonMistake: 'Gövdəni yellətmək — bel sabit, hərəkəti kürək etsin.', substitutes: ['Dumbbell row', 'Maşında row'] },
  { id: 'lat', name: 'Lat pulldown', muscle: 'Kürək', sets: 3, reps: '10–12', commonMistake: 'Ştanqı boynun arxasına endirmək.', substitutes: ['Dartılma (pull-up)'] },
  { id: 'curl', name: 'Dumbbell biseps curl', muscle: 'Biseps', sets: 3, reps: '10–12', commonMistake: 'Dirsəyi irəli aparmaq — çiyin işə qarışır.', substitutes: ['Ştanqla curl'] },
];

export const legExercises: Exercise[] = [
  { id: 'squat', name: 'Ştanqla skvat', muscle: 'Ayaq', sets: 4, reps: '5–6', commonMistake: 'Dizi içəri buraxmaq — dizi ayaq barmağı istiqamətində saxla.', substitutes: ['Leg press', 'Goblet skvat'] },
  { id: 'rdl', name: 'Romanian deadlift', muscle: 'Arxa ayaq', sets: 3, reps: '8–10', commonMistake: 'Dizi çox bükmək — hərəkət ombadan gəlməlidir.', substitutes: ['Leg curl'] },
  { id: 'legpress', name: 'Leg press', muscle: 'Ayaq', sets: 3, reps: '10–12', commonMistake: 'Beli oturacaqdan qaldırmaq — çox aşağı enmə.', substitutes: ['Ştanqla skvat'] },
  { id: 'legcurl', name: 'Leg curl', muscle: 'Arxa ayaq', sets: 3, reps: '10–12', commonMistake: 'Ombanı qaldırmaq — bədəni maşına yapışdır.', substitutes: ['Romanian deadlift'] },
  { id: 'hip', name: 'Hip thrust', muscle: 'Gluteus', sets: 3, reps: '8–12', commonMistake: 'Yuxarıda beli aşırı əymək — qarını sıx, qabırğanı aşağı saxla.', substitutes: ['Gluteus bridge'] },
  { id: 'calf', name: 'Baldır qaldırma (calf raise)', muscle: 'Baldır', sets: 4, reps: '12–15', commonMistake: 'Sıçramaq — yuxarıda saxla, yavaş endir.', substitutes: ['Oturaraq calf raise'] },
];

/** 5x5 — üç əsas hərəkət, hər biri 5 set × 5 təkrar. Protokolun özü budur. */
export const fiveByFive: Exercise[] = [
  { id: 'squat', name: 'Ştanqla skvat', muscle: 'Ayaq', sets: 5, reps: '5', commonMistake: 'Dizi içəri buraxmaq — dizi ayaq barmağı istiqamətində saxla.', substitutes: ['Leg press'] },
  { id: 'bench', name: 'Ştanqla bench press', muscle: 'Sinə', sets: 5, reps: '5', commonMistake: 'Dirsəkləri həddən artıq açmaq — çiyinə yük düşür.', substitutes: ['Maili dumbbell press'] },
  { id: 'row', name: 'Ştanqla dartma (row)', muscle: 'Kürək', sets: 5, reps: '5', commonMistake: 'Gövdəni yellətmək — bel sabit, hərəkəti kürək etsin.', substitutes: ['Lat pulldown'] },
];

/** Evdə, avadanlıqsız — yalnız öz çəkinlə. */
export const homeFullBody: Exercise[] = [
  { id: 'squat', name: 'Öz çəkinlə skvat', muscle: 'Ayaq', sets: 3, reps: '12–15', commonMistake: 'Dabanı yerdən qaldırmaq — çəkini bütün ayağa payla.', substitutes: ['Stula oturub-durmaq'] },
  { id: 'dips', name: 'Yerdən press (push-up)', muscle: 'Sinə', sets: 3, reps: '8–15', commonMistake: 'Beli sallamaq — bədən düz xətt olsun.', substitutes: ['Dizüstü push-up'] },
  { id: 'hip', name: 'Gluteus bridge', muscle: 'Gluteus', sets: 3, reps: '12–15', commonMistake: 'Yalnız beli qaldırmaq — hərəkəti gluteus etsin.', substitutes: ['Hip thrust'] },
  { id: 'plank', name: 'Plank', muscle: 'Qarın', sets: 3, reps: '45 san', commonMistake: 'Ombanı yuxarı qaldırmaq — çiyin, omba, daban bir xətdə.', substitutes: ['Dizüstü plank'] },
];

export const homeCardioCore: Exercise[] = [
  { id: 'run', name: 'Yerində qaçış', muscle: 'Kardio', sets: 4, reps: '60 san', commonMistake: 'Dabanla yerə düşmək — pəncə üstündə yüngül qal.', substitutes: ['Jumping jack'] },
  { id: 'plank', name: 'Plank', muscle: 'Qarın', sets: 3, reps: '45 san', commonMistake: 'Ombanı yuxarı qaldırmaq.', substitutes: ['Dizüstü plank'] },
  { id: 'mountain', name: 'Dağ dırmaşması (mountain climber)', muscle: 'Qarın', sets: 3, reps: '30 san', commonMistake: 'Ombanı yuxarı atmaq — bel düz qalsın.', substitutes: ['Plank'] },
  { id: 'calf', name: 'Baldır qaldırma (calf raise)', muscle: 'Baldır', sets: 3, reps: '15–20', commonMistake: 'Sıçramaq.', substitutes: ['Pilləkəndə calf raise'] },
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
      { title: 'Gün 2 · Pull', focus: 'Kürək, biseps', exercises: pullExercises },
      { title: 'Gün 3 · Legs', focus: 'Ayaq, gluteus', exercises: legExercises },
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
      { title: 'Gün 1 · Tam bədən', focus: 'Bütün əzələ qrupları', exercises: homeFullBody },
      { title: 'Gün 2 · Kardio + core', focus: 'Ürək-damar, qarın', exercises: homeCardioCore },
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
    days: [{ title: 'Gün 1 · HIIT', focus: 'Yüksək intensivlik', exercises: homeCardioCore }],
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
    days: [{ title: 'Gün A', focus: 'Skvat, bench, dartma', exercises: fiveByFive }],
  },
];

// ---- accessors ----
/* `getGym` is gone with the seed rows. A gym is looked up through
   `gymById()` (src/store/db.ts), which reads the real catalogue cache. */
export const getTrainer = (id: string) => trainers.find((t) => t.id === id);
export const getPartner = (id: string) => partners.find((p) => p.id === id);
export const getProgram = (id: string) => programs.find((p) => p.id === id);
export const trainersForGym = (gymId: string) => trainers.filter((t) => t.gymId === gymId);
export const partnersForGym = (gymId: string) => partners.filter((p) => p.gymId === gymId);
export const partnersHereNow = (gymId: string) => partnersForGym(gymId).filter((p) => p.hereNow);

export const HERO_GYM_ID = 'iron-bay';
