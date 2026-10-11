import type { Locale } from './config';

// `-u-nu-latn` forces Western digits 0-9 in both locales (owner decision).
const tag = (locale: Locale) => `${locale === 'ar' ? 'ar-SA' : 'en-US'}-u-ca-gregory-nu-latn`;

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(tag(locale), options).format(value);
}

/** Currency with decimals only when the amount has a fractional part. */
export function formatCurrency(amount: number, locale: Locale, currency = 'SAR'): string {
  const whole = Number.isInteger(amount);
  const formatted = new Intl.NumberFormat(tag(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'symbol',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
  // Strip bidi marks and the trailing full stop ICU adds to the Arabic riyal symbol.
  const clean = formatted.replace(/[\u200e\u200f]/g, '').replace(/\u00a0/g, ' ');
  return locale === 'ar' ? clean.replace(/\.$/, '') : clean;
}

export function formatDate(value: Date | number, locale: Locale, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: 'Asia/Riyadh', ...options }).format(value);
}
