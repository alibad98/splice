'use client';

import { useCallback } from 'react';
import { Card } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { useCatalogSync, useCategories, useProducts } from '../../lib/api/catalog';
import { fill, pageRange } from './format';
import { ProductFilters } from './ProductFilters';
import { ProductsTable } from './ProductsTable';
import { EmptyProducts, FilteredEmpty, ProductsError, ProductsSkeleton, useDelayed } from './ProductStates';
import { toListQuery, useProductParams } from './url-state';

const pager = 'inline-flex min-h-9 items-center rounded-pill border border-input-border px-4 font-semibold hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent';

/** The Products page body: filters, the table and every loading, empty and error state. */
export function ProductsView() {
  const { messages } = useI18n();
  const m = messages.products;
  const [params, setParams] = useProductParams();
  const query = toListQuery(params);
  const filtered = Boolean(query.q || query.category);

  const products = useProducts(query, { pollWhileSyncing: !filtered });
  const categories = useCategories();
  // A placeholder (the previous query's page) says nothing about this query, e.g. right after "Show all".
  const placeholderEmpty = products.isPlaceholderData && products.data?.total === 0;
  const nothingYet = !products.isPlaceholderData && products.data?.total === 0 && !filtered;
  const sync = useCatalogSync({ enabled: nothingYet });
  const syncing = nothingYet && (sync.data?.status === 'running' || sync.data?.status === 'never');

  // Search pauses replace the current entry (no history entry per pause); category, sort and page push one.
  const onSearch = useCallback((q: string) => void setParams({ q: q || null, page: null }, { history: 'replace' }), [setParams]);
  const onCategory = useCallback((category: string) => void setParams({ category: category || null, page: null }), [setParams]);
  const showAll = useCallback(() => void setParams({ q: null, category: null, page: null }), [setParams]);

  const showSkeleton = useDelayed(products.isPending || placeholderEmpty || (nothingYet && sync.isPending));

  let body;
  if (products.isError && !products.data) {
    body = <ProductsError onRetry={() => void products.refetch()} retrying={products.isFetching} />;
  } else if (nothingYet && sync.isError) {
    body = <ProductsError onRetry={() => void sync.refetch()} retrying={sync.isFetching} />;
  } else if (!products.data || placeholderEmpty || (nothingYet && !sync.data)) {
    body = showSkeleton ? <ProductsSkeleton /> : null;
  } else if (products.data.total === 0 || products.data.items.length === 0) {
    if (filtered || products.data.total > 0) body = <FilteredEmpty onShowAll={showAll} />;
    else body = <EmptyProducts kind={syncing ? 'syncing' : sync.data?.status === 'failed' ? 'failed' : 'none'} />;
  } else {
    const { page, page_size, total, items } = products.data;
    const { from, to } = pageRange(page, page_size, items.length);
    body = (
      <>
        {products.isError ? <ProductsError onRetry={() => void products.refetch()} retrying={products.isFetching} /> : null}
        <ProductsTable rows={items} sort={query.sort} onSortChange={(sort) => void setParams({ sort, page: null })} />
        <nav aria-label={m.pagination.label} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-small text-muted-foreground">
            <bdi className="tabular-nums">{fill(m.pagination.summary, { from, to, total })}</bdi>
          </p>
          <div className="flex gap-2">
            <button type="button" className={pager} disabled={page <= 1} onClick={() => void setParams({ page: page - 1 > 1 ? page - 1 : null })}>
              {m.pagination.previous}
            </button>
            <button type="button" className={pager} disabled={to >= total} onClick={() => void setParams({ page: page + 1 })}>
              {m.pagination.next}
            </button>
          </div>
        </nav>
      </>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{m.title}</h1>
        <p className="text-body text-muted-foreground">{m.intro}</p>
      </header>
      <Card>
        <ProductFilters q={params.q} category={params.category} categories={categories.data?.items ?? []} onSearch={onSearch} onCategory={onCategory} />
        <div aria-busy={products.isFetching || undefined}>{body}</div>
      </Card>
    </section>
  );
}
