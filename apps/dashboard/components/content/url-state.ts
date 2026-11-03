import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import {
  CONTENT_PAGE_SIZE,
  CONTENT_SEARCH_MAX,
  CONTENT_SORTS,
  CONTENT_TABS,
  isContentPageSize,
  type ContentListQuery,
  type ContentSort,
  type ContentTab,
} from '@slips/contracts';

/** Content list state in the URL (`tab`, `q`, `sort`, `page`, `size`); defaults are cleared so the URL stays short. */
export const contentParams = {
  tab: parseAsStringLiteral(CONTENT_TABS).withDefault('all'),
  q: parseAsString.withDefault(''),
  sort: parseAsStringLiteral(CONTENT_SORTS).withDefault('-updated'),
  page: parseAsInteger.withDefault(1),
  size: parseAsInteger.withDefault(CONTENT_PAGE_SIZE),
};

export function useContentParams() {
  // `push`: tab, sort and page changes are history entries, so Back restores them. Search overrides with `replace`.
  return useQueryStates(contentParams, { history: 'push', clearOnDefault: true });
}

/** The API query for the URL state; out-of-range values from a hand-edited URL fall back to safe ones. */
export function toContentQuery(params: { tab: ContentTab; q: string; sort: ContentSort; page: number; size?: number }): ContentListQuery {
  const q = params.q.trim().slice(0, CONTENT_SEARCH_MAX);
  const size = params.size !== undefined && isContentPageSize(params.size) ? params.size : CONTENT_PAGE_SIZE;
  return { tab: params.tab, sort: params.sort, page: Math.max(1, Math.min(100_000, Math.trunc(params.page) || 1)), page_size: size, ...(q ? { q } : {}) };
}

/** Only the title column sorts by header; any other sort shows no header as sorted. */
export const sortToColumn = (sort: ContentSort): { id: string; desc: boolean } | null => (sort.endsWith('title') ? { id: 'title', desc: sort.startsWith('-') } : null);
/** Title header: ascending first, then it flips between ascending and descending. The other sorts are chosen in the "Sort by" Select. */
export const columnToSort = (desc: boolean): ContentSort => (desc ? '-title' : 'title');
