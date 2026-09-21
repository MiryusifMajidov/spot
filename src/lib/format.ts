/**
 * Dates and numbers, in the language the person chose.
 *
 * These were hard-coded Azerbaijani arrays copied into three different screens
 * (`AZ_DAYS`/`AZ_MONTHS` in workout/index.tsx, profile/history.tsx and
 * discover/gym/[id].tsx, in two different capitalisations), plus `timeAgoAz` in
 * the store. A second language turns that from duplication into a bug: one
 * screen would say «Bazar ertəsi» while the one next to it said «Понедельник».
 *
 * Deliberately NOT Intl.DateTimeFormat. Hermes ships without full ICU unless
 * the build opts in, so `toLocaleString('ru')` silently falls back to English
 * on some Android devices — a wrong month name that looks like a translation
 * bug and is not one. Three short tables are smaller than that risk.
 */
import { getLang, t } from './i18n';

const DAYS: Record<string, string[]> = {
  az: ['Bazar', 'Bazar ertəsi', 'Çərşənbə axşamı', 'Çərşənbə', 'Cümə axşamı', 'Cümə', 'Şənbə'],
  ru: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const DAYS_SHORT: Record<string, string[]> = {
  az: ['B', 'B.e', 'Ç.a', 'Ç', 'C.a', 'C', 'Ş'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** Lower case: these appear inside a sentence («21 sentyabr»). */
const MONTHS: Record<string, string[]> = {
  az: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  // Russian dates take the genitive inside «21 сентября», which is what these are.
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

/** Standalone, for a heading like «Sentyabr 2026». Russian differs from the
 *  in-date form above — «сентября 2026» would be wrong as a title. */
const MONTHS_STANDALONE: Record<string, string[]> = {
  az: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const table = (m: Record<string, string[]>) => m[getLang()] ?? m.az;

export const dayName = (i: number) => table(DAYS)[i] ?? '';
export const dayShort = (i: number) => table(DAYS_SHORT)[i] ?? '';
export const monthName = (i: number) => table(MONTHS)[i] ?? '';
export const monthStandalone = (i: number) => table(MONTHS_STANDALONE)[i] ?? '';

/** «21 sentyabr» / «21 сентября» / «21 September». */
export function dayAndMonth(d: Date): string {
  return getLang() === 'en' ? `${monthName(d.getMonth())} ${d.getDate()}` : `${d.getDate()} ${monthName(d.getMonth())}`;
}

/** «Bazar ertəsi, 21 sentyabr» — the Məşq tab's header line. */
export function weekdayAndDate(d: Date): string {
  return `${dayName(d.getDay())}, ${dayAndMonth(d)}`;
}

/** «Sentyabr 2026» — a month heading. */
export const monthAndYear = (month: number, year: number) => `${monthStandalone(month)} ${year}`;

/**
 * The decimal separator. Azerbaijani and Russian write 72,5; English 72.5.
 *
 * This matters for INPUT too — the workout logger already accepts a comma
 * because that is what an Azerbaijani keyboard produces (`parseDecimal`). It
 * must keep accepting both in every language, so only the OUTPUT changes here.
 */
export const decimalSeparator = () => (getLang() === 'en' ? '.' : ',');

/** A number with the language's decimal mark. */
export function decimal(n: number, digits = 1): string {
  const s = n.toFixed(digits);
  return getLang() === 'en' ? s : s.replace('.', ',');
}

/** Trailing «,0» removed — 72,5 kq but 70 kq, not 70,0 kq. */
export function weight(n: number): string {
  return Number.isInteger(n) ? String(n) : decimal(n, 1);
}

/**
 * How long ago, short enough for a chat list.
 *
 * Replaces `timeAgoAz` in src/store/db.ts. Same shape — «indi», minutes, then
 * the clock time within a day, then «Dünən», then days — with the Russian
 * three-form plural handled by the dictionary rather than by string maths here.
 */
export function timeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const min = Math.floor((now - then) / 60000);
  if (min < 1) return t('indi');
  if (min < 60) return t('{n} dəq', { n: min, count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const days = Math.floor(hr / 24);
  if (days === 1) return t('Dünən');
  return t('{n} gün', { n: days, count: days });
}
