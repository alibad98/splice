import { expect, test } from '@playwright/test';
import { item, manifestOf } from './fixture';

// The editor harness uses Vite; this regression must exercise Next's real proxy headers.
test('Next.js serves a preview that the dashboard can frame and initialize', async ({ page, request }) => {
  const origin = 'http://127.0.0.1:4175';
  const response = await request.get(`${origin}/player-preview/index.html`, {
    headers: { 'sec-fetch-dest': 'iframe' },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'self' https://s.salla.sa");

  // A same-origin parent fixture needs no merchant/API session to test browser framing.
  await page.route(`${origin}/preview-regression-host`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body></body></html>',
  }));
  await page.goto(`${origin}/preview-regression-host`);
  await page.evaluate(manifest => {
    const frame = document.createElement('iframe');
    frame.title = 'Preview regression';
    window.addEventListener('message', event => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow ||
          event.data?.type !== 'slips.preview.ready' || event.data?.v !== 1) return;
      frame.contentWindow!.postMessage({ type: 'slips.preview.update', v: 1, locale: 'en', manifest }, location.origin);
    });
    frame.src = '/player-preview/index.html';
    document.body.append(frame);
  }, manifestOf(item));
  await expect(page.frameLocator('iframe').getByText(item.title, { exact: true })).toBeVisible();
});
