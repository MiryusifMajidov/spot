import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';


import { SessionRestoreError, ensureSession, getMatchRequestsSafe, getMyProfile, getUserId, isUsernameConflict, touchLastActive, updateMyProfile, sanctionOf } from '@/lib/api';
import { getMyGymId } from '@/lib/roles';
import { useDb } from '@/store/db';
import { hasSupabaseConfig } from '@/lib/supabase';
import { syncTrainingHistory } from '@/lib/trainingSync';

export interface Profile {
  name: string;
  /** Public handle shown as «@ad». null = this profile predates handles / has none. */
  username: string | null;
  gender: 'kişi' | 'qadın' | '';
  /** null = not given. NEVER render a missing age as 0 — the partner rows read
   *  «Aysel, 0» for every real user because nothing ever collected it. */
  age: number | null;
  homeGymId: string | null;
  goals: string[];
  level: string;
  types: string[];
  days: number[]; // indexes into DAYS
  timeSlot: string;
  bio: string;
  role: 'user' | 'trainer';
  specialty: string;
  priceFrom: number | null;
}

interface AppState {
  hydrated: boolean; // persisted store rehydrated
  ready: boolean; // supabase session bootstrapped
  onboarded: boolean;
  guest: boolean; // browsing without an account (read-only catalog)
  profile: Profile;
  activeMode: 'user' | 'trainer' | 'gym_admin'; // which account/panel the app shows
  ownsGym: boolean; // has a gym account (can switch to the gym panel)
  bookmarks: string[]; // gym ids
  savedVideos: string[]; // feed video ids
  following: string[]; // creator names the user follows
  likedPosts: string[]; // community post ids liked
  joinedChallenges: string[]; // challenge ids joined
  visibility: 'match-only' | 'everyone'; // who can message
  showInGymList: boolean;
  blocked: string[]; // partner/trainer ids this user blocked — filtered out everywhere
  haptics: boolean;  // vibration feedback on taps
  sounds: boolean;   // short UI sounds on taps/success
  /** Why the last saveProfile() returned 'failed'. Lets the screen name the real
   *  reason — a taken handle must never be reported as a connection problem. */
  lastSaveError: 'username-taken' | null;

  setProfile: (patch: Partial<Profile>) => void;
  setMode: (mode: 'user' | 'trainer' | 'gym_admin') => void;
  setOwnsGym: (v: boolean) => void;
  setPrivacy: (patch: { visibility?: 'match-only' | 'everyone'; showInGymList?: boolean }) => void;
  toggleBookmark: (gymId: string) => void;
  toggleSavedVideo: (id: string) => void;
  toggleFollow: (name: string) => void;
  toggleLikedPost: (id: string) => void;
  joinChallenge: (id: string) => void;
  toggleBlocked: (id: string) => void;
  setFeedback: (patch: { haptics?: boolean; sounds?: boolean }) => void;
  isBlocked: (id: string) => boolean;
  enterGuest: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  setHydrated: () => void;
  /** My own `profiles.id`. This is the identity everything else is keyed on —
   *  post/video ownership, owner_id FKs, RLS. It is NOT the auth uid. */
  profileId: string | null;
  /** A live moderation sanction on this account, or null. Mirrors
   *  `public.is_sanctioned()` — the database is what actually blocks the writes;
   *  this exists so the app can SAY why instead of failing silently. */
  sanction: { status: 'muted' | 'suspended' | 'banned'; until: Date | null } | null;
  /** This device holds an account whose session would not restore. The app runs
   *  as a guest, and the banner says why rather than looking empty. */
  sessionLost: boolean;
  bootstrap: () => Promise<void>;
  saveProfile: () => Promise<'saved' | 'local' | 'failed'>;
}

function toDbPatch(p: Profile) {
  // NOTE: role/specialty/price_from are written separately (see api.becomeTrainer) so
  // that base profile saves keep working even before schema3.sql adds those columns.
  const username = p.username?.trim();
  return {
    name: p.name,
    // Only written when we actually have one. A null here would wipe the handle the
    // migration back-filled for an existing user whose profile has not loaded yet.
    ...(username ? { username } : {}),
    gender: p.gender || null,
    age: p.age,
    home_gym_id: p.homeGymId,
    level: p.level,
    goals: p.goals,
    types: p.types,
    time_slot: p.timeSlot,
    bio: p.bio,
  };
}

