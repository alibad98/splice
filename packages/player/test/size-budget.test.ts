import { describe, expect, it } from 'vitest';
import { evaluate, KB } from '../scripts/size-budget.mjs';

const ok = { initial: 10 * KB, loader: 5 * KB, viewer: 10 * KB, analytics: 1 * KB };
const status = (sizes: Record<string, number>, id: string) => evaluate(sizes).find((r) => r.id === id)!.status;

describe('size budgets', () => {
  it('passes when everything is under cap', () => {
    expect(evaluate(ok).every((r) => r.status === 'ok')).toBe(true);
  });
  it('fails the initial payload above 50 KB, but not at the cap', () => {
    expect(status({ ...ok, initial: 50 * KB + 1 }, 'initial')).toBe('fail');
    expect(status({ ...ok, initial: 50 * KB }, 'initial')).toBe('ok');
  });
  it('only warns when the core loader exceeds 20 KB', () => {
    expect(status({ ...ok, loader: 21 * KB }, 'loader')).toBe('warn');
  });
  it('fails the viewer above 25 KB and the batcher above 5 KB, independently', () => {
    expect(status({ ...ok, viewer: 26 * KB }, 'viewer')).toBe('fail');
    expect(status({ ...ok, viewer: 26 * KB }, 'analytics')).toBe('ok');
    expect(status({ ...ok, analytics: 6 * KB }, 'analytics')).toBe('fail');
  });
  it('throws on a missing measurement', () => {
    expect(() => evaluate({ initial: 1 })).toThrow(/missing size/);
  });
});
