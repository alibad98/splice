import { describe, expect, it } from 'vitest';
import { defaultLocale, directionOf, pickLocale, resolveLocale, withLang } from './config';
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

describe('locale precedence', () => {
  it('?lang=en renders en/ltr without a cookie', () => {
    expect(pickLocale('en', undefined)).toBe('en');
    expect(directionOf(pickLocale('en', undefined))).toBe('ltr');
  });
  it('param beats cookie; cookie beats default; invalid param falls back', () => {
    expect(pickLocale('ar', 'en')).toBe('ar');
    expect(pickLocale(null, 'en')).toBe('en');
    expect(pickLocale('xx', undefined)).toBe('ar');
    expect(pickLocale('xx', 'bad')).toBe('ar');
  });
  it('withLang sets or replaces the param and keeps other parts', () => {
    expect(withLang('/products', 'en')).toBe('/products?lang=en');
    expect(withLang('/settings?tab=connection', 'en')).toBe('/settings?tab=connection&lang=en');
    expect(withLang('/a?lang=ar#h', 'en')).toBe('/a?lang=en#h');
    expect(withLang('/a', null)).toBe('/a');
  });
});
