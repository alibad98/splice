// Placeholder core loader. Real Story/Reel rendering arrives in Epic 5.
// Layout-shift contract (NFR1): nothing is inserted into the page unless the manifest has content,
// and content is inserted only while the anchor is outside the viewport, so visible content never moves.
import { h, render } from 'preact';

export interface SlipsConfig {
  /** API origin the manifest is fetched from. */
  api: string;
  /** Public store key. */
  key: string;
  /** Manifest timeout in ms (default 3000). */
  timeoutMs?: number;
}

interface Manifest {
  items: { id: string; title: string }[];
}

const ANCHOR = '[data-slips-anchor]';
const ROOT_ATTR = 'data-slips-root';

function Placeholder({ manifest }: { manifest: Manifest }) {
  return h('ul', { class: 'slips-list' }, manifest.items.map((i) => h('li', { key: i.id }, i.title)));
}

async function fetchManifest(cfg: SlipsConfig): Promise<Manifest | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 3000);
  try {
    const res = await fetch(`${cfg.api}/v1/storefront/manifest?key=${encodeURIComponent(cfg.key)}`, { signal: ctl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Manifest;
    return Array.isArray(body.items) && body.items.length > 0 ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function insertWhenOffscreen(anchor: Element, manifest: Manifest): void {
  const mount = () => {
    const root = document.createElement('section');
    root.setAttribute(ROOT_ATTR, '');
    root.style.cssText = 'display:block;height:160px;overflow:hidden;contain:layout size';
    anchor.after(root);
    render(h(Placeholder, { manifest }), root);
  };
  const io = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    // AD-8: insert only while the anchor is entirely BELOW the viewport. Above or inside it, do not mount
    // (an overlay fallback is planned for Epic 5).
    if (e && !e.isIntersecting && e.boundingClientRect.top >= (e.rootBounds?.bottom ?? window.innerHeight)) {
      io.disconnect();
      mount();
    }
  });
  io.observe(anchor);
}

export async function boot(cfg: SlipsConfig): Promise<void> {
  // The stub's timeout removes the script unless the loader reports ready.
  const g = window as unknown as { __slips?: { ready?: boolean } };
  if (g.__slips) g.__slips.ready = true;
  // TODO(Story 1.11): read salla.config here to derive the page context and store locator.
  const anchor = document.querySelector(ANCHOR);
  if (!anchor) return;
  const manifest = await fetchManifest(cfg);
  if (!manifest) return; // no content, timeout or invalid key: leave the page untouched
  insertWhenOffscreen(anchor, manifest);
}
