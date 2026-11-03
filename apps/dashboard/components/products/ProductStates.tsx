'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Skeleton } from 'boneyard-js/react';
import type { SkeletonResult } from 'boneyard-js';
import { useI18n } from '../../i18n/provider';

export const SALLA_PRODUCTS_URL = 'https://s.salla.sa/products';

const button = 'inline-flex min-h-9 items-center justify-center rounded-pill border border-input-border px-4 font-semibold hover:bg-muted';

/** True once `active` has stayed true for `ms` (so fast loads never flash a skeleton). */
export function useDelayed(active: boolean, ms = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const id = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return active && shown;
}

// Six 56px table rows. Full-width bones, so the skeleton reads the same in RTL and LTR.
const ROW = 56;
const rowsSkeleton: SkeletonResult = {
  name: 'products-table',
  viewportWidth: 1280,
  width: 1000,
  height: ROW * 6 + 40,
  bones: [[0, 8, 100, 24, 8], ...Array.from({ length: 6 }, (_, i) => [0, 40 + i * ROW + 8, 100, ROW - 16, 8] as [number, number, number, number, number])],
};

/** Boneyard skeleton of six table rows, announced to assistive tech as loading. */
export function ProductsSkeleton() {
  const { messages } = useI18n();
  return (
    <div role="status" aria-busy="true" data-testid="products-skeleton">
      <span className="sr-only">{messages.products.loading}</span>
      <Skeleton name="products-table" loading initialBones={rowsSkeleton} color="var(--muted)" darkColor="var(--muted)" animate="pulse">
        <div style={{ height: rowsSkeleton.height }} />
      </Skeleton>
    </div>
  );
}

function Block({ title, children, testId }: { title: string; children?: ReactNode; testId: string }) {
  return (
    <div data-testid={testId} className="flex flex-col items-start gap-3 py-10">
      <h2 className="text-h2">{title}</h2>
      {children}
    </div>
  );
}

/** No products at all: still importing, imported none, or the import stopped. */
export function EmptyProducts({ kind }: { kind: 'syncing' | 'none' | 'failed' }) {
  const m = useI18n().messages.products.empty;
  if (kind === 'syncing') {
    return (
      <div role="status">
        <Block testId="products-syncing" title={m.syncingTitle}>
          <p className="max-w-prose text-body text-muted-foreground">{m.syncingBody}</p>
        </Block>
      </div>
    );
  }
  return (
    <Block testId={`products-${kind}`} title={kind === 'none' ? m.noneTitle : m.failedTitle}>
      <p className="max-w-prose text-body text-muted-foreground">{kind === 'none' ? m.noneBody : m.failedBody}</p>
      <a href={SALLA_PRODUCTS_URL} target="_blank" rel="noopener noreferrer" className={button}>
        {m.openSalla}
      </a>
    </Block>
  );
}

/** Filters matched nothing. */
export function FilteredEmpty({ onShowAll }: { onShowAll: () => void }) {
  const m = useI18n().messages.products.empty;
  return (
    <div data-testid="products-filtered-empty" className="flex flex-col items-start gap-3 py-10">
      <p className="text-body">{m.filtered}</p>
      <button type="button" className={button} onClick={onShowAll}>
        {m.showAll}
      </button>
    </div>
  );
}

/** Inline error for this block only; the shell keeps working. */
export function ProductsError({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  const m = useI18n().messages.products.error;
  return (
    <div role="alert" data-testid="products-error" className="flex flex-col items-start gap-3 rounded-md bg-destructive-tint p-4">
      <p className="font-semibold text-destructive-text">{m.title}</p>
      <p className="text-body">{m.body}</p>
      <button type="button" className={button} onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>
        {m.retry}
      </button>
    </div>
  );
}
