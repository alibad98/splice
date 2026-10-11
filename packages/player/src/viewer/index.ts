// Lazy viewer chunk (cap 25 KB gzip). Placeholder until Epic 5.
import { h, render } from 'preact';

export function openViewer(host: Element, title: string): void {
  render(h('div', { role: 'dialog' }, title), host);
}
