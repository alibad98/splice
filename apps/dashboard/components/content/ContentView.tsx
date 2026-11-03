'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTENT_PAGE_SIZES, CONTENT_SEARCH_MAX, CONTENT_SORTS, type ContentItem, type ContentSort, type ContentTab } from '@slips/contracts';
import { Card, Field, Input, Pagination, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, dialog, toast } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { directionOf } from '../../i18n/config';
import { useArchiveContent, useContentList, useDeleteContent, useUndoArchiveContent } from '../../lib/api/content';
import { fill } from '../products/format';
import { ContentError, ContentSkeleton, EmptyContent, FilteredEmpty, useDelayed } from './ContentStates';
import { ContentTable } from './ContentTable';
import { ContentTabs } from './ContentTabs';
import { toContentQuery, useContentParams } from './url-state';

export const SEARCH_DEBOUNCE_MS = 300;

/** Title search (debounced) and sort. The URL is the source of truth; the box follows it on Back and "Show all". */
function ContentFilters({ q, sort, onSearch, onSort }: { q: string; sort: ContentSort; onSearch: (q: string) => void; onSort: (sort: ContentSort) => void }) {
  const { locale, messages } = useI18n();
  const m = messages.content;
  const [term, setTerm] = useState(q);
  const latest = useRef(q);

  // The URL changed from outside (Back, Show all): show its value. When it only caught up with our own debounced
  // write, keep the box as is so characters typed since then survive.
  useEffect(() => {
    if (q === latest.current) return;
    latest.current = q;
    setTerm(q);
  }, [q]);

  useEffect(() => {
    if (term === latest.current) return;
    const id = setTimeout(() => {
      latest.current = term;
      onSearch(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term, onSearch]);

  return (
    <div role="search" className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label={m.searchLabel} className="flex-1">
        <Input type="search" dir="auto" leadingIcon="search" value={term} maxLength={CONTENT_SEARCH_MAX} placeholder={m.searchPlaceholder} onChange={(e) => setTerm(e.target.value)} />
      </Field>
      <Field label={m.sortLabel} className="sm:w-56">
        <Select value={sort} onValueChange={(v) => onSort(v as ContentSort)} dir={directionOf(locale)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                {m.sorts[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

/** Videos & Stories page body: status tabs with counts, search, sort, the table and every loading, empty and error state. */
export function ContentView() {
  const { messages } = useI18n();
  const m = messages.content;
  const [params, setParams] = useContentParams();
  const query = toContentQuery(params);

  const list = useContentList(query);
  // mutateAsync per call: mutate-level callbacks only fire for the latest call on a shared observer.
  const { mutateAsync: archive } = useArchiveContent();
  const { mutateAsync: undoArchive } = useUndoArchiveContent();
  const { mutateAsync: remove } = useDeleteContent();

  // Search pauses replace the current entry; tab, sort and page push one. Tab and search changes go back to page 1.
  const onSearch = useCallback((q: string) => void setParams({ q: q || null, page: null }, { history: 'replace' }), [setParams]);
  const onTab = useCallback((tab: ContentTab) => void setParams({ tab: tab === 'all' ? null : tab, page: null }), [setParams]);
  const onSort = useCallback((sort: ContentSort) => void setParams({ sort, page: null }), [setParams]);
  const showAll = useCallback(() => void setParams({ tab: null, q: null, page: null }), [setParams]);

  const onArchive = useCallback(
    (item: ContentItem) => {
      const toastId = `content-archived-${item.id}`;
      archive(item.id)
        .then(() =>
          toast({
            id: toastId,
            title: fill(m.archive.done, { title: item.title }),
            // An action toast never auto-dismisses.
            action: {
              label: m.archive.undo,
              onClick: () =>
                void undoArchive(item.id)
                  .then(() => toast({ id: toastId, title: m.archive.undone, tone: 'success' }))
                  .catch(() => toast({ id: toastId, title: m.archive.undoFailed, tone: 'danger' })),
            },
          }),
        )
        .catch(() => toast({ title: m.archive.failed, tone: 'danger' }));
    },
    [archive, undoArchive, m],
  );

  const onDelete = useCallback(
    (item: ContentItem) => {
      void dialog.confirm({
        tone: 'danger',
        title: fill(m.delete.title, { title: item.title }),
        description: m.delete.body,
        confirmLabel: m.delete.confirm,
        cancelLabel: m.delete.cancel,
        onConfirm: async () => {
          try {
            await remove(item.id);
            toast({ title: m.delete.done, tone: 'success' });
          } catch {
            // 404/409: the item changed elsewhere; the list is refetched either way.
            toast({ title: m.delete.failed, tone: 'danger' });
          }
        },
      });
    },
    [remove, m],
  );

  const data = list.data;
  // A placeholder (the previous query's page) says nothing about this query, e.g. right after "Show all".
  const placeholderEmpty = list.isPlaceholderData && data?.items.length === 0;
  // A page past the end (hand-edited URL, or the last row of the last page archived/deleted): go to the last real page.
  const pastEnd = Boolean(data && !list.isPlaceholderData && data.items.length === 0 && data.total > 0 && query.page > 1);
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  useEffect(() => {
    if (pastEnd) void setParams({ page: lastPage > 1 ? lastPage : null }, { history: 'replace' });
  }, [pastEnd, lastPage, setParams]);
  const showSkeleton = useDelayed(list.isPending || placeholderEmpty || pastEnd);

  let body;
  if (list.isError && !data) {
    body = <ContentError onRetry={() => void list.refetch()} retrying={list.isFetching} />;
  } else if (!data || placeholderEmpty || pastEnd) {
    body = showSkeleton ? <ContentSkeleton /> : null;
  } else if (data.counts.all === 0) {
    body = <EmptyContent />;
  } else if (data.items.length === 0) {
    body = <FilteredEmpty tabLabel={query.tab === 'all' ? null : m.tabs[query.tab]} onShowAll={showAll} />;
  } else {
    const { page, page_size, total, items } = data;
    const p = messages.products.pagination;
    body = (
      <>
        {list.isError ? <ContentError onRetry={() => void list.refetch()} retrying={list.isFetching} /> : null}
        <ContentTable rows={items} sort={query.sort} onSortChange={onSort} onArchive={onArchive} onDelete={onDelete} />
        <Pagination
          page={page}
          pageSize={page_size}
          total={total}
          shown={items.length}
          onPageChange={(next) => void setParams({ page: next > 1 ? next : null })}
          pageSizes={CONTENT_PAGE_SIZES}
          onPageSizeChange={(size) => void setParams({ size, page: null })}
          labels={{ nav: p.label, summary: (range) => fill(p.summary, range), previous: p.previous, next: p.next, pageSize: p.pageSize }}
        />
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
        <ContentFilters q={params.q} sort={query.sort} onSearch={onSearch} onSort={onSort} />
        <ContentTabs tab={query.tab} counts={data?.counts} onTabChange={onTab}>
          <div aria-busy={list.isFetching || undefined}>{body}</div>
        </ContentTabs>
      </Card>
    </section>
  );
}
