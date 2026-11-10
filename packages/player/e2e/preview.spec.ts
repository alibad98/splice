import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import type { StoreManifest } from '@slips/contracts';
import type { Viewer } from '../src/viewer/index.js';
import type * as ViewerModule from '../src/viewer/index.js';
import type { PlatformResult } from '../src/platform/types.js';
import { manifest } from '../test/manifest.js';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
declare global {
  interface Window {
    demoManifest: () => StoreManifest;
    sendPreview: (m: StoreManifest, locale?: 'ar' | 'en') => void;
    previewReady?: boolean;
    testViewer: Viewer;
    pendingActions: {
      resolve(value: PlatformResult): void;
      reject(error: Error): void;
    }[];
    preview: {
      destroy(): void;
      update(m: unknown, locale?: 'ar' | 'en'): boolean;
    };
  }
}
const open = async (page: Page) => {
  await page.goto('/preview.html');
  await expect.poll(() => page.evaluate(() => window.previewReady)).toBe(true);
  return page.frameLocator('iframe');
};
test('Shadow DOM media, slides, simulation and update lifecycle', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const frame = await open(page);
  await expect(frame.locator('.media img')).toHaveAttribute('src', /demo.png/);
  await expect(frame.locator('strong')).toHaveText('Amber studio object');
  await expect(frame.locator('.price')).toContainText('129.00');
  await frame.locator('.cta').click();
  await expect(frame.locator('.feedback')).toContainText('simulated');
  await frame.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(frame.locator('video')).toHaveAttribute('controls', '');
  await expect(frame.locator('.position')).toHaveText('Slide 2 of 2');
  const oldVideo = await frame.locator('video').elementHandle();
  await oldVideo!.evaluate(async (v) => {
    (v as HTMLVideoElement).muted = true;
    await (v as HTMLVideoElement).play();
  });
  expect(await oldVideo!.evaluate((v) => (v as HTMLVideoElement).paused)).toBe(
    false,
  );
  await page.evaluate(() => {
    const m = window.demoManifest();
    m.items[0]!.title = '<img src=x onerror=alert(1)>';
    window.sendPreview(m, 'ar');
  });
  await expect(frame.locator('h1')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(frame.locator('.viewer')).toHaveAttribute('dir', 'rtl');
  await expect(frame.locator('.position')).toHaveText('الشريحة 1 من 2');
  await expect(frame.locator('.feedback')).toBeEmpty();
  expect(
    await oldVideo!.evaluate(
      (v) => (v as HTMLVideoElement).paused && v.getAttribute('src') === null,
    ),
  ).toBe(true);
  await expect(frame.locator('h1 img')).toHaveCount(0);
  expect(
    requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4173'),
  ).toBe(true);
  expect(
    requests.some((url) => /cart|analytics|confirm|telemetry/.test(url)),
  ).toBe(false);
});
test('rejects untrusted state and removes listener on destroy', async ({
  page,
}) => {
  const frame = await open(page);
  await page.evaluate(() => {
    const send = (data: unknown) =>
      document
        .querySelector('iframe')!
        .contentWindow!.postMessage(data, location.origin);
    const m = window.demoManifest();
    m.items[0]!.title = 'Rejected';
    send({ type: 'slips.preview.update', v: 2, locale: 'en', manifest: m });
    m.items[0]!.slides[0]!.renditions[0]!.url = 'javascript:alert(1)';
    send({ type: 'slips.preview.update', v: 1, locale: 'en', manifest: m });
  });
  const child = page.frames().find((f) => f.url().includes('preview-frame'))!;
  await child.evaluate(() => {
    const data = {
      type: 'slips.preview.update',
      v: 1,
      locale: 'en',
      manifest: {
        v: 1,
        store_id: '11111111-1111-4111-8111-111111111111',
        items: [],
      },
    };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: location.origin,
        source: window,
        data,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example',
        source: window.parent,
        data,
      }),
    );
  });
  await expect(frame.locator('h1')).toHaveText(
    'Everyday essentials, thoughtfully chosen',
  );
  await child.evaluate(() => window.preview.destroy());
  await expect(frame.locator('.viewer')).toHaveCount(0);
  await page.evaluate(() => window.sendPreview(window.demoManifest()));
  await expect(frame.locator('.viewer')).toHaveCount(0);
});
test('draft, failed media, missing/deleted products, availability', async ({
  page,
}) => {
  const frame = await open(page);
  for (const state of [
    'empty',
    'processing',
    'failed',
    'broken',
    'deleted',
    'unavailable',
    'options',
    'both',
    'null-alt',
    'missing',
  ] as const) {
    const m = manifest(),
      i = m.items[0]!;
    if (state === 'empty') i.slides = [];
    if (state === 'processing') {
      i.slides[0]!.status = 'scanned';
      i.slides[0]!.poster_url = '/demo.png';
    }
    if (state === 'failed') i.slides[0]!.status = 'failed';
    if (state === 'broken') i.slides[0]!.renditions[0]!.url = '/missing.png';
    if (state === 'deleted') i.product!.deleted = true;
    if (state === 'unavailable') i.product!.availability = 'out_of_stock';
    if (state === 'options') i.product!.has_required_options = true;
    if (state === 'both') {
      i.product!.availability = 'out_of_stock';
      i.product!.has_required_options = true;
    }
    if (state === 'null-alt') {
      i.slides[0]!.status = 'scanned';
      i.slides[0]!.source_url = '/demo.png';
      i.slides[0]!.alt_text = null;
    }
    if (state === 'missing') i.product = null;
    await page.evaluate((m) => window.sendPreview(m), m);
    if (state === 'empty')
      await expect(frame.locator('.media')).toContainText('Add a slide');
    if (state === 'processing')
      await expect(frame.locator('.processing')).toContainText('processing');
    if (['failed', 'broken'].includes(state))
      await expect(frame.locator('.media')).toContainText('Media unavailable');
    if (['deleted', 'missing'].includes(state))
      await expect(frame.locator('.product')).toHaveCount(0);
    if (['deleted', 'missing', 'unavailable', 'options'].includes(state))
      await expect(frame.locator('.cta')).toBeDisabled();
    if (state === 'both') {
      await expect(frame.locator('.details')).toContainText('Out of stock');
      await expect(frame.locator('.details')).toContainText('Required options');
      await expect(frame.locator('.cta')).toBeDisabled();
    }
    if (state === 'null-alt')
      await expect(
        frame.getByRole('img', { name: i.title, exact: true }),
      ).toBeVisible();
  }
  await page.evaluate(() =>
    window.sendPreview({
      v: 1,
      store_id: window.demoManifest().store_id,
      items: [],
    }),
  );
  await expect(frame.locator('.media')).toContainText('Save content');
});
test('navigation actions remain simulated', async ({ page }) => {
  const frame = await open(page);
  await page.waitForLoadState('networkidle');
  const requests: string[] = [],
    navigations: string[] = [],
    popups: Page[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('framenavigated', (child) => navigations.push(child.url()));
  page.on('popup', (popup) => popups.push(popup));
  for (const state of [
    'link',
    'product',
    'out-of-stock',
    'required-options',
    'both',
  ] as const) {
    await page.evaluate((state) => {
      const m = window.demoManifest();
      const action = state === 'link' ? 'open_link' : 'open_product';
      m.items[0]!.title = state;
      m.items[0]!.cta_action = action;
      m.items[0]!.cta_url =
        action === 'open_link' ? 'https://shop.example/item' : null;
      m.items[0]!.product!.availability =
        state === 'out-of-stock' || state === 'both'
          ? 'out_of_stock'
          : 'available';
      m.items[0]!.product!.has_required_options =
        state === 'required-options' || state === 'both';
      window.sendPreview(m);
    }, state);
    await expect(frame.locator('h1')).toHaveText(state);
    await expect(frame.locator('.cta')).toBeEnabled();
    await frame.locator('.cta').click();
    await expect(frame.locator('.feedback')).toHaveText(
      state === 'link'
        ? 'Link navigation simulated.'
        : 'Product navigation simulated.',
    );
  }
  expect(page.frames()).toHaveLength(2);
  expect(requests).toEqual([]);
  expect(navigations).toEqual([]);
  expect(popups).toEqual([]);
  expect(page.url()).toBe('http://127.0.0.1:4173/preview.html');
  expect(page.frames()[1]!.url()).toBe(
    'http://127.0.0.1:4173/preview-frame.html',
  );
});

test('renders parent-created blob media and leaves its lifetime to the parent', async ({
  page,
}) => {
  const frame = await open(page);
  const url = await page.evaluate(async () => {
    const blob = await (await fetch('/demo.png')).blob();
    const url = URL.createObjectURL(blob);
    const m = window.demoManifest();
    m.items[0]!.slides[0]!.renditions[0]!.url = url;
    window.sendPreview(m);
    return url;
  });
  await expect(frame.locator('.media img')).toHaveAttribute('src', url);
  expect(
    await frame.locator('.media img').evaluate(async (image) => {
      await (image as HTMLImageElement).decode();
      return (image as HTMLImageElement).naturalWidth;
    }),
  ).toBeGreaterThan(0);
  const child = page.frames().find((f) => f.url().includes('preview-frame'))!;
  await child.evaluate(() => window.preview.destroy());
  expect(await page.evaluate(async (url) => (await fetch(url)).ok, url)).toBe(
    true,
  );
  await page.evaluate((url) => URL.revokeObjectURL(url), url);
});

test('deferred adapter pending, rejection and stale results after update and destroy', async ({
  page,
}) => {
  const frame = await open(page);
  const child = page.frames().find((f) => f.url().includes('preview-frame'))!;
  await child.evaluate(async (m) => {
    const path = '/dist/viewer.js';
    const { mountViewer } = (await import(
      path
    )) as typeof ViewerModule;
    window.preview.destroy();
    window.pendingActions = [];
    const deferred = () =>
      new Promise<PlatformResult>((resolve, reject) =>
        window.pendingActions.push({ resolve, reject }),
      );
    window.testViewer = mountViewer(
      document.querySelector<HTMLElement>('#player')!,
      m,
      {
        locale: 'en',
        apiBase: location.origin,
        platform: {
          addToCart: deferred,
          openProduct: deferred,
          openLink: deferred,
          selectSlide() {},
        },
      },
    );
  }, manifest());
  await frame.locator('.cta').click();
  await expect(frame.locator('.cta')).toBeDisabled();
  await expect(frame.locator('.cta')).toHaveText('Simulating…');
  await child.evaluate(() => window.pendingActions.shift()!.resolve('cart'));
  await expect(frame.locator('.feedback')).toHaveText(
    'Added to cart (simulated).',
  );
  await expect(frame.locator('.cta')).toBeEnabled();
  await frame.locator('.cta').click();
  await child.evaluate(() =>
    window.pendingActions.shift()!.reject(new Error('adapter failed')),
  );
  await expect(frame.locator('.feedback')).toHaveText(
    'Action could not be simulated. Try again.',
  );
  await expect(frame.locator('.cta')).toBeEnabled();
  await frame.locator('.cta').click();
  await child.evaluate((m) => window.testViewer.update(m, 'en'), manifest());
  await expect(frame.locator('.feedback')).toBeEmpty();
  await expect(frame.locator('.cta')).toBeEnabled();
  await child.evaluate(async () => {
    window.pendingActions.shift()!.resolve('cart');
    await Promise.resolve();
  });
  await expect(frame.locator('.feedback')).toBeEmpty();
  await frame.locator('.cta').click();
  await child.evaluate(async () => {
    window.testViewer.destroy();
    window.pendingActions.shift()!.reject(new Error('obsolete'));
    await Promise.resolve();
  });
  await expect(frame.locator('.viewer')).toHaveCount(0);
});
for (const width of [1280, 390])
  for (const locale of ['ar', 'en'] as const)
    for (const incomplete of [false, true])
      test(`capture ${width} ${locale} ${incomplete ? 'incomplete' : 'complete'}`, async ({
        page,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        const frame = await open(page);
        await page.evaluate(
          ({ locale, incomplete }) => {
            const m = window.demoManifest();
            if (locale === 'ar') {
              m.items[0]!.title = 'تفاصيل يومية اختيرت بعناية';
              m.items[0]!.product!.name = 'قطعة الاستوديو الكهرمانية';
              m.items[0]!.cta_label = 'أضف إلى السلة';
            }
            if (incomplete) {
              m.items[0]!.slides[0]!.status = 'failed';
              m.items[0]!.product = null;
            }
            window.sendPreview(m, locale);
          },
          { locale, incomplete },
        );
        await expect(frame.locator('.viewer')).toHaveAttribute('lang', locale);
        await expect(frame.locator('.safety')).toBeVisible();
        if (!incomplete)
          await expect(frame.locator('.media img')).toBeVisible();
        const directory = resolve('../../.impeccable/review');
        await mkdir(directory, { recursive: true });
        await page.screenshot({
          path: resolve(
            directory,
            `preview-${width}-${locale}-${incomplete ? 'incomplete' : 'complete'}.png`,
          ),
          fullPage: true,
        });
      });

test('long merchant text keeps media, native controls and dock visible on a short mobile screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const frame = await open(page);
  await page.evaluate(() => {
    const m = window.demoManifest();
    m.items[0]!.title = 'عنوان طويل '.repeat(8).slice(0, 80);
    m.items[0]!.product!.name = 'اسم منتج طويل لاختبار التفاف النص '.repeat(12);
    m.items[0]!.cta_label = 'إضافة هذا المنتج إلى سلة التسوق الآن';
    window.sendPreview(m, 'ar');
  });
  await expect(frame.locator('#player')).toHaveAttribute('dir', 'rtl');
  expect((await frame.locator('.media').boundingBox())!.height).toBeGreaterThan(
    60,
  );
  for (const selector of ['.cta', 'nav', '.safety']) {
    const box = (await frame.locator(selector).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(568);
  }
  await frame.getByRole('button', { name: 'التالي', exact: true }).click();
  await expect(frame.locator('video')).toBeVisible();
});
