'use client';

import { useEffect, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogSyncStatus, CategoryListResponse, ProductListResponse, type ProductListQuery } from '@slips/contracts';
import { useSession } from '../../components/session/SessionProvider';
import { getJson } from './fetch';
import { queryKeys } from './query-keys';

/** How often to look again while the first catalog import is still running. */
export const SYNC_POLL_MS = 5_000;

const syncInProgress = (s: CatalogSyncStatus | undefined): boolean => s?.status === 'running' || s?.status === 'never';

/** Query string for `GET /v1/products`; defaults are left out so the URL stays short. */
export function productsPath(query: ProductListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.sort !== 'name') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  const qs = params.toString();
  return `/v1/products${qs ? `?${qs}` : ''}`;
}

function useClient() {
  const session = useSession();
  const signedIn = session?.state.status === 'signed-in';
  return { client: session?.client, enabled: Boolean(session?.client) && signedIn };
}

/**
 * A page of products. The previous page stays on screen while the next one loads. With `pollWhileSyncing`, an empty
 * result is fetched again while the first import is running, so products appear as soon as it finishes.
 */
export function useProducts(query: ProductListQuery, options: { pollWhileSyncing?: boolean } = {}) {
  const { client, enabled } = useClient();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.catalog.products(query),
    queryFn: () => getJson(client!, productsPath(query), ProductListResponse),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (q) =>
      options.pollWhileSyncing && q.state.data?.total === 0 && syncInProgress(queryClient.getQueryData<CatalogSyncStatus>(queryKeys.catalog.sync())) ? SYNC_POLL_MS : false,
  });
}

export function useCategories() {
  const { client, enabled } = useClient();
  return useQuery({
    queryKey: queryKeys.catalog.categories(),
    queryFn: () => getJson(client!, '/v1/products/categories', CategoryListResponse),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * The latest catalog sync run; polled while it is running (or has not started yet). When a run ends, every products
 * page and the categories are refetched, so a stale empty page never outlives the import.
 */
export function useCatalogSync(options: { enabled?: boolean } = {}) {
  const { client, enabled } = useClient();
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: queryKeys.catalog.sync(),
    queryFn: () => getJson(client!, '/v1/catalog/sync', CatalogSyncStatus),
    enabled: enabled && (options.enabled ?? true),
    refetchInterval: (q) => (syncInProgress(q.state.data) ? SYNC_POLL_MS : false),
  });
  const status = result.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    const inProgress = (s: typeof status) => s === 'running' || s === 'never';
    if (status && inProgress(was) && !inProgress(status)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.productsAll() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories() });
    }
  }, [status, queryClient]);
  return result;
}
