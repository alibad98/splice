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
function useContentMutation<R>(run: (client: NonNullable<ReturnType<typeof useClient>['client']>, id: string) => Promise<R>) {
  const { client } = useClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => (client ? run(client, id) : Promise.reject(new ApiError(0))),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.content.all }),
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
  });
}

/** After a save: the item cache holds the API answer and every list (and its counts) is refetched. */
function useStoreSavedItem() {
  const queryClient = useQueryClient();
  return (item: ContentItem) => {
    queryClient.setQueryData(queryKeys.content.item(item.id), item);
    void queryClient.invalidateQueries({ queryKey: queryKeys.content.lists() });
  };
}

/** `POST /v1/content`: creates a Draft. */
export function useCreateContent() {
  const { client } = useClient();
  const store = useStoreSavedItem();
  return useMutation({
    mutationFn: (input: ContentCreateInput) => (client ? sendJson(client, 'POST', '/v1/content', input, ContentItem) : Promise.reject(new ApiError(0))),
    onSuccess: store,
  });
}

/** `PATCH /v1/content/:id`: changes fields; the status stays as it is. */
export function useUpdateContent() {
  const { client } = useClient();
  const store = useStoreSavedItem();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ContentUpdateInput }) => (client ? sendJson(client, 'PATCH', itemPath(id), patch, ContentItem) : Promise.reject(new ApiError(0))),
    onSuccess: store,
  });
}

export const useArchiveContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/archive`, ContentItem));
export const useUndoArchiveContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/undo-archive`, ContentItem));
export const useDeleteContent = () => useContentMutation((client, id) => deleteResource(client, itemPath(id)));
