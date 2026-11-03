'use client';

import { useCallback } from 'react';
import { PRODUCT_PAGE_SIZES } from '@slips/contracts';
import { Card, Pagination } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { isSyncActive, useCatalogSync, useCategories, useProducts } from '../../lib/api/catalog';
import { fill } from './format';
import { ProductFilters } from './ProductFilters';
import { ProductsTable } from './ProductsTable';
import { SyncHeader } from './SyncHeader';
import { EmptyProducts, FilteredEmpty, ProductsError, ProductsSkeleton, useDelayed } from './ProductStates';
import { toListQuery, useProductParams } from './url-state';


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
  // Always on: the header shows the last sync time, and a run under way is polled until it ends.
  const sync = useCatalogSync();
  const syncing = nothingYet && (isSyncActive(sync.data?.status) || sync.data?.status === 'never');

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
    body = (
      <>
        {products.isError ? <ProductsError onRetry={() => void products.refetch()} retrying={products.isFetching} /> : null}
        <ProductsTable rows={items} sort={query.sort} onSortChange={(sort) => void setParams({ sort, page: null })} />
        <Pagination
          page={page}
          pageSize={page_size}
          total={total}
          shown={items.length}
          onPageChange={(next) => void setParams({ page: next > 1 ? next : null })}
          pageSizes={PRODUCT_PAGE_SIZES}
          // A new page size starts again from page 1, so the first rows stay in view.
          onPageSizeChange={(size) => void setParams({ size, page: null })}
          labels={{
            nav: m.pagination.label,
            summary: (range) => fill(m.pagination.summary, range),
            previous: m.pagination.previous,
            next: m.pagination.next,
            pageSize: m.pagination.pageSize,
          }}
        />
      </>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">{m.title}</h1>
          <p className="text-body text-muted-foreground">{m.intro}</p>
        </div>
        <SyncHeader sync={sync.data} />
      </header>
      <Card>
        <ProductFilters q={params.q} category={params.category} categories={categories.data?.items ?? []} onSearch={onSearch} onCategory={onCategory} />
        <div aria-busy={products.isFetching || undefined}>{body}</div>
      </Card>
    </section>
  );
}
