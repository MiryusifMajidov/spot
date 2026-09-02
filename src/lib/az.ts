/**
 * Azerbaijani text handling.
 *
 * JavaScript's default `toLowerCase()` is wrong for this alphabet in both
 * directions, and both errors were live in the app:
 *
 *   'İrəli'.toLowerCase()               → 'i̇rəli'   (i + U+0307, a stray dot)
 *   'Iron Bay'.toLocaleLowerCase('az')  → 'ıron bay' (dotless ı — correct for
 *                                                     Azerbaijani, fatal for a
 *                                                     gym with an English name)
 *
 * The first put «i̇rəli səviyyə» on the profile screen. The second meant the Kəşf
 * search could not find «Iron Bay» when you typed `iron` — the locale did its
 * job and the search paid for it.
 *
 * So the two jobs are separated:
 *   · `azLower`   — real Azerbaijani lowercase. For display, and for comparing
 *                   against a known Azerbaijani literal.
 *   · `searchKey` — a deliberately lossy fold for MATCHING only. Never shown.
 */

/** Correct Azerbaijani lowercase: İ→i, I→ı, everything else as the locale says. */
export function azLower(s: string | null | undefined): string {
  return (s ?? '').toLocaleLowerCase('az');
}

/** Diacritics → their bare ASCII neighbour, as Azerbaijanis actually type them
 *  on a keyboard without the letters: «nə cür» is typed «ne cur». */
const FOLD: Record<string, string> = {
  ə: 'e', ö: 'o', ü: 'u', ğ: 'g', ş: 's', ç: 'c', ı: 'i',
};

/**
 * A comparison key for search. Both the needle and the haystack must go
 * through it, so the fold can be as aggressive as it likes.
 *
 * It removes the whole dotted/dotless-i problem by collapsing all four forms
 * (İ i I ı) onto plain `i`, strips the combining dot the default lowercase
 * leaves behind, and folds the Azerbaijani diacritics onto ASCII. The result:
 * `iron` finds «Iron Bay», `irəli` and `ireli` both find «İrəli», and `nerimanov`
 * finds «Nərimanov».
 *
 * Over-matching is the intended trade: in a search box, showing one row too many
 * costs the user a glance; hiding the row they are looking for costs them the
 * feature.
 */
export function searchKey(s: string | null | undefined): string {
  return azLower(s)
    .normalize('NFD')
    .replace(/̇/g, '') // combining dot above, left by a non-az lowercase
    .normalize('NFC')
    .split('')
    .map((ch) => FOLD[ch] ?? ch)
    .join('');
}
