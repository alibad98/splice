import { expect, test } from '@playwright/test';
import { getMessages } from '../i18n/messages';
import { item, manifestOf } from './fixture';

for (const locale of ['en', 'ar'] as const) for (const width of [1280, 390]) {
  test(`${locale} ${width}: low-resolution warning and replacement picker`, async ({ page }, testInfo) => {
    const copy = getMessages(locale).content.editor.slides;
    let uploadRequests = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/v1/')) return route.continue();
      if (path.includes('/media/uploads')) uploadRequests++;
      return route.fulfill({ json: path.startsWith('/v1/preview/') ? manifestOf(item) : item });
    });
    await page.goto(`/?lang=${locale}`);
    const makeImage = async (w: number, h: number) => Buffer.from(await page.evaluate(({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png').split(',')[1]!;
    }, { w, h }), 'base64');
    await page.locator('input[type="file"]').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: await makeImage(800, 1200) });
    await expect(page.getByText(copy.rejected.title, { exact: true })).toBeVisible();
    await expect(page.getByText(/small\.png:.*800.*1200.*1080/)).toBeVisible();
    expect(uploadRequests).toBe(0);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: copy.rejected.replace, exact: true }).click();
    await (await chooser).setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: await makeImage(640, 900) });
    await expect(page.getByText(/replacement\.png:.*640.*900.*1080/)).toBeVisible();
    await expect(page.getByText(/small\.png:/)).toHaveCount(0);
    expect(uploadRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('resolution.png'), fullPage: true });
  });
}
