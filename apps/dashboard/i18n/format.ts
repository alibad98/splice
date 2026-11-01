import type { Locale } from './config';

// `-u-nu-latn` forces Western digits 0-9 in both locales (owner decision).
const tag = (locale: Locale) => `${locale === 'ar' ? 'ar-SA' : 'en-US'}-u-ca-gregory-nu-latn`;

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(tag(locale), options).format(value);
}

/** Currency with decimals only when the amount has a fractional part (then `fractionDigits` of them, e.g. 3 for KWD). */
export function formatCurrency(amount: number, locale: Locale, currency = 'SAR', fractionDigits = 2): string {
  const whole = Number.isInteger(amount);
  const formatted = new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: whole ? 0 : fractionDigits,
    maximumFractionDigits: whole ? 0 : fractionDigits,
  }).format(amount);
  // Strip bidi marks and the trailing full stop ICU adds to the Arabic riyal symbol.
  const clean = formatted.replace(/[\u200e\u200f]/g, '').replace(/\u00a0/g, ' ');
  return locale === 'ar' ? clean.replace(/\.$/, '') : clean;
}

export function formatDate(value: Date | number, locale: Locale, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: 'Asia/Riyadh', ...options }).format(value);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** What Intl has no phrase for: under a minute ago. */
const JUST_NOW: Record<Locale, string> = { en: 'just now', ar: 'قبل لحظات' };

/**
 * "5 minutes ago" / "قبل 5 دقائق" (`numeric: 'auto'`, Western digits); under a minute reads "just now". Always in the
 * past: a time ahead of this clock (skew) counts as just now.
 */
export function formatRelativeTime(value: Date | number, locale: Locale, now: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: 'auto' });
  const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  for (const [unit, size] of RELATIVE_UNITS) {
    if (seconds >= size) return rtf.format(-Math.trunc(seconds / size), unit);
  }
  return JUST_NOW[locale];
}
