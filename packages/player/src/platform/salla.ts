// SPIKE StorefrontPlatform for Salla (Story 1.11, gate G1). Reads window.salla.config only; no @salla.sa/* import, so the
// bundle stays preact-only (AD-7). Field names come from docs/salla-desk-research.md and must be confirmed on a real store.
// Every read is defensive: a missing or odd value yields a safe default, and nothing here ever throws.

export type PageType = 'home' | 'category' | 'product' | 'cart' | 'thank-you' | 'other';

export interface PageContext {
  pageType: PageType;
  /** Product id on product pages, category id on category pages, order id on thank-you; otherwise null. */
  targetId: string | null;
  lang: string;
  dir: 'ltr' | 'rtl';
}

/** The tenant locator sent to the API (AD-16). */
export interface StoreLocator {
  platform: 'salla';
  platformStoreId: string;
}

/** Just the part of the Twilight global the spike uses. */
interface SallaLike {
  config?: { get?: (key: string, fallback?: unknown) => unknown };
}
export interface SallaEnv {
  salla?: unknown;
  document?: { documentElement?: { lang?: string; dir?: string } };
  location?: { pathname?: string };
}

// Slugs: product.single / cart / thank-you are documented; home and category are the spike's best guess (desk research).
const SLUGS: Record<string, PageType> = { index: 'home', 'product.single': 'product', 'product.index': 'category', cart: 'cart', 'thank-you': 'thank-you' };
const RTL = new Set(['ar', 'he', 'fa', 'ur']);

const str = (v: unknown): string | null => ((typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : null);

function getter(env: SallaEnv): (key: string) => unknown {
  const cfg = (env.salla as SallaLike | undefined)?.config;
  return (key) => {
    try {
      return typeof cfg?.get === 'function' ? cfg.get(key) : undefined;
    } catch {
      return undefined;
    }
  };
}

export function readStoreLocator(env: SallaEnv = globalThis as SallaEnv): StoreLocator | null {
  const id = str(getter(env)('store.id'));
  return id ? { platform: 'salla', platformStoreId: id } : null;
}

export function readPageContext(env: SallaEnv = globalThis as SallaEnv): PageContext {
  const get = getter(env);
  const slug = str(get('page.slug')) ?? '';
  const pageType = SLUGS[slug] ?? 'other';
  let targetId: string | null = null;
  if (pageType === 'product' || pageType === 'thank-you') targetId = str(get('page.id'));
  // page.id is not set on category pages (desk research): fall back to the "/c<digits>" URL segment.
  else if (pageType === 'category') targetId = str(get('page.id')) ?? /\/c(\d+)(?:[/?#]|$)/.exec(env.location?.pathname ?? '')?.[1] ?? null;
  const root = env.document?.documentElement;
  // store.lang may be null (KIT); user.language_code first, then <html lang>.
  const lang = (str(get('user.language_code')) ?? str(root?.lang) ?? 'ar').toLowerCase().split('-')[0] as string;
  const langs = get('languages');
  const entry = Array.isArray(langs) ? (langs as { code?: unknown; is_rtl?: unknown }[]).find((l) => l && l.code === lang) : undefined;
  const dir = typeof entry?.is_rtl === 'boolean' ? (entry.is_rtl ? 'rtl' : 'ltr') : root?.dir === 'rtl' || root?.dir === 'ltr' ? root.dir : RTL.has(lang) ? 'rtl' : 'ltr';
  return { pageType, targetId, lang, dir };
}
