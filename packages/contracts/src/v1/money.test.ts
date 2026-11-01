import { describe, expect, it } from 'vitest';
import { InvalidAmountError, UnknownCurrencyError, currencyExponent, toMinorUnits } from './money.js';

describe('toMinorUnits', () => {
  it('uses the ISO 4217 exponent per currency', () => {
    expect(toMinorUnits('12.50', 'SAR')).toBe(1250);
    expect(toMinorUnits('1.250', 'KWD')).toBe(1250);
    expect(toMinorUnits(1.25, 'KWD')).toBe(1250);
    expect(toMinorUnits(500, 'JPY')).toBe(500);
    expect(toMinorUnits('7', 'sar')).toBe(700);
  });

  it('avoids float error and rounds extra digits half away from zero', () => {
    expect(toMinorUnits(19.99, 'SAR')).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2, 'SAR')).toBe(30);
    expect(toMinorUnits('10.005', 'SAR')).toBe(1001);
    expect(toMinorUnits('10.004', 'SAR')).toBe(1000);
    expect(toMinorUnits('-3.5', 'SAR')).toBe(-350);
    expect(toMinorUnits(1e-7, 'SAR')).toBe(0);
  });

  it('rejects unknown currencies and non-decimal amounts', () => {
    expect(() => toMinorUnits('1', 'XYZ')).toThrow(UnknownCurrencyError);
    expect(() => currencyExponent('')).toThrow(UnknownCurrencyError);
    expect(() => toMinorUnits('abc', 'SAR')).toThrow(InvalidAmountError);
    expect(() => toMinorUnits('1,5', 'SAR')).toThrow(InvalidAmountError);
    expect(() => toMinorUnits(Number.NaN, 'SAR')).toThrow(InvalidAmountError);
    expect(() => toMinorUnits('1e30', 'SAR')).toThrow(InvalidAmountError);
  });
});
