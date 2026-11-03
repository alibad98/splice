'use client';

import { useEffect, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogSyncStatus, CategoryListResponse, PRODUCT_PAGE_SIZE, ProductListResponse, type ProductListQuery } from '@slips/contracts';
import { useSession } from '../../components/session/SessionProvider';
import { ApiError, getJson, postJson } from './fetch';
import { queryKeys } from './query-keys';

/** How often to look again while a sync is queued or running (or the first import has not started yet). */
export const SYNC_POLL_MS = 5_000;

type SyncState = CatalogSyncStatus['status'];
/** A run is under way: requested and waiting, or importing. */
export const isSyncActive = (s: SyncState | undefined): boolean => s === 'queued' || s === 'running';
/** Still waiting for products: a run under way, or the install import has not started yet. */
const isAwaitingSync = (s: SyncState | undefined): boolean => isSyncActive(s) || s === 'never';
const syncInProgress = (s: CatalogSyncStatus | undefined): boolean => isAwaitingSync(s?.status);

/** Query string for `GET /v1/products`; defaults are left out so the URL stays short. */
export function productsPath(query: ProductListQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.sort !== 'name') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.page_size !== PRODUCT_PAGE_SIZE) params.set('page_size', String(query.page_size));
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
 * The latest catalog sync run; polled while it is queued or running (or has not started yet). When a run ends, every
 * products page and the categories are refetched, so the list never outlives the import. Several instances (the products
 * page and the shell banner) share the one query; each runs the end-of-run invalidation, which is idempotent.
 */
export function useCatalogSync() {
  const { client, enabled } = useClient();
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: queryKeys.catalog.sync(),
    queryFn: () => getJson(client!, '/v1/catalog/sync', CatalogSyncStatus),
    enabled,
    refetchInterval: (q) => (syncInProgress(q.state.data) ? SYNC_POLL_MS : false),
  });
  const data = result.data;
  const previous = useRef(data?.status);
  useEffect(() => {
    const was = previous.current;
    previous.current = data?.status;
    if (data && isAwaitingSync(was) && !isAwaitingSync(data.status)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.productsAll() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.categories() });
    }
  }, [data, queryClient]);
  return result;
}

/**
 * Ask the API for a sync now (`POST /v1/catalog/sync`). The answer (the queued run, or the run already under way) goes
 * straight into the sync query, which then polls until the run ends. The API decides single-flight and the rate limit:
 * a 429 rejects with an `ApiError` whose status is 429.
 */
export function useRequestSync() {
  const { client } = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => (client ? postJson(client, '/v1/catalog/sync', CatalogSyncStatus) : Promise.reject(new ApiError(0))),
    onSuccess: (sync) => queryClient.setQueryData(queryKeys.catalog.sync(), sync),
  });
}
