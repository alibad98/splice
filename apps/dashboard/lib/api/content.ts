'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTENT_PAGE_SIZE, ContentItem, ContentListResponse, type ContentListQuery } from '@slips/contracts';
import { useSession } from '../../components/session/SessionProvider';
import { ApiError, deleteResource, getJson, postJson } from './fetch';
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

export const useArchiveContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/archive`, ContentItem));
export const useUndoArchiveContent = () => useContentMutation((client, id) => postJson(client, `${itemPath(id)}/undo-archive`, ContentItem));
export const useDeleteContent = () => useContentMutation((client, id) => deleteResource(client, itemPath(id)));
