import { deleteMyPRAt, deleteMyWorkout } from '@/lib/api';
import { bestsInWorkout } from '@/lib/lifts';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb, type Workout } from '@/store/db';

/**
 * Delete one logged workout — from the server first, from the device second.
 *
 * Until now nothing in SPOT could remove a session. A weight typed as 720
 * instead of 72 stayed in the history for good, kept inflating the volume on
 * the profile, and — if it beat the previous best — left behind a personal
 * record no workout the person recognises stands behind.
 *
 * The order is not a detail. Removing the local copy first and hoping the
 * server follows is how a deleted row comes back: `trainingSync` uploads any
 * local workout the server does not have, and it would have re-uploaded this
 * one on the next launch with nothing on screen to explain the resurrection.
 * The same mistake was fixed once already in the match-request list. So: the
 * server row goes, its record goes, and only then does the device forget.
 *
 * A workout that never reached the server (no uuid, or no server configured at
 * all) is local-only and is simply forgotten.
 */
export type RemoveResult = { ok: true; prsRemoved: number } | { ok: false; reason: 'server' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function removeWorkout(w: Workout): Promise<RemoveResult> {
  const onServer = hasSupabaseConfig && UUID.test(w.id);

  let prsRemoved = 0;
  if (onServer) {
    try {
      await deleteMyWorkout(w.id);
    } catch {
      // Nothing local is touched. The workout is still there, on both sides,
      // and the caller says so rather than showing a list it cannot back up.
      return { ok: false, reason: 'server' };
    }

    /* The record this workout wrote, if it wrote one. A failure here is NOT
       failure of the deletion: the workout is already gone, and reporting the
       whole thing as failed would invite a retry that deletes nothing and
       confuses the person about what actually happened. `prsRemoved` is what
       the caller may state — never a number it guessed. */
    for (const { lift, value } of bestsInWorkout(w)) {
      try {
        prsRemoved += await deleteMyPRAt(lift, value, w.at);
      } catch {
        /* left in place; the profile keeps showing it until it is beaten */
      }
    }
  }

  useDb.getState().forgetWorkout(w.id);
  return { ok: true, prsRemoved };
}
