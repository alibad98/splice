import { expect, test, type Page } from '@playwright/test';

const THEMES = ['a', 'b', 'c'] as const;

interface ShiftRecord {
  value: number;
  slips: boolean;
}

/** Records every layout-shift entry and flags those whose sources touch a Slips element. */
async function observeShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: ShiftRecord[] };
    w.__shifts = [];
    const isSlips = (n: Node | null) => {
      const el = n instanceof Element ? n : (n?.parentElement ?? null);
      return !!el?.closest('[data-slips-root],[data-slips-anchor]');
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node: Node | null }[] })[]) {
        if (e.hadRecentInput) continue;
        const sources = e.sources ?? [];
        // No resolvable source (node removed) is treated as attributable: be conservative.
        w.__shifts.push({ value: e.value, slips: sources.length === 0 || sources.some((s) => isSlips(s.node)) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: ShiftRecord[] }).__shifts);
const slipsBoxes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-slips-root]')].map((el) => el.getBoundingClientRect().height).filter((h) => h > 0),
  );

for (const theme of THEMES) {
  test.describe(`theme ${theme}`, () => {
    const open = async (page: Page, key: string) => {
      await observeShifts(page);
      await page.goto(`/theme-${theme}.html?key=${key}`);
    };
    const settle = (page: Page) => page.waitForTimeout(1200); // past the 500 ms loader timeout

    test('content present: Slips renders and nothing shifts', async ({ page }) => {
      await open(page, 'content');
      await expect(page.locator('[data-slips-root]')).toHaveCount(1);
      await settle(page);
      expect((await shifts(page)).filter((s) => s.slips)).toEqual([]);
      expect(await shifts(page)).toEqual([]);
    });

    for (const [name, key] of [['no content', 'empty'], ['API timeout', 'timeout'], ['invalid key', 'bad']] as const) {
      test(`${name}: no Slips element occupies layout space`, async ({ page }) => {
        await open(page, key);
        await settle(page);
        await expect(page.locator('[data-slips-root]')).toHaveCount(0);
        expect(await slipsBoxes(page)).toEqual([]);
        expect((await shifts(page)).filter((s) => s.slips)).toEqual([]);
        expect(await shifts(page)).toEqual([]);
      });
    }

    test('scroll past the anchor before the manifest arrives', async ({ page }) => {
      await open(page, 'slow-content');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      expect(await page.locator('[data-slips-root]').count()).toBe(0); // manifest still pending
      await settle(page);
      expect(await page.locator('[data-slips-root]').count()).toBe(0); // anchor is above the viewport: not mounted
      expect((await shifts(page)).filter((s) => s.slips)).toEqual([]);
      expect(await shifts(page)).toEqual([]);
    });

    test('anchor inside the viewport at manifest time: nothing mounted, no shift', async ({ page }) => {
      await open(page, 'slow-content');
      await page.locator('[data-slips-anchor]').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.querySelector('[data-slips-anchor]')!.scrollIntoView({ block: 'center' }));
      await settle(page);
      expect(await page.locator('[data-slips-root]').count()).toBe(0);
      expect(await shifts(page)).toEqual([]);
    });
  });
}
