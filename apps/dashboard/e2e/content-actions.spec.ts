import { expect, test } from '@playwright/test';
import { item } from './fixture';
import { getMessages } from '../i18n/messages';
import type { ContentItem } from '@slips/contracts';

for (const locale of ['ar', 'en'] as const) for (const width of [1280, 390]) {
  test(`${locale} ${width}: list menus, keyboard Edit, Restore, guarded Duplicate and recovery`, async ({ page }, testInfo) => {
    const m = getMessages(locale).content;
    const original = { ...item, title: 'Summer story', status: 'archived' as const, archived_from: 'published' as const, slides: [] };
    const copyId = '019a473a-0000-7000-8000-000000000099';
    let current: ContentItem = { ...original };
    let release!: () => void;
    let duplicateCalls = 0;
    let failRestore = true;
    const held = new Promise<void>(resolve => { release = resolve; });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/v1/content**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/v1/')) return route.continue();
      if (path.endsWith('/restore')) {
        if (failRestore) return route.fulfill({ status: 409, json: { code: 'invalid_transition' } });
        current = { ...current, status: 'draft', archived_from: null };
        return route.fulfill({ json: current });
      }
      if (path.endsWith('/duplicate')) {
        duplicateCalls++;
        await held;
        return route.fulfill({ status: 201, json: { ...current, id: copyId, title: current.title + ' (copy)', status: 'draft', archived_from: null } });
      }
      return route.fulfill({ json: { v: 1, items: [current], total: 1, page: 1, page_size: 10, counts: { all: 1, published: 0, scheduled: 0, drafts: current.status === 'archived' ? 0 : 1 } } });
    });
    const open = async () => {
      const trigger = page.getByRole('button', { name: m.menu.label.replace('{title}', original.title), exact: true }).filter({ visible: true });
      await trigger.focus();
      await trigger.press('Enter');
      return page.getByRole('menu');
    };
    await page.goto(`/?mode=list&lang=${locale}`);
    await open();
    await expect(page.getByRole('menuitem', { name: m.menu.restore, exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`menu-${locale}-${width}.png`), fullPage: true, animations: 'disabled' });
    await page.getByRole('menuitem', { name: m.menu.edit, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/content/${item.id}\\?lang=${locale}$`));
    await page.goto(`/?mode=list&lang=${locale}`);
    await open();
    await page.getByRole('menuitem', { name: m.menu.restore, exact: true }).click();
    await expect(page.getByText(m.restore.failed, { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    failRestore = false;
    await open();
    await page.getByRole('menuitem', { name: m.menu.restore, exact: true }).click();
    await expect(page.getByText(m.restore.done, { exact: true })).toBeVisible();
    await expect(page.getByTestId('count-drafts')).toHaveText('1');
    await open();
    await expect(page.getByRole('menuitem', { name: m.menu.restore, exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: m.menu.duplicate, exact: true }).click();
    await expect.poll(() => duplicateCalls).toBe(1);
    await open();
    for (const action of [m.menu.edit, m.menu.duplicate, m.menu.archive, m.menu.delete]) await expect(page.getByRole('menuitem', { name: action, exact: true })).toHaveAttribute('aria-disabled', 'true');
    expect(new URL(page.url()).pathname).toBe('/');
    release();
    await expect(page).toHaveURL(new RegExp(`/content/${copyId}\\?lang=${locale}$`));
    expect(duplicateCalls).toBe(1);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
