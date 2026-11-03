import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { PRODUCT_PAGE_SIZE, PRODUCT_SEARCH_MAX, PRODUCT_SORTS, isProductPageSize, type ProductListQuery, type ProductSort } from '@slips/contracts';

/** Products page filters in the URL (`q`, `category`, `sort`, `page`, `size`), so Back restores them. */
export const productParams = {
  q: parseAsString.withDefault(''),
  category: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(PRODUCT_SORTS).withDefault('name'),
  page: parseAsInteger.withDefault(1),
  size: parseAsInteger.withDefault(PRODUCT_PAGE_SIZE),
};

export function useProductParams() {
  // `push`: each filter change is a history entry, so the browser Back button returns to the previous filters.
  return useQueryStates(productParams, { history: 'push', clearOnDefault: true });
}

/** The API query for the URL state; out-of-range values from a hand-edited URL fall back to safe ones. */
export function toListQuery(params: { q: string; category: string; sort: ProductSort; page: number; size?: number }): ProductListQuery {
  const q = params.q.trim().slice(0, PRODUCT_SEARCH_MAX);
  const category = params.category.trim().slice(0, 100);
  const size = params.size !== undefined && isProductPageSize(params.size) ? params.size : PRODUCT_PAGE_SIZE;
  return { sort: params.sort, page: Math.max(1, Math.min(100_000, Math.trunc(params.page) || 1)), page_size: size, ...(q ? { q } : {}), ...(category ? { category } : {}) };
}

export const sortToColumn = (sort: ProductSort): { id: 'name' | 'price'; desc: boolean } => ({ id: sort.endsWith('price') ? 'price' : 'name', desc: sort.startsWith('-') });
export const columnToSort = (id: string, desc: boolean): ProductSort => `${desc ? '-' : ''}${id === 'price' ? 'price' : 'name'}` as ProductSort;
