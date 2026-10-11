import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MerchantHome from './page';

afterEach(() => vi.unstubAllGlobals());

describe('merchant home', () => {
  it('shows the API health status', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ status: 'ok', role: 'http', version: '0.0.0', time: new Date().toISOString() }));
    const html = renderToStaticMarkup(await MerchantHome());
    expect(html).toContain('data-testid="api-health">ok<');
  });
  it('shows unreachable when the API is down', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('down'); });
    const html = renderToStaticMarkup(await MerchantHome());
    expect(html).toContain('unreachable');
  });
});
