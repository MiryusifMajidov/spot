/**
 * `const t = useT()` — the component-side half of src/lib/i18n.ts.
 *
 * It subscribes the component to language changes AND returns a function whose
 * IDENTITY changes with the language. The second half is not optional.
 *
 * React Compiler is on (app.json experiments.reactCompiler), and it memoises
 * JSX by its inputs: it compiles `<AppText>{t('İş saatları')}</AppText>` into
 * «if ($[19] !== t) { … t('İş saatları') … }». The first version of this hook
 * returned the one module-level `t` every time, so `t` never changed, the cache
 * never invalidated, and a compiled screen kept the OLD language after a switch
 * — re-rendering, but re-rendering the same cached text. A migration agent
 * caught it by compiling HoursField and reading the output.
 *
 * So each language gets its own wrapper, created once and reused: the function
 * is stable while the language stays put (no needless recomputation), and a
 * different object the moment it changes (every `t(…)` block recomputes). The
 * wrapper just calls the module `t`, which reads the current language at call
 * time — by the time the re-render runs, applyLang has already set it.
 *
 * `useSyncExternalStore` because the language lives outside React (a toast
 * fired from an API error handler has no component around it), and this is the
 * sanctioned way to read an external source without tearing.
 */
import { useSyncExternalStore } from 'react';

import * as format from './format';
import { getLang, Lang, subscribeLang, t } from './i18n';

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/* One wrapper per language, created up front for the same reason as below. */
const perLang: Record<Lang, typeof t> = {
  az: (source, vars) => t(source, vars),
  ru: (source, vars) => t(source, vars),
  en: (source, vars) => t(source, vars),
};

export function useT(): typeof t {
  return perLang[useLang()];
}

/**
 * The date/number helpers from ./format, bound to the language the same way.
 *
 * Those helpers read the current language internally, which the compiler
 * cannot see: it compiled `weekdayAndDate(now)` on the Məşq tab behind a
 * one-time sentinel — computed on first render and never again — so the date
 * line would have stayed «Bazar ertəsi» after switching to Russian. Called
 * through this object instead (`fmt.weekdayAndDate(now)`), the call depends on
 * `fmt`, whose identity changes with the language, and it recomputes.
 */
export type Fmt = typeof format;

/* Built once, one object per language, outside any hook: the compiler forbids
   writing a module-level cache from inside a hook body, and there is nothing
   lazy to gain — three shallow copies of a handful of functions. */
const fmtPerLang: Record<Lang, Fmt> = { az: { ...format }, ru: { ...format }, en: { ...format } };

export function useFormat(): Fmt {
  return fmtPerLang[useLang()];
}
