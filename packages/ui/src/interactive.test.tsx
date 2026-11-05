// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Button } from './button.js';
import { Checkbox } from './checkbox.js';
import { DataTable, type DataTableColumn } from './data-table.js';
import { ConfirmDialog, DialogHost, dialog } from './alert-dialog.js';
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from './sidebar.js';
import { sidebarOpenFromCookie } from './sidebar-state.js';
import { Field } from './field.js';
import { Input, PasswordInput } from './input.js';
import { OtpInput } from './otp-input.js';
import { Pagination, pageRange } from './pagination.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js';
import { Spinner } from './spinner.js';
import { Switch } from './switch.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js';
import { THEME_STORAGE_KEY } from './theme.js';
import { ThemeToggle } from './theme-toggle.js';
import { TOAST_DURATION_MS, Toaster, toast } from './toast.js';

beforeAll(() => {
  // jsdom lacks the pointer-capture and scroll APIs Radix Select uses.
  Object.assign(Element.prototype, {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  act(() => toast.clear());
  act(() => dialog.clear());
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

describe('ThemeToggle', () => {
  it('names the action (not a pressed state), switches the document theme and saves it', () => {
    document.documentElement.className = '';
    const onThemeChange = vi.fn();
    render(<ThemeToggle lightLabel="Switch to light theme" darkLabel="Switch to dark theme" onThemeChange={onThemeChange} />);
    const btn = screen.getByRole('button', { name: 'Switch to dark theme' });
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
    // The icon morph is driven by the dark variant, so it is right before hydration.
    expect(btn.innerHTML).toContain('dark:[scale:1.65]');
    fireEvent.click(btn);
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });
});

describe('Form controls (Input, PasswordInput, Field, Select, Checkbox, Switch, OtpInput, Tabs, ConfirmDialog)', () => {
  it('toggles password visibility via accessible button', () => {
    render(
      <Field label="Password" htmlFor="pw" error="Too short">
        <PasswordInput id="pw" showLabel="Show password" hideLabel="Hide password" invalid />
      </Field>,
    );
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Too short');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
  });

  describe('Select', () => {
    const renderSelect = (onChange: (v: string) => void, value = 'c1') =>
      render(
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-label="Category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All categories</SelectItem>
            <SelectItem value="c1">Abayas</SelectItem>
            <SelectItem value="c2">Scarves</SelectItem>
          </SelectContent>
        </Select>,
      );
    const openList = () => {
      const trigger = screen.getByRole('combobox', { name: 'Category' });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });
      return screen.findByRole('listbox');
    };

    it('renders a shadcn combobox trigger (never native <select>)', () => {
      const { container } = renderSelect(vi.fn());
      expect(container.querySelector('select')).toBeNull();
      expect(screen.getByRole('combobox', { name: 'Category' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('opens and reports the chosen item with the pointer', async () => {
      const onChange = vi.fn();
      renderSelect(onChange);
      await openList();
      const option = screen.getByRole('option', { name: 'Scarves' });
      fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
      fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
      expect(onChange).toHaveBeenCalledWith('c2');
    });

    it('chooses with the keyboard', async () => {
      const onChange = vi.fn();
      renderSelect(onChange);
      await openList();
      const option = screen.getByRole('option', { name: 'Scarves' });
      option.focus();
      fireEvent.keyDown(option, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('c2');
    });

    it('reports an empty string for the value="" ("All") item', async () => {
      const onChange = vi.fn();
      renderSelect(onChange);
      await openList();
      const option = screen.getByRole('option', { name: 'All categories' });
      option.focus();
      fireEvent.keyDown(option, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledWith('');
    });

    it('shows the "All" item as selected when value is ""', async () => {
      renderSelect(vi.fn(), '');
      await openList();
      expect(screen.getByRole('option', { name: 'All categories' }).getAttribute('aria-selected')).toBe('true');
    });
  });

  it('Checkbox, Switch, OtpInput and Tabs work via keyboard and pointer', () => {
    const onOtp = vi.fn();
    render(
      <div>
        <Checkbox aria-label="Accept" />
        <Switch aria-label="Auto sync" />
        <OtpInput value="12" onChange={onOtp} />
        <Tabs defaultValue="stories">
          <TabsList>
            <TabsTrigger value="stories">Stories</TabsTrigger>
            <TabsTrigger value="reels">Reels</TabsTrigger>
          </TabsList>
          <TabsContent value="stories">Stories view</TabsContent>
          <TabsContent value="reels">Reels view</TabsContent>
        </Tabs>
      </div>,
    );
    const cb = screen.getByRole('checkbox', { name: 'Accept' });
    fireEvent.click(cb);
    expect(cb.getAttribute('data-state')).toBe('checked');

    const sw = screen.getByRole('switch', { name: 'Auto sync' });
    fireEvent.click(sw);
    expect(sw.getAttribute('data-state')).toBe('checked');

    const reels = screen.getByRole('tab', { name: 'Reels' });
    fireEvent.mouseDown(reels, { button: 0 });
    expect(reels.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Reels view')).toBeTruthy();
    expect(screen.queryByText('Stories view')).toBeNull();
  });

  it('ConfirmDialog renders modal dialog and triggers onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => undefined}
        title="Delete story?"
        description="This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Cancel');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('Field wiring and OtpInput', () => {
  it('Field gives its control an id, description and invalid state without manual wiring', () => {
    const { rerender } = render(
      <Field label="Email" hint="We never share it">
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    const hintId = input.getAttribute('aria-describedby')!;
    expect(document.getElementById(hintId)?.textContent).toBe('We never share it');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    rerender(
      <Field label="Email" error="Enter a valid email">
        <Input type="email" />
      </Field>,
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a valid email');
  });

  it('OtpInput is a labelled LTR group that spreads pasted and autofilled codes', () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(
      <Field label="Code">
        <OtpInput value="" onChange={onChange} onComplete={onComplete} digitLabel="Digit" ofLabel="of" />
      </Field>,
    );
    const group = screen.getByRole('group', { name: 'Code' });
    expect(group.getAttribute('dir')).toBe('ltr');
    const first = screen.getByRole('textbox', { name: 'Digit 1 of 6' });
    fireEvent.paste(first, { clipboardData: { getData: () => '12-34 56' } });
    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
    // iOS one-time-code autofill drops the whole code into the first slot.
    fireEvent.change(first, { target: { value: '987654' } });
    expect(onChange).toHaveBeenLastCalledWith('987654');
  });

  describe('OtpInput keyboard and edit behaviour', () => {
    function Harness({ initial = '', onComplete }: { initial?: string; onComplete?: (v: string) => void }) {
      const [value, setValue] = useState(initial);
      return (
        <>
          <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
          <output data-testid="value">{value}</output>
        </>
      );
    }
    const slot = (n: number) => screen.getByRole('textbox', { name: `Digit ${n} of 6` }) as HTMLInputElement;
    const current = () => screen.getByTestId('value').textContent;

    it('typing a digit advances focus to the next slot', () => {
      render(<Harness />);
      slot(1).focus();
      fireEvent.change(slot(1), { target: { value: '4' } });
      expect(current()).toBe('4');
      expect(document.activeElement).toBe(slot(2));
    });

    it('Backspace on an empty slot clears the previous digit and moves focus back', () => {
      render(<Harness initial="12" />);
      slot(3).focus();
      fireEvent.keyDown(slot(3), { key: 'Backspace' });
      expect(current()).toBe('1');
      expect(document.activeElement).toBe(slot(2));
    });

    it('ArrowLeft, ArrowRight, Home and End move focus', () => {
      render(<Harness initial="123" />);
      slot(2).focus();
      fireEvent.keyDown(slot(2), { key: 'ArrowRight' });
      expect(document.activeElement).toBe(slot(3));
      fireEvent.keyDown(slot(3), { key: 'ArrowLeft' });
      expect(document.activeElement).toBe(slot(2));
      fireEvent.keyDown(slot(2), { key: 'End' });
      expect(document.activeElement).toBe(slot(4));
      fireEvent.keyDown(slot(4), { key: 'Home' });
      expect(document.activeElement).toBe(slot(1));
    });

    it('a digit typed past the entered digits lands in the next free slot', () => {
      render(<Harness initial="12" />);
      slot(5).focus();
      fireEvent.change(slot(5), { target: { value: '5' } });
      expect(current()).toBe('125');
      expect(document.activeElement).toBe(slot(4));
    });

    it('a change that empties a filled slot (no Backspace keydown) clears that digit', () => {
      render(<Harness initial="123" />);
      fireEvent.change(slot(3), { target: { value: '' } });
      expect(current()).toBe('12');
    });

    it('pasting text with no digits leaves the value unchanged', () => {
      render(<Harness initial="12" />);
      fireEvent.paste(slot(1), { clipboardData: { getData: () => 'abc' } });
      expect(current()).toBe('12');
    });

    it('pasting a full code fills every slot and completes once', () => {
      const onComplete = vi.fn();
      render(<Harness onComplete={onComplete} />);
      fireEvent.paste(slot(1), { clipboardData: { getData: () => '123456' } });
      expect(current()).toBe('123456');
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith('123456');
    });
  });
});

describe('Global dialog (dialog.confirm + DialogHost)', () => {
  const ask = (onConfirm?: () => unknown) =>
    dialog.confirm({ tone: 'danger', icon: 'logout', title: 'Sign out?', description: 'You will sign in again.', confirmLabel: 'Sign out', cancelLabel: 'Stay', onConfirm });

  it('opens an alertdialog with Cancel focused and resolves false on cancel', async () => {
    render(<DialogHost />);
    let result: Promise<boolean> | undefined;
    act(() => {
      result = ask();
    });
    const panel = screen.getByRole('alertdialog');
    expect(panel.getAttribute('data-tone')).toBe('danger');
    expect(panel.querySelector('[data-icon="logout"]')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Stay');
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await expect(result).resolves.toBe(false);
  });

  it('keeps the dialog open and pending while an async onConfirm runs, then resolves true', async () => {
    render(<DialogHost />);
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (finish = r)));
    let result: Promise<boolean> | undefined;
    act(() => {
      result = ask(onConfirm);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sign out' }).getAttribute('aria-busy')).toBe('true');
    expect(dialog.current()?.open).toBe(true);
    await act(async () => finish());
    await expect(result).resolves.toBe(true);
    expect(dialog.current()?.open).toBe(false);
  });

  it('stays open when onConfirm rejects, so the user can retry or cancel', async () => {
    render(<DialogHost />);
    act(() => void ask(() => Promise.reject(new Error('nope'))));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })));
    expect(dialog.current()?.open).toBe(true);
    expect(dialog.current()?.pending).toBe(false);
  });
});

describe('Sidebar', () => {
  const tree = (defaultOpen: boolean) => (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar mobileTitle="Menu" closeLabel="Close">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Products" isActive>
              <span>Products</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </Sidebar>
      <SidebarTrigger aria-label="Toggle menu" />
    </SidebarProvider>
  );

  it('renders the saved state on the server (no width jump on hydration)', () => {
    expect(renderToStaticMarkup(tree(false))).toContain('data-collapsible="icon"');
    expect(renderToStaticMarkup(tree(true))).toContain('data-state="expanded"');
    expect(sidebarOpenFromCookie(undefined)).toBe(true);
    expect(sidebarOpenFromCookie('false')).toBe(false);
  });

  it('collapses to the icon rail from the trigger and Ctrl+B, and saves the state in a cookie', () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const { container } = render(tree(true));
    const sidebar = () => container.querySelector('[data-slot="sidebar"]')!;
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(sidebar().getAttribute('data-collapsible')).toBe('icon');
    expect(document.cookie).toContain('sidebar_state=false');
    fireEvent.keyDown(window, { key: 'b', code: 'KeyB', ctrlKey: true });
    expect(sidebar().getAttribute('data-state')).toBe('expanded');
    expect(document.cookie).toContain('sidebar_state=true');
    // Arabic layout: same physical key, different character.
    fireEvent.keyDown(window, { key: 'لا', code: 'KeyB', ctrlKey: true });
    expect(sidebar().getAttribute('data-state')).toBe('collapsed');
  });

  it('on mobile the trigger opens the menu in a dialog and choosing an item closes it', () => {
    window.matchMedia = ((q: string) => ({ matches: q === '(max-width: 767px)', media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    render(tree(true));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    const dialogEl = screen.getByRole('dialog');
    const item = within(dialogEl).getByRole('button', { name: 'Products' });
    fireEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Pagination', () => {
  const labels = { nav: 'Pages', summary: ({ from, to, total }: { from: number; to: number; total: number }) => `${from}-${to} of ${total}`, previous: 'Previous', next: 'Next', pageSize: 'Rows per page' };

  it('computes the visible range, 0-0 when empty', () => {
    expect(pageRange(1, 10, 23)).toEqual({ from: 1, to: 10 });
    expect(pageRange(3, 10, 23)).toEqual({ from: 21, to: 23 });
    expect(pageRange(2, 25, 23)).toEqual({ from: 0, to: 0 });
    expect(pageRange(2, 10, 23, 4)).toEqual({ from: 11, to: 14 });
  });

  it('is a named nav with the summary; Previous is off on page 1 and Next on the last page', () => {
    const onPageChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={10} total={23} onPageChange={onPageChange} labels={labels} />);
    const nav = screen.getByRole('navigation', { name: 'Pages' });
    expect(within(nav).getByText('1-10 of 23')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    rerender(<Pagination page={3} pageSize={10} total={23} onPageChange={onPageChange} labels={labels} />);
    expect(screen.getByText('21-23 of 23')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    // No sizes given: no rows-per-page select.
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('offers the page sizes in a labelled select and reports the choice', async () => {
    const onPageSizeChange = vi.fn();
    render(<Pagination page={1} pageSize={10} total={23} onPageChange={() => undefined} pageSizes={[10, 25, 50]} onPageSizeChange={onPageSizeChange} labels={labels} />);
    const trigger = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(trigger.textContent).toContain('10');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByRole('option', { name: '50' });
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe('DataTable row activation', () => {
  interface Row {
    id: string;
    name: string;
  }
  const data: Row[] = [
    { id: 'a', name: 'Abaya' },
    { id: 'b', name: 'Bag' },
  ];
  const columns: DataTableColumn<Row>[] = [
    { id: 'name', header: 'Name', cell: (r) => r.name },
    { id: 'menu', header: 'Actions', cell: (r) => <button type="button">Menu {r.name}</button> },
  ];

  it('activates a row on click or Enter on the focused row (including small-screen cards), but not from controls inside it', () => {
    const onRowActivate = vi.fn();
    render(
      <DataTable
        label="Items"
        columns={columns}
        data={data}
        getRowId={(r) => r.id}
        onRowActivate={onRowActivate}
        renderCard={(r) => (
          <div>
            <span>Card {r.name}</span>
            <button type="button">CardMenu {r.name}</button>
          </div>
        )}
      />,
    );
    fireEvent.click(screen.getByText('Abaya'));
    expect(onRowActivate).toHaveBeenLastCalledWith(data[0]);
    const rowB = screen.getByText('Bag').closest('tr')!;
    expect(rowB.tabIndex).toBe(0);
    rowB.focus();
    fireEvent.keyDown(rowB, { key: 'Enter' });
    expect(onRowActivate).toHaveBeenLastCalledWith(data[1]);
    expect(onRowActivate).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Menu Bag' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Menu Bag' }), { key: 'Enter' });
    fireEvent.keyDown(rowB, { key: ' ' });
    expect(onRowActivate).toHaveBeenCalledTimes(2);

    const cardA = screen.getByText('Card Abaya').closest('li')!;
    expect(cardA.tabIndex).toBe(0);
    fireEvent.click(screen.getByText('Card Abaya'));
    expect(onRowActivate).toHaveBeenLastCalledWith(data[0]);
    const cardB = screen.getByText('Card Bag').closest('li')!;
    cardB.focus();
    fireEvent.keyDown(cardB, { key: 'Enter' });
    expect(onRowActivate).toHaveBeenLastCalledWith(data[1]);
    fireEvent.click(screen.getByRole('button', { name: 'CardMenu Bag' }));
    expect(onRowActivate).toHaveBeenCalledTimes(4);
  });
});
