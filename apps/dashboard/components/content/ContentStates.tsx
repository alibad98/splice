'use client';

import Link from 'next/link';
import { Skeleton } from 'boneyard-js/react';
import type { SkeletonResult } from 'boneyard-js';
import { Alert, Button, EmptyState } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { fill } from '../products/format';

export { useDelayed } from '../products/ProductStates';

/** The editor for a new item (Story 3.3). */
export const NEW_CONTENT_HREF = '/content/new';

// Six 56px table rows. Full-width bones, so the skeleton reads the same in RTL and LTR.
const ROW = 56;
const rowsSkeleton: SkeletonResult = {
  name: 'content-table',
  viewportWidth: 1280,
  width: 1000,
  height: ROW * 6 + 40,
  bones: [[0, 8, 100, 24, 8], ...Array.from({ length: 6 }, (_, i) => [0, 40 + i * ROW + 8, 100, ROW - 16, 8] as [number, number, number, number, number])],
};

/** Boneyard skeleton of six table rows, announced to assistive tech as loading. */
export function ContentSkeleton() {
  const { messages } = useI18n();
  return (
    <div role="status" aria-busy="true" data-testid="content-skeleton">
      <span className="sr-only">{messages.content.loading}</span>
      <Skeleton name="content-table" loading initialBones={rowsSkeleton} color="var(--muted)" darkColor="var(--muted)" animate="pulse">
        <div style={{ height: rowsSkeleton.height }} />
      </Skeleton>
    </div>
  );
}

/** The store has no content at all: one friendly-coach sentence and one amber action. */
export function EmptyContent() {
  const m = useI18n().messages.content.empty;
  return (
    <EmptyState
      data-testid="content-empty"
      description={m.body}
      action={
        <Link href={NEW_CONTENT_HREF} className="inline-flex min-h-11 items-center justify-center rounded-pill bg-accent px-6 font-semibold text-accent-foreground hover:brightness-108">
          {m.create}
        </Link>
      }
    />
  );
}

/** This tab (or this search) has nothing, but the store has content. */
export function FilteredEmpty({ tabLabel, onShowAll }: { /** Null on the All tab (only a search can empty it). */ tabLabel: string | null; onShowAll: () => void }) {
  const m = useI18n().messages.content.filteredEmpty;
  return (
    <EmptyState
      data-testid="content-filtered-empty"
      variant="filtered"
      description={tabLabel ? fill(m.tab, { tab: tabLabel }) : m.search}
      action={<Button onClick={onShowAll}>{m.showAll}</Button>}
    />
  );
}

/** Inline error for this block only; the shell keeps working. */
export function ContentError({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  const m = useI18n().messages.content.error;
  return <Alert data-testid="content-error" tone="danger" title={m.title} description={m.body} action={{ label: m.retry, onClick: onRetry, pending: Boolean(retrying) }} />;
}
