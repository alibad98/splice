import { CURRENCY_EXPONENTS } from '@slips/contracts';
import { expect, it } from 'vitest';
import { formatPrice } from '../src/viewer/index.js';
import { manifest } from './manifest.js';

for (const [currency, digits] of Object.entries(CURRENCY_EXPONENTS)) {
  for (const locale of ['ar', 'en'] as const) {
    it(`displays ${currency} with application minor-unit precision in ${locale}`, () => {
      const product = manifest().items[0]!.product!;
      product.currency = currency;
      const minor = 12345;
      const expected = new Intl.NumberFormat(`${locale}-u-nu-latn`, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(minor / 10 ** digits);
      expect(formatPrice(product, locale, minor)).toBe(expected);
    });
  }
}
