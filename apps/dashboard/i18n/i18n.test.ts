import { describe, expect, it } from 'vitest';
import { defaultLocale, directionOf, resolveLocale } from './config';
import { formatCurrency, formatDate, formatNumber } from './format';

describe('locale config', () => {
  it('defaults to Arabic RTL', () => {
    expect(resolveLocale(undefined)).toBe('ar');
    expect(defaultLocale).toBe('ar');
    expect(directionOf('ar')).toBe('rtl');
  });
  it('switches to English LTR and ignores invalid values', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(directionOf('en')).toBe('ltr');
    expect(resolveLocale('fr')).toBe('ar');
  });
});

describe('formatters', () => {
  it('formats currency per locale, decimals only when non-zero', () => {
    expect(formatCurrency(340, 'ar')).toBe('340 ر.س');
    expect(formatCurrency(340, 'en')).toBe('SAR 340');
    expect(formatCurrency(340.5, 'en')).toBe('SAR 340.50');
    expect(formatCurrency(340.5, 'ar')).toBe('340.50 ر.س');
  });
  it('uses Western digits in both locales', () => {
    expect(formatNumber(1234567.5, 'ar')).toMatch(/^[0-9٬,.٬٫]+$/u);
    expect(formatNumber(1234567, 'ar')).not.toMatch(/[٠-٩]/);
    expect(formatDate(new Date('2026-10-11T12:00:00Z'), 'ar')).not.toMatch(/[٠-٩]/);
    expect(formatDate(new Date('2026-10-11T12:00:00Z'), 'ar')).toMatch(/2026/);
    expect(formatDate(new Date('2026-10-11T12:00:00Z'), 'en')).toMatch(/2026/);
  });
});
