import { expect, test } from '@playwright/test';
import { item, manifestOf } from './fixture';
import { getMessages } from '../i18n/messages';
import type { ContentItem } from '@slips/contracts';

for (const locale of ['en', 'ar'] as const) for (const width of [1280, 390]) {
  test(`${locale} ${width}: Home persists and Publish remains focusable until eligible`, async ({ page }, testInfo) => {
    const m = getMessages(locale).content;
    let current: ContentItem = { ...item, placements: [] };
    let publishes = 0;
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/v1/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (!path.startsWith('/v1/')) return route.continue();
      if (path.startsWith('/v1/preview/')) return route.fulfill({ json: manifestOf(current) });
      if (path.endsWith('/publish')) { publishes++; current = { ...current, status: 'published', updated_at: '2026-11-11T10:01:00.000Z' }; }
      else if (request.method() === 'PATCH') current = { ...current, ...request.postDataJSON(), updated_at: '2026-11-11T10:00:00.000Z' };
      return route.fulfill({ json: current });
    });
    await page.goto(`/?mode=loaded&lang=${locale}`);
    const publish = page.getByRole('button', { name: m.editor.publish.now, exact: true });
    await expect(publish).toHaveAttribute('aria-disabled', 'true');
    await publish.focus(); await publish.press('Enter'); await expect(publish).toBeFocused(); expect(publishes).toBe(0);
    await expect(page.getByText(m.statusReasons.no_placement, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: m.editor.placements.category, exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: m.editor.placements.home, exact: true }).check();
    await expect.poll(() => current.placements).toEqual([{ type: 'home' }]);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: m.editor.placements.home, exact: true })).toBeChecked();
    await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: testInfo.outputPath('home-placement.png'), fullPage: true });
    expect(publishes).toBe(0);
    await publish.click();
    await expect(page.getByRole('checkbox', { name: m.editor.placements.home, exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: m.editor.publish.now, exact: true })).toHaveCount(0);
    expect(current.placements).toEqual([{ type: 'home' }]); expect(publishes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
