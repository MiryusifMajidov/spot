/**
 * One training history, not two (F-09).
 *
 * `logWorkout`, `logPR` and `logWeight` wrote to the server and nothing ever
 * read them back: `getMyStats`, `getMyWeekStats`, `getMyPRs`, `getLatestWeight`
 * and `getMyPartnerCount` were called from nowhere, and every number on screen
 * came from `useDb` alone. So the profile said «0 məşq» about an account the
 * server knew had two, and a reinstall — or the anonymous-auth identity change
 * that this project has already produced five times — took the whole history
 * with it.
 *
 * Now the two are the same history, joined by a shared id (src/lib/ids.ts).
 *
 * WHAT THE SERVER CAN AND CANNOT GIVE BACK. `workouts` stores the summary:
 * title, duration, volume, set count, RPE. The per-set detail — which exercise,
 * which weight, which reps — is NOT sent up, on purpose: it is the private
 * training data the privacy rule keeps off every other surface. So a workout
 * restored from the server comes back marked `summaryOnly`, with its real
 * `setsDone` and an empty `exercises`. The count, the volume and the streak are
 * right; progressive overload and muscle-group volume skip those rows, because
 * suggesting a next weight from a workout whose sets we do not have would be a
 * guess dressed as a recommendation.
 */
import { getMyPRs, getMyProfile, getMyProgress, getMyWorkouts, logWeight, logWorkout } from './api';
import { isUuid, newId } from './ids';
import { myChallenges, myFollowing } from './social';
import { hasSupabaseConfig, supabase } from './supabase';
import { setExerciseVideos, useDb, type CheckIn, type Workout } from '@/store/db';

/**
 * The user's OWN check-ins, back from the server.
 *
 * `computeStreak` builds its day set from check-ins AND workouts, so somebody
 * who keeps a streak by checking in on cardio days rather than logging a
 * workout lost the whole flame on a new phone: the rows were all still in
 * `check_ins`, and nothing read them.
 *
 * `profile_id = me` is not optional. `check_ins_read` (schema48) also exposes
 * OTHER people's live «indi zalda» rows, so an unfiltered select would fold
 * strangers' visits into this person's streak.
 *
 * A failed read returns nothing and the device keeps what it has — an empty
 * array here would be «you have never checked in», which is a different claim.
 */
async function myCheckIns(): Promise<CheckIn[]> {
  const me = await getMyProfile();
  if (!me?.id) return [];
  const { data, error } = await supabase
    .from('check_ins')
    .select('id,gym_id,created_at')
    .eq('profile_id', me.id)
    .order('created_at', { ascending: false });
  if (error) return [];
  return ((data ?? []) as { id: string; gym_id: string; created_at: string | null }[])
    .filter((r) => !!r.created_at)
    .map((r) => ({ id: r.id, gymId: r.gym_id, at: r.created_at as string }));
}

/** Pull the server's history into the device engine. Additive: a row the device
 *  already has (same id) keeps its local copy, which is the richer one. */
export async function pullTrainingHistory(): Promise<void> {
  if (!hasSupabaseConfig) return;
  const [serverWorkouts, serverWeights, serverPRs, serverCheckIns] = await Promise.all([
    getMyWorkouts(), getMyProgress(), getMyPRs(), myCheckIns(),
  ]);

  // Records set on a device whose sets never left it — see `computeStats`.
  useDb.getState().setServerPRs(
    serverPRs.map((r) => ({ lift: r.lift, value: r.value, delta: r.delta ?? undefined }))
  );

  const workouts: Workout[] = serverWorkouts.map((w) => ({
    id: w.id,
    at: w.at,
    title: w.title,
    programId: w.programId ?? undefined,
    exercises: [],
    volumeKg: w.volumeKg,
    durationMin: w.durationMin,
    setsDone: w.setsDone,
    summaryOnly: true,
    rpe: w.rpe === 'Asan' ? 0 : w.rpe === 'Ağır' ? 2 : w.rpe === 'Normal' ? 1 : undefined,
  }));

  useDb.getState().mergeFromServer({
    workouts,
    weights: serverWeights.map((p) => ({ id: p.id, at: p.at, kg: p.kg })),
    checkIns: serverCheckIns,
  });
}

/**
 * Push anything the device has that the server does not.
 *
 * This is what rescues the history written before the ids were shared: those
 * rows carry `w-1756…` ids the `uuid` columns cannot hold, so they go up under a
 * fresh id and the local row is renamed to match. It runs once per launch and is
 * cheap after that, because an id present on both sides is skipped.
 */
