'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ARCHIVABLE_STATUSES, type ContentFormat, type ContentItem, type ContentSort } from '@slips/contracts';
import { Button, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icon, StatusChip, type DataTableColumn } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import { directionOf } from '../../i18n/config';
import type { Messages } from '../../i18n/messages';
import { usePosterSrc } from '../../lib/api/media';
import { fill } from '../products/format';
import { ContentStatusChip } from './ContentStatusChip';
import { columnToSort, sortToColumn } from './url-state';

type M = Messages['content'];

export const contentHref = (id: string) => `/content/${encodeURIComponent(id)}`;

const FORMAT_ICON = { story: 'content', reel: 'play' } as const satisfies Record<ContentFormat, string>;

/** 9:16 muted box: renders the first slide's poster when processed (Story 3.8), else the format icon. */
function Thumb({ format, posterUrl }: { format: ContentFormat; posterUrl?: string | null }) {
  const src = usePosterSrc(posterUrl);
  return (
    <span aria-hidden="true" data-testid="content-thumb" className="inline-flex aspect-9/16 h-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground">
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <Icon name={FORMAT_ICON[format]} className="size-3.5" />
      )}
    </span>
  );
}

const None = ({ m }: { m: M }) => <span className="text-muted-foreground">{m.none}</span>;

/** The title link, with a warning chip under it when the linked product was deleted in the store (Story 3.4). */
function TitleCell({ row, m }: { row: ContentItem; m: M }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <Link href={contentHref(row.id)} dir="auto" className="line-clamp-2 font-medium hover:underline">
        {row.title}
      </Link>
      {row.product?.deleted ? (
        <StatusChip tone="warning" icon={<Icon name="warning" className="size-3" />}>
          {m.flags.productDeleted}
        </StatusChip>
      ) : null}
    </span>
  );
}

const canArchive = (item: ContentItem) => (ARCHIVABLE_STATUSES as readonly string[]).includes(item.status);

function RowMenu({ item, m, onArchive, onDelete }: { item: ContentItem; m: M; onArchive: (item: ContentItem) => void; onDelete: (item: ContentItem) => void }) {
  const { locale } = useI18n();
  return (
    <DropdownMenu dir={directionOf(locale)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={fill(m.menu.label, { title: item.title })} className="px-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
            <circle cx="5" cy="12" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="19" cy="12" r="1.75" />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canArchive(item) ? (
          <DropdownMenuItem onSelect={() => onArchive(item)}>
            <Icon name="archive" className="size-4" />
            {m.menu.archive}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem tone="danger" onSelect={() => onDelete(item)}>
          {m.menu.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Actions {
  onArchive: (item: ContentItem) => void;
  onDelete: (item: ContentItem) => void;
}

function contentColumns(m: M, actions: Actions): DataTableColumn<ContentItem>[] {
  return [
    { id: 'thumb', header: <span className="sr-only">{m.columns.thumb}</span>, className: 'w-12', cell: (row) => <Thumb format={row.format} posterUrl={row.slides[0]?.poster_url} /> },
    {
      id: 'title',
      header: m.columns.title,
      sortable: true,
      className: 'min-w-56',
      cell: (row) => <TitleCell row={row} m={m} />,
    },
    { id: 'format', header: m.columns.format, cell: (row) => m.formats[row.format] },
    { id: 'placement', header: m.columns.placement, cell: () => <None m={m} /> },
    { id: 'status', header: m.columns.status, cell: (row) => <ContentStatusChip status={row.status} labels={m.statuses} /> },
    { id: 'views', header: m.columns.views, cell: () => <None m={m} /> },
    { id: 'clicks', header: m.columns.clicks, cell: () => <None m={m} /> },
    { id: 'actions', header: <span className="sr-only">{m.columns.actions}</span>, className: 'w-12 text-end', cell: (row) => <RowMenu item={row} m={m} {...actions} /> },
  ];
}

function ContentCard({ row, m, actions }: { row: ContentItem; m: M; actions: Actions }) {
  return (
    <div className="flex items-start gap-3">
      <Thumb format={row.format} posterUrl={row.slides[0]?.poster_url} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <TitleCell row={row} m={m} />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground">
          {m.formats[row.format]}
          <ContentStatusChip status={row.status} labels={m.statuses} />
        </span>
      </div>
      <RowMenu item={row} m={m} {...actions} />
    </div>
  );
}

interface Props extends Actions {
  rows: readonly ContentItem[];
  sort: ContentSort;
  onSortChange: (sort: ContentSort) => void;
}

/** The content table (cards below `md`). Clicking a row or pressing `Enter` on it opens the item. */
export function ContentTable({ rows, sort, onSortChange, onArchive, onDelete }: Props) {
  const router = useRouter();
  const m = useI18n().messages.content;
  const columns = useMemo(() => contentColumns(m, { onArchive, onDelete }), [m, onArchive, onDelete]);
  return (
    <DataTable
      label={m.tableLabel}
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      sort={sortToColumn(sort)}
      onSortChange={(next) => onSortChange(columnToSort(next.desc))}
      onRowActivate={(row) => router.push(contentHref(row.id))}
      rowClassName={(row) => (row.status === 'failed' ? 'bg-destructive/6 hover:bg-destructive/10' : undefined)}
      renderCard={(row) => <ContentCard row={row} m={m} actions={{ onArchive, onDelete }} />}
    />
  );
}
