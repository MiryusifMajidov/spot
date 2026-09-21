/**
 * Three languages: Azerbaijani, Russian, English.
 *
 * WHY THE AZERBAIJANI TEXT IS THE KEY.
 *
 * The usual arrangement is `t('workout.start')` with every language in a
 * dictionary. That is wrong for this app, for one reason that outranks the
 * rest: there are ~1680 strings already written in Azerbaijani, inline, across
 * a hundred files. Inventing 1680 key names is 1680 chances to mislabel one —
 * and a mislabelled key does not fail loudly, it shows the wrong sentence.
 *
 * So the Azerbaijani IS the key. `t('Məşqə başla')` looks up a Russian and an
 * English translation, and when one is missing it returns the Azerbaijani. That
 * fallback is the whole argument: the worst case is exactly what the app shows
 * today. No screen can ever render `workout.start` at a user, which is the
 * failure mode that makes key-based i18n embarrassing in production.
 *
 * It also keeps this honest in the project's own terms: a missing translation
 * is a visible absence in a language the user may not read, never a fabricated
 * sentence and never a blank.
 *
 * COST, stated plainly: editing the Azerbaijani copy orphans its translations.
 * `npm run i18n:check` (scripts/check_i18n.py) lists every source string with no
 * entry, so an orphan is found by running it, not by a user finding it.
 */
import { getLocales } from 'expo-localization';

export const LANGS = ['az', 'ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

/** What the picker shows. Each name is written in its OWN language — a Russian
 *  speaker looking for their language should not have to read Azerbaijani to
 *  find it. */
export const LANG_NAMES: Record<Lang, string> = {
  az: 'Azərbaycanca',
  ru: 'Русский',
  en: 'English',
};

/** Russian nouns after a numeral take three forms. Azerbaijani takes one and
 *  English two, so the dictionary carries an object only where it matters. */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

export type Entry = string | PluralForms;
export type Dict = Record<string, Entry>;

/** Substituted into `{name}` placeholders. `count` additionally selects a
 *  plural form when the entry has one. */
export type Vars = Record<string, string | number>;

const dicts: Partial<Record<Lang, Dict>> = {};

export function registerDict(lang: Lang, dict: Dict) {
  dicts[lang] = { ...(dicts[lang] ?? {}), ...dict };
}

/* The current language, held outside React so `t()` works in a toast, an API
   error handler or a store action — places with no component around them. The
   store owns the persisted value and pushes it here (see appStore.setLang). */
let current: Lang = 'az';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function applyLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  listeners.forEach((fn) => fn());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The device's language, when SPOT speaks it. Anything else gets Azerbaijani —
 *  this is an Azerbaijani app first, and a French phone should not land in
 *  English by accident. */
export function deviceLang(): Lang {
  try {
    for (const l of getLocales()) {
      const code = (l.languageCode ?? '').toLowerCase();
      if ((LANGS as readonly string[]).includes(code)) return code as Lang;
    }
  } catch {
    /* getLocales can throw before the native module is ready */
  }
  return 'az';
}

/** Russian: 1, 21, 31 → one; 2-4, 22-24 → few; 0, 5-20, 11-14 → many. */
function ruForm(n: number): keyof PluralForms {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

function pick(entry: PluralForms, lang: Lang, count: number): string {
  if (lang === 'ru') {
    const form = ruForm(count);
    return entry[form] ?? entry.other;
  }
  if (lang === 'en') return Math.abs(count) === 1 ? entry.one : entry.other;
  // Azerbaijani does not inflect a noun after a numeral: «1 müəllim», «5 müəllim».
  return entry.other;
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

/**
 * Translate one Azerbaijani source string.
 *
 * Inside a component use `const t = useT()` so the screen re-renders when the
 * language changes; everywhere else import `t` directly.
 */
export function t(source: string, vars?: Vars): string {
  const entry = dicts[current]?.[source];
  if (entry === undefined) {
    // No translation: the Azerbaijani source, which is what this app has always
    // shown. Placeholders still get filled, so a half-translated build renders
    // real sentences rather than «{n} müəllim».
    return fill(source, vars);
  }
  if (typeof entry === 'string') return fill(entry, vars);
  const count = typeof vars?.count === 'number' ? vars.count : 0;
  return fill(pick(entry, current, count), vars);
}

/** True when this string has a translation in the active language. For the
 *  places that need to KNOW (a legal document must not silently serve
 *  Azerbaijani to a Russian reader without saying so). */
export function hasTranslation(source: string): boolean {
  return dicts[current]?.[source] !== undefined;
}
