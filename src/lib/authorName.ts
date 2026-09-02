import { azLower } from './az';

/**
 * What to call an author whose profile never got a real name.
 *
 * Anonymous sign-in seeds a profile called «Sən» («You»), and anything posted
 * before the person filled their name in froze that placeholder into the row —
 * so the post, the video and the creator page all read «Sən» to EVERY viewer,
 * as though the reader had written it themselves.
 *
 * A neutral label is the honest reading: we genuinely do not know who this was.
 * Nothing is invented and no name is guessed.
 */
const PLACEHOLDER_NAMES = ['sən', 'sen', 'istifadəçi', 'istifadeci', 'müəllim', 'muellim'];

/** True when the stored name is a placeholder rather than a person's name. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  // azLower, not toLocaleLowerCase(): the default locale turns «İstifadəçi»
  // into «i̇stifadəçi» (i + a combining dot), which matched nothing here.
  return !n || PLACEHOLDER_NAMES.includes(azLower(n));
}

export function displayAuthor(name: string | null | undefined): string {
  return isPlaceholderName(name) ? 'SPOT istifadəçisi' : (name ?? '').trim();
}

/** «Ad, yaş» — but only when the age is actually known.
 *
 *  `Partner.age` is a plain number and the mapper defaults a missing age to 0,
 *  so every real user (nothing collects an age yet) rendered as «Yusif, 0» —
 *  stating that someone is zero years old. 0 means unknown: drop it. */
export function nameWithAge(name: string, age: number | null | undefined): string {
  const shown = displayAuthor(name);
  return age && age > 0 ? `${shown}, ${age}` : shown;
}
