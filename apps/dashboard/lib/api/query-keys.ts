import type { ContentListQuery, ProductListQuery } from '@slips/contracts';

/** Query-key factory: one tree per module so a module's cache can be invalidated as a whole. */
export const queryKeys = {
  catalog: {
    all: ['catalog'] as const,
    productsAll: () => [...queryKeys.catalog.all, 'products'] as const,
    products: (query: ProductListQuery) => [...queryKeys.catalog.productsAll(), query] as const,
    categories: () => [...queryKeys.catalog.all, 'categories'] as const,
    sync: () => [...queryKeys.catalog.all, 'sync'] as const,
  },
  content: {
    all: ['content'] as const,
    lists: () => [...queryKeys.content.all, 'list'] as const,
    list: (query: ContentListQuery) => [...queryKeys.content.lists(), query] as const,
  },
};
