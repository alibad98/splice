export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ar';
export const localeCookie = 'slips-locale';
export type Direction = 'rtl' | 'ltr';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function directionOf(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export const langParam = 'lang';
export const langHeader = 'x-slips-lang';

/** Precedence: ?lang param (embedded URL) -> first-party cookie (direct links) -> default ar. */
export function pickLocale(param: unknown, cookie: unknown): Locale {
  if (isLocale(param)) return param;
  return resolveLocale(cookie);
}

/** Adds/updates ?lang on an href so the choice survives navigation inside the iframe. */
export function withLang(href: string, locale: Locale | null): string {
  if (!locale) return href;
  const [path = '', hash = ''] = href.split('#');
  const [base = '', query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(langParam, locale);
  return `${base}?${params.toString()}${hash ? `#${hash}` : ''}`;
}
