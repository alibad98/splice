// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './button.js';
import { Spinner } from './spinner.js';
import { TOAST_DURATION_MS, Toaster, toast } from './toast.js';

afterEach(() => {
  cleanup();
  act(() => toast.clear());
  vi.useRealTimers();
});

describe('Button', () => {
  it.each([
    ['primary', 'bg-primary text-primary-foreground'],
    ['secondary', 'border-input-border'],
    ['accent', 'bg-accent text-accent-foreground'],
    ['ghost', 'bg-transparent'],
    ['destructive', 'bg-destructive text-destructive-foreground'],
  ] as const)('%s is a pill with its token colours', (variant, classes) => {
    const html = renderToStaticMarkup(<Button variant={variant}>Save</Button>);
    expect(html).toContain('rounded-pill');
    expect(html).toContain(`data-variant="${variant}"`);
    for (const c of classes.split(' ')) expect(html).toContain(c);
    expect(html).toContain('type="button"');
  });

  it.each([
    ['sm', 'min-h-8'],
    ['md', 'min-h-9'],
    ['lg', 'min-h-11'],
  ] as const)('size %s is %s (32/36/44px)', (size, cls) => {
    expect(renderToStaticMarkup(<Button size={size}>Go</Button>)).toContain(cls);
  });

  it('runs onClick when idle', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Sync</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('pending: spinner, aria-busy, focusable (not disabled), clicks and Enter ignored, focus stays', () => {
    const onClick = vi.fn();
    render(
      <Button pending onClick={onClick}>
        Sync
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sync' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(button);
    // Enter and Space activate a button by dispatching a native click: that click must be ignored too.
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
  });

  it('pending submit button does not submit its form', () => {
    const onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" pending>
          Save
        </Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('unavailable: aria-disabled, focusable, the reason is its description (not its name), clicks ignored', () => {
    const onClick = vi.fn();
    render(
      <Button unavailableReason="Connect your store first" onClick={onClick}>
        Publish
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Publish' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    const described = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(described?.textContent).toBe('Connect your store first');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps a caller aria-describedby alongside the reason', () => {
    render(
      <Button aria-describedby="hint" unavailableReason="Not now">
        Go
      </Button>,
    );
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toMatch(/^hint \S+$/);
  });
});

describe('Spinner', () => {
  it('is decorative by default and a labelled status when given a label', () => {
    expect(renderToStaticMarkup(<Spinner />)).toMatch(/^<svg[^>]*aria-hidden="true"/);
    const labelled = renderToStaticMarkup(<Spinner label="Loading" />);
    expect(labelled).toContain('role="status"');
    expect(labelled).toContain('<span class="sr-only">Loading</span>');
  });

  it('spins with CSS only and stops under reduced motion', () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(html).toContain('animate-spin');
    expect(html).toContain('motion-reduce:animate-none');
    // The global reduced-motion rule stops every animation and transition too.
    const css = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/);
  });
});

describe('Toast', () => {
  const mount = (dir: 'ltr' | 'rtl' = 'ltr') => render(<Toaster label="Notifications ({hotkey})" closeLabel="Close" dir={dir} />);

  it('mounts an empty, named region reachable with F8 before any toast', () => {
    mount();
    const region = screen.getByRole('region', { name: 'Notifications (F8)' });
    expect(region.querySelector('ol')?.children).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'F8', code: 'F8' });
    expect(document.activeElement).toBe(region.querySelector('ol'));
  });

  it('a plain toast is announced politely and dismisses after 5 s, paused while hovered', () => {
    vi.useFakeTimers();
    mount();
    act(() => void toast({ title: 'Changes saved' }));
    expect(screen.getByText('Changes saved')).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(document.querySelector('[aria-live="assertive"]')).toBeNull();
    const region = screen.getByRole('region');
    fireEvent.pointerMove(region.querySelector('ol')!);
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS + 1000));
    expect(toast.list()[0]?.open).toBe(true);
    fireEvent.pointerLeave(region);
    act(() => void vi.advanceTimersByTime(TOAST_DURATION_MS + 1000));
    expect(toast.list()).toHaveLength(0);
  });

  it('a toast with an action never auto-dismisses; the action runs and closes it', () => {
    vi.useFakeTimers();
    mount();
    const onRetry = vi.fn();
    act(() => void toast({ title: 'We could not sync', tone: 'danger', action: { label: 'Retry', onClick: onRetry } }));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText('We could not sync')).toBeTruthy();
    expect(document.querySelector('[data-slot="toast"]')?.getAttribute('data-tone')).toBe('danger');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(toast.list()[0]?.open).toBe(false);
  });

  it('the same id replaces the toast instead of stacking a second one; close dismisses', () => {
    mount();
    act(() => void toast({ id: 'run-1', title: 'First' }));
    act(() => void toast({ id: 'run-1', title: 'Second' }));
    expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1);
    expect(screen.getByText('Second')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(toast.list()[0]?.open).toBe(false);
  });

  it('sits at the bottom-start corner (logical properties) in both directions', () => {
    mount('rtl');
    const viewport = screen.getByRole('region').querySelector('ol')!;
    expect(viewport.className).toContain('bottom-0');
    expect(viewport.className).toContain('start-0');
  });

  it('animates with CSS keyframes that the reduced-motion rule stops', () => {
    mount();
    act(() => void toast({ title: 'Hi' }));
    expect(document.querySelector('[data-slot="toast"]')!.className).toContain('data-[state=open]:animate-toast-in');
    const css = readFileSync(join(process.cwd(), 'src/styles/globals.css'), 'utf8');
    expect(css).toContain('@keyframes toast-in');
  });
});
