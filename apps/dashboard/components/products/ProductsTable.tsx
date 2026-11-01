'use client';

import { useMemo } from 'react';
import type { ProductRow, ProductSort } from '@slips/contracts';
import { DataTable, StatusChip, type DataTableColumn } from '@slips/ui';
import { useI18n } from '../../i18n/provider';
import type { Locale } from '../../i18n/config';
import type { Messages } from '../../i18n/messages';
import { availabilityChip, fill, productPrice } from './format';
import { columnToSort, sortToColumn } from './url-state';

type M = Messages['products'];

function Thumb({ url }: { url: string | null }) {
  // Product images are square: 40x40, rounded-md; an empty muted box when there is none.
  return url ? (
    <img src={url} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-md bg-muted object-cover" />
  ) : (
    <span aria-hidden="true" className="block size-10 shrink-0 rounded-md bg-muted" />
  );
}

function Category({ row, m }: { row: ProductRow; m: M }) {
  if (!row.category_name) return <span className="text-muted-foreground">{m.none}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span dir="auto">{row.category_name}</span>
      {row.more_categories > 0 ? (
        <bdi className="text-small text-muted-foreground tabular-nums">{fill(m.moreCategories, { count: row.more_categories })}</bdi>
      ) : null}
    </span>
  );
}

const Price = ({ row, locale }: { row: ProductRow; locale: Locale }) => <bdi className="tabular-nums whitespace-nowrap">{productPrice(row, locale)}</bdi>;
const Count = ({ value }: { value: number }) => <bdi className="tabular-nums">{value}</bdi>;
const Orders = ({ value, m }: { value: number | null; m: M }) => (value === null ? <span className="text-muted-foreground">{m.none}</span> : <Count value={value} />);

function Availability({ row, m }: { row: ProductRow; m: M }) {
  const chip = availabilityChip(row.availability, m.availability);
  return <StatusChip tone={chip.tone}>{chip.label}</StatusChip>;
}

function productColumns(m: M, locale: Locale): DataTableColumn<ProductRow>[] {
  return [
    {
      id: 'name',
      header: m.columns.product,
      sortable: true,
      className: 'min-w-56',
      cell: (row) => (
        <span className="flex items-center gap-3">
          <Thumb url={row.image_url} />
          <span dir="auto" className="line-clamp-2 font-medium">
            {row.name}
          </span>
        </span>
      ),
    },
    { id: 'category', header: m.columns.category, cell: (row) => <Category row={row} m={m} /> },
    { id: 'price', header: m.columns.price, sortable: true, cell: (row) => <Price row={row} locale={locale} /> },
    { id: 'linked', header: m.columns.linkedContent, cell: (row) => <Count value={row.linked_content_count} /> },
    { id: 'orders', header: m.columns.attributedOrders, cell: (row) => <Orders value={row.attributed_orders} m={m} /> },
    { id: 'availability', header: m.columns.availability, cell: (row) => <Availability row={row} m={m} /> },
  ];
}

function ProductCard({ row, m, locale }: { row: ProductRow; m: M; locale: Locale }) {
  return (
    <div className="flex items-start gap-3">
      <Thumb url={row.image_url} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span dir="auto" className="line-clamp-2 font-medium">
          {row.name}
        </span>
        <span className="text-small text-muted-foreground">
          <Category row={row} m={m} />
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Price row={row} locale={locale} />
          <Availability row={row} m={m} />
        </span>
        <dl className="flex flex-wrap gap-x-4 text-small text-muted-foreground">
          <div className="flex gap-1">
            <dt>{m.columns.linkedContent}</dt>
            <dd>
              <Count value={row.linked_content_count} />
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>{m.columns.attributedOrders}</dt>
            <dd>
              <Orders value={row.attributed_orders} m={m} />
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

interface Props {
  rows: readonly ProductRow[];
  sort: ProductSort;
  onSortChange: (sort: ProductSort) => void;
}

/** The products table (cards below `md`). Sorting is done by the API; this only reports the chosen header. */
export function ProductsTable({ rows, sort, onSortChange }: Props) {
  const { locale, messages } = useI18n();
  const m = messages.products;
  const columns = useMemo(() => productColumns(m, locale), [m, locale]);
  return (
    <DataTable
      label={m.tableLabel}
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      sort={sortToColumn(sort)}
      onSortChange={(next) => onSortChange(columnToSort(next.id, next.desc))}
      renderCard={(row) => <ProductCard row={row} m={m} locale={locale} />}
    />
  );
}
