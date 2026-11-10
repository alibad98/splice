import type { StoreManifest } from '@slips/contracts';
export type PreviewLocale = 'ar' | 'en';
export interface PreviewUpdate {
  type: 'slips.preview.update';
  v: 1;
  manifest: StoreManifest;
  locale: PreviewLocale;
}
export interface PreviewReady {
  type: 'slips.preview.ready';
  v: 1;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = Infinity, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const uuid = (v: unknown) =>
  text(v) &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );
const integer = (v: unknown, min = 0) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);
/** Relative media is deliberately restricted to API-root paths; never the iframe URL. */
export function mediaUrl(value: string | null, apiBase: string): string | null {
  if (value === null) return null;
  try {
    if (
      !value ||
      value !== value.trim() ||
      [...value].some((c) => c.charCodeAt(0) <= 32 || c === '\\')
    )
      return null;
    if (value.startsWith('blob:')) {
      const inner = new URL(value.slice(5));
      return ['http:', 'https:'].includes(inner.protocol) &&
        !inner.username &&
        !inner.password
        ? value
        : null;
    }
    if (value.startsWith('//')) return null;
    const url = value.startsWith('/')
      ? new URL(value, apiBase)
      : new URL(value);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function isManifest(
  value: unknown,
  apiBase: string,
): value is StoreManifest {
  const url = (v: unknown) =>
    v === null || (text(v, Infinity, 1) && mediaUrl(v, apiBase) !== null);
  const product = (p: unknown) =>
    p === null ||
    (record(p) &&
      uuid(p.id) &&
      text(p.name) &&
      url(p.image_url) &&
      integer(p.price_minor) &&
      (p.sale_price_minor === null || integer(p.sale_price_minor)) &&
      text(p.currency, 3, 3) &&
      /^[A-Za-z]{3}$/.test(p.currency) &&
      oneOf(p.availability, ['available', 'low', 'out_of_stock']) &&
      typeof p.deleted === 'boolean' &&
      typeof p.has_required_options === 'boolean');
  const slide = (s: unknown) =>
    record(s) &&
    uuid(s.id) &&
    uuid(s.media_asset_id) &&
    oneOf(s.kind, ['image', 'video']) &&
    (s.alt_text === null || text(s.alt_text, 250)) &&
    oneOf(s.status, [
      'importing',
      'uploaded',
      'scanned',
      'processed',
      'failed',
    ]) &&
    url(s.source_url) &&
    url(s.poster_url) &&
    Array.isArray(s.renditions) &&
    Array.from(s.renditions).every(
      (r: unknown) =>
        record(r) &&
        oneOf(r.profile, ['480p', '720p', '1080p', 'poster', 'web']) &&
        text(r.url, Infinity, 1) &&
        url(r.url) &&
        text(r.content_type, Infinity, 1) &&
        integer(r.width, 1) &&
        integer(r.height, 1),
    );
  return (
    record(value) &&
    value.v === 1 &&
    uuid(value.store_id) &&
    Array.isArray(value.items) &&
    Array.from(value.items).every(
      (i: unknown) =>
        record(i) &&
        uuid(i.id) &&
        text(i.title, 80, 1) &&
        oneOf(i.format, ['story', 'reel']) &&
        text(i.cta_label, 40, 1) &&
        oneOf(i.cta_action, ['add_to_cart', 'open_product', 'open_link']) &&
        (i.cta_url === null ||
          (text(i.cta_url) && /^https?:/i.test(i.cta_url) && url(i.cta_url))) &&
        oneOf(i.cta_style, [null, 'ink', 'light', 'outline']) &&
        product(i.product) &&
        Array.isArray(i.slides) &&
        Array.from(i.slides).every(slide),
    )
  );
}
export function isPreviewUpdate(
  value: unknown,
  apiBase: string,
): value is PreviewUpdate {
  return (
    record(value) &&
    value.type === 'slips.preview.update' &&
    value.v === 1 &&
    oneOf(value.locale, ['ar', 'en']) &&
    isManifest(value.manifest, apiBase)
  );
}
export function exactOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value)
    throw new Error('An exact HTTP(S) parent origin is required');
  return value;
}
