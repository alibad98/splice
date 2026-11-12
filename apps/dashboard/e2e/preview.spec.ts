import { expect, test } from '@playwright/test';
import { item, manifestOf } from './fixture';
import { getMessages } from '../i18n/messages';
for (const locale of ['en', 'ar'] as const) for (const width of [1280, 390]) test(`${locale} ${width}: real player, saved update, retry and simulated CTA`, async ({ page }) => {
  page.on('pageerror', error => console.error('HARNESS', error.message));
  page.on('console', message => { if (message.type() === 'error') console.error('BROWSER', message.text()); });
  const copy = getMessages(locale).content.editor;
  let saved = { ...item }, fail = true, count = 0;
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/v1/')) return route.continue();
    if (path.startsWith('/v1/preview/')) { count++; return route.fulfill({ status: fail ? 503 : 200, json: fail ? {} : manifestOf(saved) }); }
    if (route.request().method() === 'PATCH') saved = { ...saved, ...route.request().postDataJSON(), updated_at: new Date().toISOString() };
    return route.fulfill({ json: saved });
  });
  await page.goto(`/?lang=${locale}`);
  if (width < 1024) await page.getByRole('button', { name: copy.preview.show, exact: true }).click();
  await page.getByRole('button', { name: locale === 'en' ? 'Retry' : 'إعادة المحاولة', exact: true }).click({ trial: true });
  fail = false;
  await page.getByRole('button', { name: locale === 'en' ? 'Retry' : 'إعادة المحاولة', exact: true }).click();
  const player = page.frameLocator('iframe');
  await expect(player.getByText('Autumn perfumes', { exact: true })).toBeVisible();
  const before = await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.performance.timeOrigin);
  await player.getByRole('button', { name: 'Shop now' }).click();
  await expect(player.getByText(locale === 'en' ? 'Link navigation simulated.' : 'تمت محاكاة الانتقال إلى الرابط.')).toBeVisible();
  if (width < 1024) await page.getByRole('button', { name: locale === 'en' ? 'Back to editing' : 'رجوع للتعديل', exact: true }).click();
  let savedAt = 0;
  const saveResponse = page.waitForResponse(response => {
    if (response.request().method() !== 'PATCH' || !response.ok()) return false;
    savedAt = Date.now(); return true;
  });
  await page.getByRole('textbox', { name: locale === 'en' ? 'Title' : 'العنوان', exact: true }).fill('Saved update');
  await saveResponse;
  await expect(player.getByText('Saved update', { exact: true })).toHaveText('Saved update', { timeout: 2000 });
  expect(Date.now() - savedAt).toBeLessThan(2000);
  if (width < 1024) await page.getByRole('button', { name: copy.preview.show, exact: true }).click();
  await expect(player.getByText('Saved update', { exact: true })).toBeVisible({ timeout: 2000 });
  expect(await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.performance.timeOrigin)).toBe(before);
  expect(count).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `test-results/preview-${locale}-${width}.png`, fullPage: true });
});

test('unsaved and failed explicit saves retain saved content; successful save refreshes', async ({ page }) => {
  let saved = { ...item, status: 'published' as const }, failSave = true, previewCount = 0;
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/v1/')) return route.continue();
    if (path.startsWith('/v1/preview/')) { previewCount++; return route.fulfill({ json: manifestOf(saved) }); }
    if (route.request().method() === 'PATCH') {
      if (failSave) return route.fulfill({ status: 500, json: {} });
      saved = { ...saved, ...route.request().postDataJSON(), updated_at: new Date().toISOString() };
    }
    return route.fulfill({ json: saved });
  });
  await page.goto('/?lang=en&mode=published');
  const player = page.frameLocator('iframe');
  await expect(player.getByText(item.title, { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved title');
  await page.waitForTimeout(1200); // Beyond the draft autosave debounce: published changes must remain unsaved.
  expect(previewCount).toBe(1);
  await expect(player.getByText(item.title, { exact: true })).toBeVisible();
  const failed = page.waitForResponse(r => r.request().method() === 'PATCH' && r.status() === 500);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await failed;
  await expect(player.getByText(item.title, { exact: true })).toBeVisible(); expect(previewCount).toBe(1);
  failSave = false;
  const success = page.waitForResponse(r => r.request().method() === 'PATCH' && r.ok());
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await success;
  const savedAt = Date.now();
  await expect(player.getByText('Unsaved title', { exact: true })).toBeVisible({ timeout: 2000 });
  expect(Date.now() - savedAt).toBeLessThan(2000);
});

test('first create makes no initial manifest request and updates the existing iframe', async ({ page }) => {
  let saved = { ...item }, previewCount = 0;
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/v1/')) return route.continue();
    if (path.startsWith('/v1/preview/')) { previewCount++; return route.fulfill({ json: manifestOf(saved) }); }
    if (route.request().method() === 'POST') saved = { ...saved, ...route.request().postDataJSON() };
    return route.fulfill({ status: route.request().method() === 'POST' ? 201 : 200, json: saved });
  });
  await page.goto('/?lang=en&mode=new');
  await expect(page.getByText('Save your content to start the preview.')).toBeVisible(); expect(previewCount).toBe(0);
  const before = await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.performance.timeOrigin);
  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.status() === 201);
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('First saved title'); await created;
  const savedAt = Date.now();
  await expect(page.frameLocator('iframe').getByText('First saved title', { exact: true })).toBeVisible({ timeout: 2000 });
  expect(Date.now() - savedAt).toBeLessThan(2000);
  expect(await page.locator('iframe').evaluate(el => (el as HTMLIFrameElement).contentWindow!.performance.timeOrigin)).toBe(before);
});

test('startup timeout recovers after bootstrap is restored without another save', async ({ page }) => {
  let blocked = true;
  await page.route('**/player-preview/bootstrap.js', route => blocked ? route.abort() : route.continue());
  await page.route('**/v1/preview/**', route => route.fulfill({ json: manifestOf(item) }));
  await page.goto('/?lang=en');
  await expect(page.getByText("Preview didn't load. Try again.")).toBeVisible({ timeout: 12000 });
  blocked = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.frameLocator('iframe').getByText(item.title, { exact: true })).toBeVisible();
  await expect(page.getByText("Preview didn't load. Try again.")).toHaveCount(0);
});
