import type { StoreManifest } from '@slips/contracts';
import { MockStorefrontPlatform } from '../platform/mock.js';
import { mountViewer } from '../viewer/index.js';
import { exactOrigin, isManifest, isPreviewUpdate } from './protocol.js';
import type { PreviewLocale, PreviewReady } from './protocol.js';
export interface PreviewOptions {
  parentOrigin: string;
  apiBase: string;
  locale?: PreviewLocale;
}
/** Parent owns authenticated retrieval and blob lifetime. This entry never fetches. */
export function mountPreview(host: HTMLElement, options: PreviewOptions) {
  const origin = exactOrigin(options.parentOrigin),
    api = new URL(options.apiBase);
  if (
    !['http:', 'https:'].includes(api.protocol) ||
    api.username ||
    api.password
  )
    throw new Error('An explicit HTTP(S) API base is required');
  const viewWindow = host.ownerDocument.defaultView!;
  const viewer = mountViewer(
    host,
    { v: 1, store_id: '00000000-0000-4000-8000-000000000000', items: [] },
    {
      platform: new MockStorefrontPlatform(),
      apiBase: api.href,
      locale: options.locale ?? 'ar',
    },
  );
  let destroyed = false;
  const update = (
    manifest: unknown,
    locale: PreviewLocale = options.locale ?? 'ar',
  ): boolean => {
    if (
      destroyed ||
      !['ar', 'en'].includes(locale) ||
      !isManifest(manifest, api.href)
    )
      return false;
    let cloned: StoreManifest;
    try {
      cloned = structuredClone(manifest) as StoreManifest;
    } catch {
      return false;
    }
    viewer.update(cloned, locale);
    return true;
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (
      event.origin !== origin ||
      event.source !== viewWindow.parent ||
      !isPreviewUpdate(event.data, api.href)
    )
      return;
    update(event.data.manifest, event.data.locale);
  };
  viewWindow.addEventListener('message', receive);
  const ready: PreviewReady = { type: 'slips.preview.ready', v: 1 };
  viewWindow.parent.postMessage(ready, origin);
  return {
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      viewWindow.removeEventListener('message', receive);
      viewer.destroy();
    },
  };
}
export type { PreviewLocale, PreviewReady, PreviewUpdate } from './protocol.js';
export { MockStorefrontPlatform } from '../platform/mock.js';
export type { StorefrontPlatform } from '../platform/types.js';
