// Pure budget evaluation, shared by check-size.mjs and its tests.
export const KB = 1024;

/** @type {{ id: string, label: string, cap: number, level: 'fail' | 'warn' }[]} */
export const BUDGETS = [
  { id: 'initial', label: 'Initial payload (stub + core loader and its static chunks)', cap: 50 * KB, level: 'fail' },
  { id: 'loader', label: 'Core loader', cap: 20 * KB, level: 'warn' },
  { id: 'viewer', label: 'Lazy viewer', cap: 25 * KB, level: 'fail' },
  { id: 'analytics', label: 'Analytics batcher', cap: 5 * KB, level: 'fail' },
];

/**
 * @param {Record<string, number>} sizes gzip bytes by budget id
 * @returns {{ id: string, label: string, size: number, cap: number, level: string, status: 'ok' | 'warn' | 'fail' }[]}
 */
export function evaluate(sizes) {
  return BUDGETS.map((b) => {
    const size = sizes[b.id];
    if (typeof size !== 'number') throw new Error(`missing size for budget "${b.id}"`);
    const over = size > b.cap;
    return { ...b, size, status: over ? (b.level === 'fail' ? 'fail' : 'warn') : 'ok' };
  });
}
