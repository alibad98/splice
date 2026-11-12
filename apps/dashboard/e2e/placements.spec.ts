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
    await expect.poll(() => current.placements).toEqual([{ type: 'home', layout: 'ring' }]);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: m.editor.placements.home, exact: true })).toBeChecked();
    await expect(publish).not.toHaveAttribute('aria-disabled', 'true');
    await page.screenshot({ path: testInfo.outputPath('home-placement.png'), fullPage: true });
    expect(publishes).toBe(0);
    await publish.click();
    await expect(page.getByRole('checkbox', { name: m.editor.placements.home, exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: m.editor.publish.now, exact: true })).toHaveCount(0);
    expect(current.placements).toEqual([{ type: 'home', layout: 'ring' }]); expect(publishes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const locale of ['en', 'ar'] as const) for (const width of [1280, 390]) {
  test(`${locale} ${width}: Ring is the fixed Home layout; Reel, Bar and Schedule stay focusable and unavailable with inline reasons`, async ({ page }, testInfo) => {
    const m = getMessages(locale).content;
    let current: ContentItem = { ...item, placements: [] };
    const writes: unknown[] = [];
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/v1/**', async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (!path.startsWith('/v1/')) return route.continue();
      if (path.startsWith('/v1/preview/')) return route.fulfill({ json: manifestOf(current) });
      if (request.method() !== 'GET') writes.push(request.postDataJSON());
      if (request.method() === 'PATCH') current = { ...current, ...request.postDataJSON(), updated_at: '2026-11-11T10:00:00.000Z' };
      return route.fulfill({ json: current });
    });
    await page.goto(`/?mode=loaded&lang=${locale}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');

    const reel = page.getByRole('tab', { name: m.formats.reel, exact: true });
    await expect(reel).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(m.editor.formatTitle.reelUnavailable, { exact: true })).toBeVisible();
    await reel.focus(); await expect(reel).toBeFocused();
    await reel.press('Enter'); await reel.click({ force: true });
    await expect(page.getByRole('tab', { name: m.formats.story, exact: true })).toHaveAttribute('aria-selected', 'true');

    const schedule = page.getByRole('button', { name: m.editor.publish.schedule, exact: true });
    await expect(schedule).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(m.editor.publish.scheduleUnavailable, { exact: true }).filter({ visible: true })).toBeVisible();
    await schedule.focus(); await schedule.press('Enter'); await expect(schedule).toBeFocused();

    await page.getByRole('checkbox', { name: m.editor.placements.home, exact: true }).check();
    await expect.poll(() => current.placements).toEqual([{ type: 'home', layout: 'ring' }]);
    const layouts = page.getByRole('radiogroup', { name: m.editor.layout.heading, exact: true });
    await expect(layouts.getByRole('radio', { name: m.editor.layout.ring, exact: true })).toHaveAttribute('aria-checked', 'true');
    const bar = layouts.getByRole('radio', { name: m.editor.layout.bar, exact: true });
    await expect(bar).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(m.editor.layout.barUnavailable, { exact: true }).filter({ visible: true })).toBeVisible();
    await bar.focus(); await bar.press('Enter'); await bar.click({ force: true }); await expect(bar).toBeFocused();
    await expect(layouts.getByRole('radio', { name: m.editor.layout.ring, exact: true })).toHaveAttribute('aria-checked', 'true');

    await page.reload();
    await expect(page.getByRole('radiogroup', { name: m.editor.layout.heading, exact: true }).getByRole('radio', { name: m.editor.layout.ring, exact: true })).toHaveAttribute('aria-checked', 'true');
    expect(writes.every(body => JSON.stringify(body).indexOf('"bar"') === -1 && JSON.stringify(body).indexOf('"reel"') === -1)).toBe(true);
    expect(current.format).toBe('story');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('ring-layout.png'), fullPage: true });
  });
}
