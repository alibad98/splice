'use client';

import { Alert, Card, EmptyState, Skeleton } from '@slips/ui';
import { useI18n } from '../../../i18n/provider';
import { ApiError } from '../../../lib/api/fetch';
import { useContentItem } from '../../../lib/api/content';
import { useDelayed } from '../ContentStates';
import { LangLink } from '../../shell/LangLink';
import { ContentEditor } from './ContentEditor';

/** `/content/[id]`: loads the item, then the editor. Skeleton after 150 ms, 404 and error states inline. */
export function ContentEditorPage({ id }: { id: string }) {
  const { messages } = useI18n();
  const m = messages.content.editor;
  const query = useContentItem(id);
  const showSkeleton = useDelayed(query.isPending && !query.isError);

  if (query.data) return <ContentEditor key={query.data.id} item={query.data} />;

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section className="flex flex-col gap-4">
        {notFound ? (
          <EmptyState
            data-testid="content-not-found"
            title={m.notFound.title}
            description={m.notFound.body}
            action={
              <LangLink href="/content" className="inline-flex min-h-11 items-center justify-center rounded-pill bg-primary px-6 font-semibold text-primary-foreground">
                {m.back}
              </LangLink>
            }
          />
        ) : (
          <Alert
            data-testid="content-load-error"
            tone="danger"
            title={m.loadError.title}
            description={m.loadError.body}
            action={{ label: m.loadError.retry, onClick: () => void query.refetch(), pending: query.isFetching }}
          />
        )}
      </section>
    );
  }

  return showSkeleton ? (
    <Skeleton label={m.loading} data-testid="content-editor-skeleton" className="gap-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <Skeleton className="h-24" />
          </Card>
          <Card>
            <Skeleton className="h-40" />
          </Card>
        </div>
        <Skeleton className="hidden aspect-[9/16] rounded-lg lg:block" />
      </div>
    </Skeleton>
  ) : null;
}
