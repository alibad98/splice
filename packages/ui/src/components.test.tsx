import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card, CardTitle } from './card.js';
import { cn } from './cn.js';
import { DataTable, type DataTableColumn } from './data-table.js';
import { StatusChip } from './status-chip.js';

interface Row {
  id: string;
  name: string;
  price: number;
}
const rows: Row[] = [
  { id: 'a', name: 'Abaya', price: 10 },
  { id: 'b', name: 'Bag', price: 20 },
];
const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { id: 'price', header: 'Price', cell: (r) => r.price, sortable: true },
  { id: 'note', header: 'Note', cell: () => '-' },
];

describe('cn', () => {
  it('merges conflicting Tailwind classes and keeps type-scale sizes apart from colours', () => {
    expect(cn('px-2', false, 'px-3')).toBe('px-3');
    expect(cn('text-small text-muted-foreground')).toBe('text-small text-muted-foreground');
    expect(cn('text-small', 'text-h3')).toBe('text-h3');
  });
});

describe('StatusChip', () => {
  it.each([
    ['neutral', 'bg-muted'],
    ['info', 'bg-primary-tint'],
    ['success', 'bg-success-tint'],
    ['warning', 'bg-warning-tint'],
    ['danger', 'bg-destructive-tint'],
  ] as const)('%s tone renders a pill with a text label and a decorative dot', (tone, bg) => {
    const html = renderToStaticMarkup(<StatusChip tone={tone}>Label</StatusChip>);
    expect(html).toContain('Label');
    expect(html).toContain(bg);
    expect(html).toContain('rounded-pill');
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*rounded-full/);
  });
  it('can drop the dot', () => {
    expect(renderToStaticMarkup(<StatusChip tone="neutral" dot={false}>Ended</StatusChip>)).not.toContain('aria-hidden');
  });
});

describe('Card', () => {
  it('renders the shadcn slots', () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardTitle>Title</CardTitle>
      </Card>,
    );
    expect(html).toContain('data-slot="card"');
    expect(html).toContain('shadow-card');
    expect(html).toContain('<h2 data-slot="card-title"');
  });
});

describe('DataTable', () => {
  it('renders headers, 56px rows and cells in order', () => {
    const html = renderToStaticMarkup(<DataTable label="Products" columns={columns} data={rows} getRowId={(r) => r.id} />);
    expect(html).toContain('aria-label="Products"');
    expect(html.indexOf('Abaya')).toBeLessThan(html.indexOf('Bag'));
    expect(html).toContain('data-row-id="a"');
    expect(html).toContain('h-14');
    expect(html).toContain('hover:bg-muted');
    expect(html).not.toContain('<button'); // no sort handler: plain headers
    expect(html).not.toContain('<ul'); // no card renderer: table at every width
  });
  it('marks the sorted column with aria-sort and makes sortable headers buttons', () => {
    const html = renderToStaticMarkup(<DataTable label="Products" columns={columns} data={rows} getRowId={(r) => r.id} sort={{ id: 'price', desc: true }} onSortChange={() => undefined} />);
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('aria-sort="none"');
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).not.toMatch(/<th[^>]*aria-sort[^>]*>Note/);
  });
  it('renders a card list for small screens when given a card renderer, hiding the table there', () => {
    const html = renderToStaticMarkup(<DataTable label="Products" columns={columns} data={rows} getRowId={(r) => r.id} renderCard={(r) => <p>card {r.name}</p>} />);
    expect(html).toContain('hidden md:block');
    expect(html).toMatch(/<ul aria-label="Products" class="[^"]*md:hidden/);
    expect(html).toContain('<p>card Abaya</p>');
  });
});
