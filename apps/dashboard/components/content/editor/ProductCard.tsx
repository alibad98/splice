'use client';

import { useEffect, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import type { ContentProductSummary, ProductRow } from '@slips/contracts';
import { Alert, Button, Card, CardTitle, Combobox, Field, StatusChip } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import type { Locale } from '../../../i18n/config';
import type { Messages } from '../../../i18n/messages';
import { useProductSearch } from '../../../lib/api/catalog';
import { availabilityChip, productPrice } from '../../products/format';
import { ProductThumb } from '../../products/ProductsTable';
import { fieldId, type EditorValues } from './form';

/** Wait this long after the last keystroke before searching (Story 3.4). */
export const PRODUCT_SEARCH_DEBOUNCE_MS = 250;

/** The picker's summary of a product row, until the API answers with the saved item's own. */
export const toProductSummary = (row: ProductRow): ContentProductSummary => ({
  id: row.id,
  name: row.name,
  image_url: row.image_url,
  price_minor: row.price_minor,
  sale_price_minor: row.sale_price_minor,
  currency: row.currency,
  availability: row.availability,
  has_required_options: row.has_required_options,
  deleted: false,
});

type ProductLike = Pick<ContentProductSummary, 'name' | 'image_url' | 'price_minor' | 'sale_price_minor' | 'currency' | 'availability'>;

/** Thumb, name, price and availability: one picker option or the linked product. Merchant text is `dir="auto"`. */
function ProductLine({ product, locale, availability }: { product: ProductLike; locale: Locale; availability: Messages['products']['availability'] }) {
  const chip = availabilityChip(product.availability, availability);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <ProductThumb url={product.image_url} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir="auto" className="line-clamp-1 font-medium">
          {product.name}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <bdi className="tabular-nums whitespace-nowrap">{productPrice(product, locale)}</bdi>
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        </span>
      </span>
    </span>
  );
}

/**
 * The linked product (Story 3.4): a search picker (kit Combobox over `GET /v1/products`) and, once linked, the product
 * with Change and Remove. Out-of-stock products can be linked with a warning; a product deleted in the store keeps its
 * link and asks for another one. `product` is the summary of the current `product_id` (null when none or unknown).
 */
export function ProductCard({ product, onPicked }: { product: ContentProductSummary | null; onPicked: (product: ContentProductSummary) => void }) {
  const { locale, messages } = useI18n();
  const m = messages.content.editor.product;
  const { control, setValue } = useFormContext<EditorValues>();
  const productId = useWatch({ control, name: 'product_id' });
  const inputId = fieldId('product_id');

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), PRODUCT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const search = useProductSearch(debounced, { enabled: open });
  const options = search.data?.items ?? [];
  const status = search.isError ? 'error' : search.isPending || (search.isPlaceholderData && options.length === 0) ? 'loading' : 'ready';

  const link = (id: string | null) => setValue('product_id', id, { shouldDirty: true, shouldTouch: true });
  const focusPicker = () => {
    document.getElementById(inputId)?.focus();
    setOpen(true);
  };

  const linked = productId ? product : null;

  return (
    <Card>
      <CardTitle>{m.heading}</CardTitle>
      <div className="flex flex-col gap-4">
        <Field label={m.search} htmlFor={inputId} hint={m.intro}>
          <Combobox<ProductRow>
            inputValue={query}
            onInputValueChange={setQuery}
            open={open}
            onOpenChange={setOpen}
            options={options}
            getOptionKey={(row) => row.id}
            renderOption={(row) => <ProductLine product={row} locale={locale} availability={messages.products.availability} />}
            onSelect={(row) => {
              onPicked(toProductSummary(row));
              link(row.id);
              setQuery('');
            }}
            status={status}
            placeholder={m.searchPlaceholder}
            listLabel={m.listLabel}
            emptyContent={m.noMatch}
            loadingContent={m.searching}
            errorContent={
              <span className="flex flex-wrap items-center gap-2 text-destructive-text">
                {m.loadError}
                <Button size="sm" variant="ghost" onClick={() => void search.refetch()}>
                  {m.retry}
                </Button>
              </span>
            }
          />
        </Field>

        {linked ? (
          <div data-testid="linked-product" aria-label={m.linkedLabel} role="group" className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
            <ProductLine product={linked} locale={locale} availability={messages.products.availability} />
            <span className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={focusPicker}>
                {m.change}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  link(null);
                  document.getElementById(inputId)?.focus();
                }}
              >
                {m.remove}
              </Button>
            </span>
          </div>
        ) : null}

        {linked?.deleted ? (
          <Alert tone="warning" title={m.deleted.title} description={m.deleted.body} action={{ label: m.deleted.action, onClick: focusPicker }} />
        ) : linked?.availability === 'out_of_stock' ? (
          <Alert tone="warning" title={m.outOfStock.title} description={m.outOfStock.body} />
        ) : null}
      </div>
    </Card>
  );
}
