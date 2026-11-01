import type { AvailabilityBucket } from '@slips/db';

/** Stock at or below this (and above 0) is "Low". */
export const LOW_STOCK_MAX = 5;

/** The availability bucket `catalog` stores (spine Availability convention). Null stock means unlimited or unreported: available. */
export function availabilityBucket(stock: number | null): AvailabilityBucket {
  if (stock === null) return 'available';
  if (stock <= 0) return 'out_of_stock';
  if (stock <= LOW_STOCK_MAX) return 'low';
  return 'available';
}