export async function pushLocalHistory(): Promise<void> {
  if (!hasSupabaseConfig) return;
  const [serverWorkouts, serverWeights] = await Promise.all([getMyWorkouts(), getMyProgress()]);
  const haveW = new Set(serverWorkouts.map((w) => w.id));
  const haveP = new Set(serverWeights.map((p) => p.id));

  /* Content keys, not just ids. A workout written before the ids were shared has
     a local `w-<ms>` id and a server-generated UUID for the same session, so an
     id check alone said «the server does not have this» and uploaded a duplicate
     on every launch. The pair shares its timestamp; that is the join. */
  const wKey = (at: string, title: string, volumeKg: number) =>
    `${new Date(at).setMilliseconds(0)}|${title}|${Math.round(volumeKg)}`;
  const pKey = (at: string, kg: number) => `${new Date(at).setMilliseconds(0)}|${Math.round(kg * 10)}`;
  const haveWContent = new Set(serverWorkouts.map((w) => wKey(w.at, w.title, w.volumeKg)));
  const havePContent = new Set(serverWeights.map((p) => pKey(p.at, p.kg)));

  const db = useDb.getState();

  for (const w of db.workouts) {
    if (w.summaryOnly) continue;            // came FROM the server
    if (isUuid(w.id) && haveW.has(w.id)) continue;
    if (haveWContent.has(wKey(w.at, w.title, w.volumeKg))) continue;
    const id = isUuid(w.id) ? w.id : newId();
    const setsDone = w.setsDone ?? w.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);
    try {
      await logWorkout({
        id,
        at: w.at,
        title: w.title,
        programId: w.programId ?? null,
        durationSec: Math.round((w.durationMin ?? 0) * 60),
        volumeKg: w.volumeKg,
        setsDone,
        rpe: w.rpe === 0 ? 'Asan' : w.rpe === 2 ? 'Ağır' : w.rpe === 1 ? 'Normal' : undefined,
      });
      if (id !== w.id) useDb.getState().renameWorkout(w.id, id);
    } catch {
      // One failure must not stop the rest — the next launch tries again.
    }
  }

  for (const p of db.weights) {
    if (p.id && haveP.has(p.id)) continue;
    if (havePContent.has(pKey(p.at, p.kg))) continue;
    const id = p.id && isUuid(p.id) ? p.id : newId();
    try {
      await logWeight(p.kg, id, p.at);
      if (id !== p.id) useDb.getState().renameWeight(p.at, id);
    } catch {
      /* retried next launch */
    }
  }
}

/** Called once at start-up: bring the device up to date, then hand up whatever
 *  only it knows. Never throws — a sync failure must not affect the app. */
export async function syncTrainingHistory(): Promise<void> {
  /* PUSH FIRST. The push renames a legacy local row to the UUID the server
     accepted, so the pull that follows can match it by id and adds nothing. The
     other order — pull, then push — is what doubled the history: the pull could
     not recognise the local copy, and the push then could not recognise the
     server copy. Both halves also compare content now, so the order is a
     belt-and-braces matter rather than the only defence. */
  try {
    await pushLocalHistory();
  } catch {
    /* retried next launch */
  }
  try {
    await pullTrainingHistory();
  } catch {
    /* the device history is still shown; it is simply not enriched yet */
  }
}

/**
 * Bring the social state in from the server too (F-19).
 *
 * Likes, follows and challenge membership used to be device-only, so they
 * differed on every phone and vanished on reinstall. The store keys are kept as
 * they are (`video:<id>`, `post:<id>`) — the screens read them directly — but
 * their CONTENTS now come from `video_likes`, `post_likes`, `follows` and
 * `challenge_members`.
 *
 * Replaces rather than merges: the server is the authority here. A follow this
 * device recorded but never managed to send is not a follow anybody received.
 *
 * Returns the data instead of writing it, so this module never imports
 * `appStore` — which imports this one. That cycle would leave `useAppStore`
 * undefined at module-eval time and take the whole app down at the first render.
 */
export async function syncSocial(): Promise<{ following: string[]; joinedChallenges: string[] } | null> {
  if (!hasSupabaseConfig) return null;
  try {
    const [following, challenges] = await Promise.all([myFollowing(), myChallenges()]);
    return { following: [...following], joinedChallenges: [...challenges] };
  } catch {
    // The device copy stays; it is simply not confirmed yet.
    return null;
  }
}

/**
 * Which movements have technique footage.
 *
 * Reads only `id` and `video_url` — the rest of the exercise (name, reps, the
 * common mistake) is app content and ships with the build. Keeping the video as
 * DATA means a clip added tomorrow shows up without an app release, which is the
 * difference between «one release per video» and «upload and it is live».
 *
 * A failure leaves the map empty, and the exercise screen already draws that
 * honestly: no player, no black rectangle, just the sets, the mistake and the
 * substitutes.
 */
export async function loadExerciseVideos(): Promise<void> {
  if (!hasSupabaseConfig) return;
  try {
    const { data, error } = await supabase.from('exercises').select('id,video_url').not('video_url', 'is', null);
    if (error) return;
    setExerciseVideos((data ?? []) as { id: string; video_url: string | null }[]);
  } catch {
    /* no footage this launch */
  }
}
