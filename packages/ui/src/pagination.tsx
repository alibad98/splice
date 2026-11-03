'use client';
// Pagination: the one pager for paged lists (Products now, Content and Analytics tables later). Shows the "from-to of
// total" summary, an optional rows-per-page select and Previous/Next. Copy comes from the caller (ar/en catalogs).
import { useId } from 'react';
import { Button } from './button.js';
import { cn } from './cn.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';

export interface PaginationLabels {
  /** Accessible name of the `<nav>` landmark, e.g. "Pages". */
  nav: string;
  /** The visible range summary, e.g. `({ from, to, total }) => \`${from}-${to} of ${total}\``. */
  summary: (range: { from: number; to: number; total: number }) => string;
  previous: string;
  next: string;
  /** Label of the rows-per-page select, e.g. "Rows per page". Needed when `pageSizes` is given. */
  pageSize?: string;
}

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  /** Items matching the query (all pages). */
  total: number;
  /** Items on the current page (defaults to what `page`, `pageSize` and `total` imply). */
  shown?: number;
  onPageChange: (page: number) => void;
  /** Rows-per-page choices; the select is shown only with these and `onPageSizeChange`. */
  pageSizes?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  labels: PaginationLabels;
  className?: string;
}

/** First and last item numbers on a page (1-based); 0-0 when the page is empty. */
export function pageRange(page: number, pageSize: number, total: number, shown?: number): { from: number; to: number } {
  const start = (page - 1) * pageSize;
  const count = shown ?? Math.max(0, Math.min(pageSize, total - start));
  return count === 0 ? { from: 0, to: 0 } : { from: start + 1, to: start + count };
}

export function Pagination({ page, pageSize, total, shown, onPageChange, pageSizes, onPageSizeChange, labels, className }: PaginationProps) {
  const sizeLabelId = useId();
  const { from, to } = pageRange(page, pageSize, total, shown);
  const showSizes = Boolean(pageSizes && pageSizes.length > 1 && onPageSizeChange);
  return (
    <nav aria-label={labels.nav} data-slot="pagination" className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-small text-muted-foreground">
        <bdi className="tabular-nums">{labels.summary({ from, to, total })}</bdi>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {showSizes ? (
          <div className="flex items-center gap-2">
            <span id={sizeLabelId} className="text-small text-muted-foreground">
              {labels.pageSize}
            </span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange?.(Number(v))}>
              <SelectTrigger aria-labelledby={sizeLabelId} className="w-20 tabular-nums">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes!.map((n) => (
                  <SelectItem key={n} value={String(n)} className="tabular-nums">
                    {String(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button size="md" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            {labels.previous}
          </Button>
          <Button size="md" disabled={to >= total} onClick={() => onPageChange(page + 1)}>
            {labels.next}
          </Button>
        </div>
      </div>
    </nav>
  );
}
