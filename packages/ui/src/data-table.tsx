'use client';

import { createColumnHelper, tableFeatures, useTable, type RowData } from '@tanstack/react-table';
import { useMemo, type ReactNode } from 'react';
import { cn } from './cn.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.js';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** The header becomes a sort button; sorting itself is the caller's (server-side). */
  sortable?: boolean;
  className?: string;
}

export interface DataTableSort {
  id: string;
  desc: boolean;
}

export interface DataTableProps<T extends RowData> {
  columns: readonly DataTableColumn<T>[];
  data: readonly T[];
  getRowId: (row: T) => string;
  /** Current sort, if any (controlled). */
  sort?: DataTableSort | null;
  /** Called with the next sort when a sortable header is pressed: same column flips, a new column starts ascending. */
  onSortChange?: (next: DataTableSort) => void;
  /** Card rendering of a row for small viewports; without it the table is shown at every width. */
  renderCard?: (row: T) => ReactNode;
  /** Accessible name of the table and the card list. */
  label: string;
  className?: string;
}

const features = tableFeatures({});

function SortIcon({ dir }: { dir: 'asc' | 'desc' | 'none' }) {
  // Up/down arrows are not directional in the inline axis, so they do not mirror in RTL.
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0" fill="currentColor">
      <path d="M6 1.5 9 5H3z" opacity={dir === 'desc' ? 0.3 : 1} />
      <path d="M6 10.5 3 7h6z" opacity={dir === 'asc' ? 0.3 : 1} />
    </svg>
  );
}

/**
 * Data table on TanStack Table v9 (headless) with shadcn Table markup: 56px rows, muted row hover, sortable headers
 * (`aria-sort`), and an optional card list below `md` so small screens never scroll sideways.
 */
export function DataTable<T extends RowData>({ columns, data, getRowId, sort, onSortChange, renderCard, label, className }: DataTableProps<T>) {
  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return helper.columns(columns.map((c) => helper.display({ id: c.id, header: () => c.header, cell: ({ row }) => c.cell(row.original) })));
  }, [columns]);
  const rows = useMemo(() => [...data], [data]);
  const table = useTable({ features, columns: tableColumns, data: rows, getRowId: (row: T) => getRowId(row) });
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  return (
    <div data-slot="data-table" className={className}>
      <div className={cn(renderCard && 'hidden md:block')}>
        <Table aria-label={label}>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const col = byId.get(header.column.id);
                  const dir = sort?.id === header.column.id ? (sort.desc ? 'desc' : 'asc') : 'none';
                  const content = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                  return (
                    <TableHead key={header.id} className={col?.className} aria-sort={col?.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}>
                      {col?.sortable && onSortChange ? (
                        <button
                          type="button"
                          className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:text-foreground"
                          onClick={() => onSortChange({ id: header.column.id, desc: dir === 'asc' })}
                        >
                          {content}
                          <SortIcon dir={dir} />
                        </button>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-row-id={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className={byId.get(cell.column.id)?.className}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {renderCard ? (
        <ul aria-label={label} className="flex flex-col divide-y divide-border md:hidden">
          {data.map((row) => (
            <li key={getRowId(row)} className="py-3">
              {renderCard(row)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