const emptyProfile: Profile = {
  name: '',
  username: null,
  gender: '',
  age: null,
  // No gym until the person actually picks one — never claim a gym on their behalf.
  homeGymId: null,
  goals: [],
  level: 'Orta',
  types: [],
  days: [0, 2, 4],
  timeSlot: 'Axşam 17–21',
  bio: '',
  role: 'user',
  specialty: '',
  priceFrom: null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      ready: false,
      onboarded: false,
      profileId: null,
      sanction: null,
      sessionLost: false,
      guest: false,
      profile: emptyProfile,
      activeMode: 'user',
      ownsGym: false,
      bookmarks: [],
      savedVideos: [],
      following: [],
      likedPosts: [],
      joinedChallenges: [],
      visibility: 'match-only',
      showInGymList: true,
      blocked: [],
      haptics: true,
      sounds: false,
      lastSaveError: null,

      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      setMode: (mode) => set({ activeMode: mode }),
      setOwnsGym: (v) => set({ ownsGym: v }),
      setPrivacy: (patch) => set(() => ({ ...patch })),
      toggleBookmark: (gymId) =>
        set((s) => ({
          bookmarks: s.bookmarks.includes(gymId)
            ? s.bookmarks.filter((id) => id !== gymId)
            : [...s.bookmarks, gymId],
        })),
      toggleSavedVideo: (id) =>
        set((s) => ({
          savedVideos: s.savedVideos.includes(id) ? s.savedVideos.filter((x) => x !== id) : [...s.savedVideos, id],
        })),
      toggleFollow: (name) =>
        set((s) => ({
          following: s.following.includes(name) ? s.following.filter((x) => x !== name) : [...s.following, name],
        })),
      toggleLikedPost: (id) =>
        set((s) => ({
          likedPosts: s.likedPosts.includes(id) ? s.likedPosts.filter((x) => x !== id) : [...s.likedPosts, id],
        })),
      joinChallenge: (id) =>
        set((s) => (s.joinedChallenges.includes(id) ? s : { joinedChallenges: [...s.joinedChallenges, id] })),
      toggleBlocked: (id) =>
        set((s) => ({ blocked: s.blocked.includes(id) ? s.blocked.filter((x) => x !== id) : [...s.blocked, id] })),
      isBlocked: (id) => get().blocked.includes(id),
      setFeedback: (patch) => set(() => ({ ...patch })),
      enterGuest: () => set({ guest: true }),
      completeOnboarding: () => set({ onboarded: true, guest: false }),
      /** `profileId` goes with the profile. Keeping the old id after a reset (and
       *  «Datanı bu cihazdan sil» goes through here) made the previous person's
       *  videos and creator page render as the new identity's own — bootstrap()
       *  or the next saveProfile() puts back whichever id is really ours. */
      resetOnboarding: () => set({ onboarded: false, guest: false, profile: emptyProfile, profileId: null }),
      setHydrated: () => set({ hydrated: true }),

      bootstrap: async () => {
        if (!hasSupabaseConfig) {
          set({ ready: true });
          return;
        }
        // Never let a slow/hanging network keep the app on the splash screen.
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
        try {
          await Promise.race([ensureSession(), timeout]);
        } catch (e) {
          console.warn('[bootstrap] session', e);
          // The account exists on this device but did not come back. Say so —
          // dropping into guest mode with no explanation reads as «boş tətbiq».
          if (e instanceof SessionRestoreError) set({ sessionLost: true });
        }
        set({ ready: true });
        // «Son aktiv» — one stamp per launch. Deliberately not awaited and
        // deliberately swallowed: nothing the user sees depends on it.
        void touchLastActive().catch(() => {});
        // Bring the device's partner-request state back in line with the server.
        // Guarded inside `getMatchRequestsSafe`: on a read failure nothing is
        // reconciled, because an empty result would erase real local records.
        // One training history, not two: pull what the server holds, then hand
        // up whatever only this device knows (src/lib/trainingSync.ts).
        void syncTrainingHistory();
        void getMatchRequestsSafe().then((rows) => {
          if (rows) useDb.getState().reconcileMatches(rows);
        });
        // Load the profile in the background — it must not block app start.
        try {
          const db = await getMyProfile();
          if (db) {
            set((s) => ({
              profileId: db.id,
              sanction: sanctionOf(db),
              // The server is the authority on the privacy flags: a reinstall must not
              // push this device's defaults back over what the user actually chose.
              visibility: (db.visibility as AppState['visibility']) ?? s.visibility,
              showInGymList: db.show_in_gym_list ?? s.showInGymList,
              profile: {
                ...s.profile,
                name: db.name ?? s.profile.name,
                username: db.username ?? s.profile.username,
                gender: (db.gender as Profile['gender']) ?? s.profile.gender,
                age: db.age ?? s.profile.age,
                homeGymId: db.home_gym_id ?? s.profile.homeGymId,
                level: db.level ?? s.profile.level,
                goals: db.goals ?? s.profile.goals,
                types: db.types ?? s.profile.types,
                timeSlot: db.time_slot ?? s.profile.timeSlot,
                bio: db.bio ?? s.profile.bio,
                role: (db.role as Profile['role']) ?? s.profile.role,
                specialty: db.specialty ?? s.profile.specialty,
                priceFrom: db.price_from ?? s.profile.priceFrom,
              },
            }));
          } else {
            // A live session with no profiles row: whatever id survived from the
            // last install/account is provably not ours, and leaving it in place
            // would mark a stranger's videos as «mənim». A failed read throws
            // instead of returning null, so this never fires on a bad connection.
            const uid = await getUserId();
            if (uid && get().profileId) set({ profileId: null });
          }
        } catch (e) {
          console.warn('[bootstrap] profile', e);
        }
        // Gym ownership is a SERVER fact (gyms.owner_id), not a device fact. Without
        // this, a reinstall / second device leaves ownsGym=false and the account
        // switcher silently drops «Zal hesabı» from someone who really owns a gym.
        // Only ever raise it here: getMyGymId() throws on a read failure and returns
        // null only for a genuine "no gym", so a bad connection cannot hide the
        // account either.
        try {
          if (await getMyGymId()) set({ ownsGym: true });
        } catch (e) {
          console.warn('[bootstrap] gym', e);
        }
      },

      /** Returns what actually happened so the caller can tell the truth:
       *  'saved'  — written to the server
       *  'local'  — kept on this device only (no backend / nothing to send)
       *  'failed' — the server rejected it; the caller must NOT claim success. */
      saveProfile: async () => {
        set({ lastSaveError: null });
        // Don't persist an empty placeholder profile — it would pollute the partner pool.
        if (!get().profile.name.trim()) return 'local';

        /* Having a named profile IS no longer being a guest. Without this a person
           could fill in their name, gym, level and goals, tap «Yadda saxla», and
           land back on the «Qonaq rejimi — Profil yarat» card as if they had done
           nothing. It is set before the network call on purpose: the profile is
           real on this device whether or not the server is reachable. */
        if (get().guest || !get().onboarded) set({ guest: false, onboarded: true });

        if (!hasSupabaseConfig) return 'local';
        try {
          // The privacy switches live at store root, not on Profile, so toDbPatch
          // cannot carry them. Without this the choice made on onboarding step 6 was
          // shown as active on the phone while the server kept the default `true`
          // and the gym owner saw the user's real name.
          const s = get();
          const id = await updateMyProfile({
            ...toDbPatch(s.profile),
            visibility: s.visibility,
            show_in_gym_list: s.showInGymList,
          });
          // This upsert is where a first-run user's profiles row is born, and
          // `profileId` is the identity every ownership check is keyed on. Without
          // recording it here the person would be a stranger to their OWN video,
          // post and creator page until the next cold start ran bootstrap().
          if (id) set({ profileId: id });
          return 'saved';
        } catch (e) {
          console.warn('[saveProfile]', e);
          // A handle somebody else already holds is not a network problem, and the
          // save really did NOT happen — the caller must say «tutulub», never 'saved'.
          if (isUsernameConflict(e)) set({ lastSaveError: 'username-taken' });
          return 'failed';
        }
      },
    }),
    {
      name: 'spot-app',
      storage: createJSONStorage(() => AsyncStorage),
      // Deep-merge the persisted profile over defaults so new fields (role, specialty,
      // priceFrom, …) added in later versions are never undefined for existing users.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, profile: { ...current.profile, ...(p.profile ?? {}) } };
      },
      partialize: (s) => ({
        onboarded: s.onboarded,
        profileId: s.profileId,
        guest: s.guest,
        profile: s.profile,
        activeMode: s.activeMode,
        ownsGym: s.ownsGym,
        bookmarks: s.bookmarks,
        savedVideos: s.savedVideos,
        following: s.following,
        likedPosts: s.likedPosts,
        joinedChallenges: s.joinedChallenges,
        visibility: s.visibility,
        showInGymList: s.showInGymList,
        blocked: s.blocked,
        haptics: s.haptics,
        sounds: s.sounds,
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
);
