import { deleteMyProgram } from '@/lib/api';
import { invalidateFocusCache, invalidateFocusPrefix } from '@/lib/focusFetch';
import { hasSupabaseConfig } from '@/lib/supabase';
import { useDb } from '@/store/db';

/**
 * Delete a program — from the server first, from the device second.
 *
 * `useDb.deleteProgram` is device-local. On its own it produced the worst kind
 * of delete: «Proqram silindi», the program vanishes from the author's list,
 * and then it is back. `usePrograms()` returns `[...mine, ...remote]` filtered
 * by the ids in `mine` — so the moment the id leaves `myPrograms` the published
 * row stops being filtered out, and the 60-second catalogue cache expiring (or
 * an app restart) puts it straight back in Kitabxana under the author's name.
 * For every other person it never went anywhere at all.
 *
 * Order matters for the same reason it does when deleting a workout: nothing
 * local is touched until the server side is genuinely clear.
 */
export type RemoveProgramResult = { ok: true } | { ok: false; reason: 'server' };

export async function removeProgram(id: string): Promise<RemoveProgramResult> {
  if (hasSupabaseConfig) {
    try {
      await deleteMyProgram(id);
    } catch {
      return { ok: false, reason: 'server' };
    }
  }
  useDb.getState().deleteProgram(id);
  // The library caches its list for a minute; without this the program the
  // person just deleted is still on the shelf when they go back to look.
  invalidateFocusCache('programs');
  invalidateFocusPrefix('program:');
  return { ok: true };
}
