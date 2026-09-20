/**
 * The trainers SPOT offers a brand-new member (schema75).
 *
 * Which ones appear is an admin decision — `featured_trainers`, set from the
 * panel. When nothing is set, the server shuffles the listed trainers instead,
 * so the screen has real answers on day one instead of an empty box. Not by
 * rating: nothing in SPOT can rate a coach, so every rating is 0 and sorting by
 * it would only freeze the list.
 *
 * The count is NOT guaranteed to be five. The database holds what it holds: ask
 * for five, and if there are two real trainers in the country you get two. The
 * screen shows what came back and says nothing about the rest.
 */
import { isPlaceholderName } from './authorName';
import { supabase } from './supabase';

export interface SuggestedTrainer {
  id: string;
  /** The profile behind the listing — what a follow is keyed on. */
  ownerId: string;
  name: string;
  specialty: string;
  /** 0 means nobody has rated them yet. It is an absence, not a score. */
  rating: number;
  clients: number;
  photoUrl: string | null;
  verified: boolean;
  /** Chosen by an admin, rather than reached by the rating fallback. */
  featured: boolean;
}

type Row = {
  id: string;
  owner_id: string | null;
  name: string | null;
  specialty: string | null;
  rating: number | string | null;
  clients: number | null;
  photo_url: string | null;
  verified: boolean | null;
  featured: boolean | null;
};

/**
 * Throws on a failed read. The caller needs to tell «the server did not answer»
 * apart from «there is nobody to suggest» — the first must never be drawn as
 * the second.
 */
export async function suggestedTrainers(limit = 5): Promise<SuggestedTrainer[]> {
  const { data, error } = await supabase.rpc('suggested_trainers', { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as Row[])
    .filter((r) => !!r.owner_id && !isPlaceholderName(r.name ?? ''))
    .map((r) => ({
      id: String(r.id),
      ownerId: String(r.owner_id),
      name: String(r.name ?? '').trim(),
      specialty: String(r.specialty ?? '').trim(),
      rating: Number(r.rating ?? 0) || 0,
      clients: Number(r.clients ?? 0) || 0,
      photoUrl: r.photo_url ?? null,
      verified: r.verified === true,
      featured: r.featured === true,
    }));
}
