import { currencyExponent, type ProductRow } from '@slips/contracts';
import type { StatusTone } from '@slips/ui';
import type { Locale } from '../../i18n/config';
import { formatCurrency } from '../../i18n/format';
import type { Messages } from '../../i18n/messages';

/** The price shoppers pay (sale price when set), formatted in the product's currency from integer minor units. */
export function productPrice(row: Pick<ProductRow, 'price_minor' | 'sale_price_minor' | 'currency'>, locale: Locale): string {
  let exponent = 2;
  try {
    exponent = currencyExponent(row.currency);
  } catch {
    // unknown code: catalog never stores one, keep the common exponent
  }
  const minor = row.sale_price_minor ?? row.price_minor;
  return formatCurrency(minor / 10 ** exponent, locale, row.currency, exponent);
}

/** Chip tone and label for the stored availability bucket (never recomputed here). */
export function availabilityChip(bucket: ProductRow['availability'], m: Messages['products']['availability']): { tone: StatusTone; label: string } {
  switch (bucket) {
    case 'available':
      return { tone: 'success', label: m.available };
    case 'low':
      return { tone: 'warning', label: m.low };
    case 'out_of_stock':
      return { tone: 'danger', label: m.outOfStock };
  }
}

/** "{from}–{to}" style values for the pagination summary. */
export function pageRange(page: number, pageSize: number, shown: number): { from: number; to: number } {
  const from = shown === 0 ? 0 : (page - 1) * pageSize + 1;
  return { from, to: shown === 0 ? 0 : from + shown - 1 };
}

/** Fill `{name}` placeholders in a message. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));
}
