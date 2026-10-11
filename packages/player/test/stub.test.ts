import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../stub/stub.js', import.meta.url), 'utf8');
const ALLOWED_ORIGINS = ['https://cdn.slips.app', 'https://api.slips.app'];

interface FakeScript {
  src?: string;
  parentNode: { removeChild(n: FakeScript): void } | null;
  onerror?: () => void;
}

function makeWindow(opts: { throwOnAppend?: boolean } = {}) {
  const appended: FakeScript[] = [];
  const timers: (() => void)[] = [];
  const head = {
    appendChild(n: FakeScript) {
      if (opts.throwOnAppend) throw new Error('CSP blocked');
      n.parentNode = head;
      appended.push(n);
    },
    removeChild(n: FakeScript) {
      appended.splice(appended.indexOf(n), 1);
      n.parentNode = null;
    },
  };
  const win: Record<string, unknown> = {
    URL,
    document: { head, documentElement: head, createElement: () => ({ parentNode: null }) as FakeScript },
    setTimeout: (fn: () => void) => timers.push(fn),
  };
  win.window = win;
  return { win, appended, timers };
}

const run = (win: Record<string, unknown>) => runInNewContext(source, win);

describe('stub', () => {
  it('sets the guard and loads the loader from the Slips CDN once', () => {
    const { win, appended } = makeWindow();
    run(win);
    run(win); // second boot exits
    expect(win.__slips).toBeDefined();
    expect(appended).toHaveLength(1);
    expect(new URL(appended[0]!.src!).origin).toBe('https://cdn.slips.app');
  });

  it('exits when a guard already exists', () => {
    const { win, appended } = makeWindow();
    win.__slips = { v: 1 };
    run(win);
    expect(appended).toHaveLength(0);
  });

  it('fails silently when the script cannot be attached', () => {
    const { win } = makeWindow({ throwOnAppend: true });
    expect(() => run(win)).not.toThrow();
  });

  it('removes the script when the load errors or times out', () => {
    const a = makeWindow();
    run(a.win);
    a.appended[0]!.onerror!();
    expect(a.appended).toHaveLength(0);
    const b = makeWindow();
    run(b.win);
    b.timers[0]!();
    expect(b.appended).toHaveLength(0);
  });

  it('keeps the script after the loader reports ready', () => {
    const { win, appended, timers } = makeWindow();
    run(win);
    (win.__slips as { ready?: boolean }).ready = true;
    timers[0]!();
    expect(appended).toHaveLength(1);
  });

  it('contains no absolute URL outside the configured Slips origins', () => {
    const urls = source.match(/https?:\/\/[^'"\s)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(ALLOWED_ORIGINS).toContain(new URL(u).origin);
  });
});
