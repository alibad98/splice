import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert.js';
import { Badge } from './badge.js';
import { Banner } from './banner.js';
import { Card, CardTitle } from './card.js';
import { cn } from './cn.js';
import { DataTable, type DataTableColumn } from './data-table.js';
import { EmptyState } from './empty-state.js';
import { Icon, iconMirrors } from './icon.js';
import { Meter } from './meter.js';
import { Progress } from './progress.js';
import { Skeleton } from './skeleton.js';
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
    // Button type scale vs colour: both classes survive.
    expect(cn('text-button text-primary-foreground')).toBe('text-button text-primary-foreground');
    expect(cn('text-button-sm text-foreground')).toBe('text-button-sm text-foreground');
    expect(cn('text-button-lg text-accent-foreground')).toBe('text-button-lg text-accent-foreground');
    expect(cn('text-button', 'text-button-lg')).toBe('text-button-lg');
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

describe('Badge', () => {
  it('is always a bordered pill and keeps ink text on coral and amber fills', () => {
    for (const variant of ['soft', 'solid', 'outline'] as const) {
      const html = renderToStaticMarkup(<Badge variant={variant} tone="brand">New</Badge>);
      expect(html).toContain('rounded-pill border');
      expect(html).toContain(`data-variant="${variant}"`);
    }
    expect(renderToStaticMarkup(<Badge variant="solid" tone="brand">New</Badge>)).toContain('text-primary-foreground');
    expect(renderToStaticMarkup(<Badge variant="solid" tone="accent">Pro</Badge>)).toContain('text-accent-foreground');
  });

  it('shows an icon or a dot (pulse stops under reduced motion), never both', () => {
    const withIcon = renderToStaticMarkup(<Badge icon="check" dot>Verified</Badge>);
    expect(withIcon).toContain('data-icon="check"');
    expect(withIcon).not.toContain('rounded-full');
    const live = renderToStaticMarkup(<Badge tone="success" dot pulse>Live</Badge>);
    expect(live).toContain('animate-ping');
    expect(live).toContain('motion-reduce:animate-none');
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

describe('Icon', () => {
  it('mirrors directional icons in RTL and keeps media/status icons unmirrored', () => {
    expect(iconMirrors('chevron')).toBe(true);
    expect(iconMirrors('arrow')).toBe(true);
    expect(iconMirrors('external')).toBe(true);
    expect(iconMirrors('play')).toBe(false);
    expect(iconMirrors('sun')).toBe(false);
    expect(renderToStaticMarkup(<Icon name="arrow" />)).toContain('rtl:-scale-x-100');
    expect(renderToStaticMarkup(<Icon name="play" />)).not.toContain('rtl:');
  });
});

describe('Progress', () => {
  it('renders determinate progress clamped to 0..max with progressbar ARIA', () => {
    const html = renderToStaticMarkup(<Progress value={40} max={100} label="Uploading" />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-valuetext="40%"');
    expect(html).toContain('width:40%');

    const clamped = renderToStaticMarkup(<Progress value={140} max={100} label="Clamped" />);
    expect(clamped).toContain('aria-valuenow="100"');
    expect(clamped).toContain('width:100%');
  });

  it('renders indeterminate progress that stops under reduced motion', () => {
    const html = renderToStaticMarkup(<Progress label="Syncing" />);
    expect(html).toContain('data-state="indeterminate"');
    expect(html).not.toContain('aria-valuenow');
    expect(html).toContain('animate-progress-indeterminate');
    expect(html).toContain('motion-reduce:animate-none');
  });
});

describe('Meter', () => {
  it('switches fill at 80% warning and 100% destructive, always showing "n of m" text', () => {
    const normal = renderToStaticMarkup(<Meter value={5} max={10} label="Stories" valueLabel="5 of 10" />);
    expect(normal).toContain('role="meter"');
    expect(normal).toContain('5 of 10');
    expect(normal).toContain('bg-foreground');

    const warn = renderToStaticMarkup(<Meter value={8} max={10} label="Stories" valueLabel="8 of 10" />);
    expect(warn).toContain('data-tone="warning"');
    expect(warn).toContain('bg-warning');

    const full = renderToStaticMarkup(<Meter value={10} max={10} label="Stories" valueLabel="10 of 10" />);
    expect(full).toContain('data-tone="danger"');
    expect(full).toContain('bg-destructive');

    const zero = renderToStaticMarkup(<Meter value={0} max={0} label="Stories" valueLabel="0 of 0" />);
    expect(zero).toContain('0 of 0');
    expect(zero).toContain('width:0%');
  });
});

describe('Alert and Banner', () => {
  it('renders semantic icon + text for every Alert tone and supports retry action', () => {
    const html = renderToStaticMarkup(
      <Alert tone="danger" title="Failed to load" description="Check connection" action={{ label: 'Retry', onClick: () => undefined, pending: true }} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('data-icon="danger"');
    expect(html).toContain('Failed to load');
    expect(html).toContain('aria-busy="true"');
  });

  it('renders Banner in warning and danger tones with action', () => {
    const html = renderToStaticMarkup(
      <Banner tone="danger" action={{ label: 'Reconnect', href: '/settings' }}>
        Store disconnected
      </Banner>,
    );
    expect(html).toContain('data-slot="banner"');
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('Store disconnected');
    expect(html).toContain('Reconnect');
  });
});

describe('EmptyState and Skeleton', () => {
  it('renders EmptyState default and filtered variants', () => {
    const def = renderToStaticMarkup(<EmptyState title="No products" description="Add products in Salla" action={<a href="#salla">Open</a>} />);
    expect(def).toContain('No products');
    expect(def).toContain('Open');

    const filtered = renderToStaticMarkup(<EmptyState variant="filtered" description="No matches" />);
    expect(filtered).toContain('data-variant="filtered"');
  });

  it('renders Skeleton with status role, busy state and reduced-motion guard', () => {
    const html = renderToStaticMarkup(<Skeleton label="Loading..." rows={3} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('motion-reduce:animate-none');
    expect(html.match(/data-boneyard-bone/g)).toHaveLength(3);
  });
});
