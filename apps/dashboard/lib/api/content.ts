'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTENT_PAGE_SIZE, ContentItem, ContentListResponse, type ContentCreateInput, type ContentListQuery, type ContentUpdateInput } from '@slips/contracts';
import { useSession } from '../../components/session/SessionProvider';
import { ApiError, deleteResource, getJson, postJson, sendJson } from './fetch';
import { queryKeys } from './query-keys';

/** Query string for `GET /v1/content`; defaults are left out so the URL stays short. */
export function contentPath(query: ContentListQuery): string {
  const params = new URLSearchParams();
  if (query.tab !== 'all') params.set('tab', query.tab);
  if (query.q) params.set('q', query.q);
  if (query.sort !== '-updated') params.set('sort', query.sort);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.page_size !== CONTENT_PAGE_SIZE) params.set('page_size', String(query.page_size));
  const qs = params.toString();
  return `/v1/content${qs ? `?${qs}` : ''}`;
}

function useClient() {
  const session = useSession();
  const signedIn = session?.state.status === 'signed-in';
  return { client: session?.client, enabled: Boolean(session?.client) && signedIn };
}

/** A page of content items for a tab, with every tab's count. The previous page stays on screen while the next loads. */
export function useContentList(query: ContentListQuery) {
  const { client, enabled } = useClient();
  return useQuery({
    queryKey: queryKeys.content.list(query),
    queryFn: () => getJson(client!, contentPath(query), ContentListResponse),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** A lifecycle mutation on one item; the list and counts are refetched afterwards, success or not (409/404 included). */
function useContentMutation<R>(run: (client: NonNullable<ReturnType<typeof useClient>['client']>, id: string) => Promise<R>, affectsLinks = false) {
  const { client } = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => (client ? run(client, id) : Promise.reject(new ApiError(0))),
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.content.all }),
      ...(affectsLinks ? [queryClient.invalidateQueries({ queryKey: queryKeys.catalog.productsAll() })] : []),
    ]),
  });
}

const itemPath = (id: string) => `/v1/content/${encodeURIComponent(id)}`;

/** One content item for the editor. A 404 (unknown, deleted or another store's id) is final and not retried. */
export function useContentItem(id: string | null) {
  const { client, enabled } = useClient();
  return useQuery({
    queryKey: queryKeys.content.item(id ?? ''),
    queryFn: () => getJson(client!, itemPath(id!), ContentItem),
    enabled: enabled && Boolean(id),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
    // The editor owns the form state; a refetch on focus must not look like a change.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 3_000 : false,
  });
}

/**
 * After a save: the item cache holds the API answer and every list (and its counts) is refetched. When the product link
 * was sent, the Products page's linked-content counts are refetched too (Story 3.4).
 */
function useStoreSavedItem() {
  const queryClient = useQueryClient();
  return (item: ContentItem, sent: { product_id?: unknown }) => {
    queryClient.setQueryData(queryKeys.content.item(item.id), item);
    void queryClient.invalidateQueries({ queryKey: queryKeys.content.lists() });
    if (sent.product_id !== undefined) void queryClient.invalidateQueries({ queryKey: queryKeys.catalog.productsAll() });
  };
}

/** `POST /v1/content`: creates a Draft. */
export function useCreateContent() {
  const { client } = useClient();
  const store = useStoreSavedItem();
  return useMutation({
    mutationFn: (input: ContentCreateInput) => (client ? sendJson(client, 'POST', '/v1/content', input, ContentItem) : Promise.reject(new ApiError(0))),
    onSuccess: (item, input) => store(item, { product_id: input.product_id ?? undefined }),
  });
}

/** `PATCH /v1/content/:id`: changes fields; the status stays as it is. */
export function useUpdateContent() {
  const { client } = useClient();
  const store = useStoreSavedItem();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ContentUpdateInput }) => (client ? sendJson(client, 'PATCH', itemPath(id), patch, ContentItem) : Promise.reject(new ApiError(0))),
    onSuccess: (item, { patch }) => store(item, patch),
  });
}

export const useArchiveContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/archive`, ContentItem));
export const usePublishContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/publish`, ContentItem));
export const useUndoArchiveContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/undo-archive`, ContentItem));
export const useRestoreContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/restore`, ContentItem));
export const useDuplicateContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/duplicate`, ContentItem), true);
export const useDeleteContent = () => useContentMutation((client, id) => deleteResource(client, itemPath(id)), true);

export function useRetryContent() {
  const { client } = useClient();
  const queryClient = useQueryClient();
  const store = useStoreSavedItem();
  return useMutation({
    mutationFn: (id: string) => client ? postJson(client, `${itemPath(id)}/retry`, ContentItem) : Promise.reject(new ApiError(0)),
    onSuccess: (item) => {
      for (const slide of item.slides) {
        if (slide.status !== 'scanned') continue;
        queryClient.setQueryData(queryKeys.media.asset(slide.media_asset_id), (previous: Record<string, unknown> | undefined) => previous ? { ...previous, status: 'scanned', failure_reason: null, poster_url: null } : undefined);
      }
      store(item, {});
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.content.all }),
  });
}
