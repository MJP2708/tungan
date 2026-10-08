import { en, type Entry } from './en.ts';

/**
 * The app's language (2026-10-09). Thai is the product's own language and
 * the source text: every string is written in Thai and looked up by that
 * Thai text, `t('งาน')`. So Thai needs no dictionary at all, a missing
 * English entry shows the Thai rather than a blank, and a fixed message the
 * server sends (an error, a blocked reason) can be translated where it is
 * shown, because it arrives as the same Thai key.
 *
 * `{0}`, `{1}` mark values: t('{0} งาน', n). An English entry may be a
 * function when the wording depends on the value (one task / two tasks).
 *
 * The current language is one module-level value, set by the app from the
 * device setting before it renders. The server never changes it, so
 * everything the server writes — LINE messages, stored text — stays Thai.
 */

export type Locale = 'th' | 'en';
export const LOCALES: readonly Locale[] = ['th', 'en'];

let current: Locale = 'th';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** For Intl date and number formatting in the current language. */
export function intlLocale(): string {
  return current === 'th' ? 'th-TH' : 'en-GB';
}

const fill = (template: string, args: ReadonlyArray<string | number>) =>
  args.length ? template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')) : template;

/** `t` in a named language, for pages the server renders per request (the
 *  login page), where the shared current language must stay Thai. */
export function translate(locale: Locale, key: string, ...args: Array<string | number>): string {
  // "กำหนดส่ง@@field": one Thai word that needs two English ones (the screen
  // is "Deadlines", the field is "Deadline"). Thai shows the part before @@.
  const at = key.indexOf('@@');
  const thai = at === -1 ? key : key.slice(0, at);
  if (locale === 'th') return fill(thai, args);
  const entry: Entry | undefined = en[key] ?? en[thai];
  if (typeof entry === 'function') return entry(...args);
  return fill(entry ?? thai, args);
}

export function t(key: string, ...args: Array<string | number>): string {
  return translate(current, key, ...args);
}

/** The first language an Accept-Language header asks for. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  return localeFromBrowser(header?.split(',')[0]?.trim());
}

/** The language a device asks for, when the person has not chosen one. */
export function localeFromBrowser(language: string | undefined): Locale {
  return !language || language.toLowerCase().startsWith('th') ? 'th' : 'en';
}
