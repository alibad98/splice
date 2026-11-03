// Canonical products -> catalog rows. Shared by the full sync and the product webhooks so both store the same shape.
import { InvalidAmountError, UnknownCurrencyError, toMinorUnits } from '@slips/contracts';
import type { StorePlatform } from '@slips/db';
import type { CanonicalProduct } from '../../ports/commerce-platform.js';
import { availabilityBucket } from './availability.js';
import type { CategoryWrite, ProductWrite } from './catalog.repository.js';

/**
 * Canonical products -> rows: minor units via the contracts money table, availability bucket computed here only.
 * A product with an unknown currency or an unreadable amount is left out and counted, never stored.
 */
export function toProductWrites(
  platform: StorePlatform,
  items: readonly CanonicalProduct[],
  fetchedAt: Date,
): { products: ProductWrite[]; categories: CategoryWrite[]; rejected: { unknownCurrency: number; invalid: number } } {
  const products = new Map<string, ProductWrite>();
  const categories = new Map<string, CategoryWrite>();
  const rejected = { unknownCurrency: 0, invalid: 0 };
  for (const p of items) {
    let priceMinor: number;
    let salePriceMinor: number | null;
    try {
      priceMinor = toMinorUnits(p.price, p.currency);
      salePriceMinor = p.salePrice === null ? null : toMinorUnits(p.salePrice, p.currency);
      if (priceMinor < 0 || (salePriceMinor !== null && salePriceMinor < 0)) throw new InvalidAmountError();
    } catch (err) {
      if (err instanceof UnknownCurrencyError) rejected.unknownCurrency++;
      else if (err instanceof InvalidAmountError) rejected.invalid++;
      else throw err;
      continue;
    }
    // A sale that rounds to the regular price (or above) is no sale.
    if (salePriceMinor !== null && salePriceMinor >= priceMinor) salePriceMinor = null;
    // The last occurrence wins: one upsert statement may not touch a row twice.
    products.set(p.externalId, {
      platform,
      externalId: p.externalId,
      name: p.name,
      imageUrl: p.imageUrl,
      categoryExternalIds: [...new Set(p.categories.map((c) => c.externalId))],
      priceMinor,
      salePriceMinor,
      currency: p.currency.toUpperCase(),
      taxInclusive: p.taxInclusive,
      stock: p.stock,
      availability: availabilityBucket(p.stock),
      hasRequiredOptions: p.hasRequiredOptions,
      visible: p.visible,
      sourceUpdatedAt: p.sourceUpdatedAt ?? fetchedAt,
    });
    for (const c of p.categories) categories.set(c.externalId, { platform, externalId: c.externalId, name: c.name, sourceUpdatedAt: fetchedAt });
  }
  return { products: [...products.values()], categories: [...categories.values()], rejected };
}
