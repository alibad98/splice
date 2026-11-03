import { z } from 'zod';

/** Products page sort keys; a leading `-` sorts descending. `price` is the effective price (sale price when set). */
export const PRODUCT_SORTS = ['name', '-name', 'price', '-price'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
/** Page sizes the Products list offers; the first is the default. */
export const PRODUCT_PAGE_SIZES = [10, 25, 50] as const;
export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number];
export const PRODUCT_PAGE_SIZE: ProductPageSize = PRODUCT_PAGE_SIZES[0];
export const isProductPageSize = (n: number): n is ProductPageSize => (PRODUCT_PAGE_SIZES as readonly number[]).includes(n);
export const PRODUCT_SEARCH_MAX = 100;

/** Stored by `catalog` only; clients render the bucket, never recompute it. */
export const Availability = z.enum(['available', 'low', 'out_of_stock']);
export type Availability = z.infer<typeof Availability>;

/** `GET /v1/products` query string. Unknown keys are ignored; a bad value is a 400. */
export const ProductListQuery = z.object({
  q: z.string().trim().max(PRODUCT_SEARCH_MAX).optional(),
  category: z.string().trim().max(100).optional(),
  sort: z.enum(PRODUCT_SORTS).default('name'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce
    .number()
    .int()
    .refine(isProductPageSize, { message: `page_size must be one of ${PRODUCT_PAGE_SIZES.join(', ')}` })
    .default(PRODUCT_PAGE_SIZE),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;
export type ProductListQueryInput = z.input<typeof ProductListQuery>;

/** One product row on the Products page. Money is integer minor units of `currency`. */
export const ProductRow = z.object({
  id: z.uuid(),
  external_id: z.string(),
  name: z.string(),
  image_url: z.string().nullable(),
  /** Name of the product's first category, if known. */
  category_name: z.string().nullable(),
  /** How many more categories the product is in beyond the first. */
  more_categories: z.number().int().min(0),
  price_minor: z.number().int().min(0),
  sale_price_minor: z.number().int().min(0).nullable(),
  currency: z.string().length(3),
  tax_inclusive: z.boolean(),
  availability: Availability,
  linked_content_count: z.number().int().min(0),
  /** Null until attribution exists (Epic 6): the dashboard shows "—". */
  attributed_orders: z.number().int().min(0).nullable(),
});
export type ProductRow = z.infer<typeof ProductRow>;

export const ProductListResponse = z.object({
  v: z.literal(1).default(1),
  items: z.array(ProductRow),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
});
export type ProductListResponse = z.infer<typeof ProductListResponse>;

/** `GET /v1/products/categories`: the store's categories for the filter. */
export const CategoryListResponse = z.object({
  v: z.literal(1).default(1),
  items: z.array(z.object({ external_id: z.string(), name: z.string() })),
});
export type CategoryListResponse = z.infer<typeof CategoryListResponse>;

/** `never` before the first run; `queued` once a sync was requested and the worker has not started it yet. */
export const CATALOG_SYNC_STATES = ['never', 'queued', 'running', 'succeeded', 'failed'] as const;

/** Problem `type` of `POST /v1/catalog/sync` when the previous request was too recent (429 + `Retry-After`). */
export const CATALOG_SYNC_RATE_LIMITED = 'sync-rate-limited';

/**
 * `GET /v1/catalog/sync` and `POST /v1/catalog/sync`: the latest sync run. `failed` is only reported after the run's
 * last attempt (or a failure retrying cannot fix); `last_synced_at` is the last successful run and survives failures.
 */
export const CatalogSyncStatus = z.object({
  v: z.literal(1).default(1),
  status: z.enum(CATALOG_SYNC_STATES),
  /** Id of the latest run; null before the first one. */
  run_id: z.uuid().nullable().default(null),
  reason: z.string().nullable(),
  last_synced_at: z.iso.datetime().nullable(),
});
export type CatalogSyncStatus = z.infer<typeof CatalogSyncStatus>;
