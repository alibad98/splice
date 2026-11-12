import { MEDIA_IMPORT_URL_MAX, type MediaKind } from '@slips/contracts';

/** Path extensions that tell a link's kind (Story 3.7); anything else needs the merchant's Image/Video choice. */
const LINK_KINDS: Readonly<Record<string, MediaKind>> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
};

/**
 * The link as the API would take it, or null: http/https, port 80/443 (or the default), no user info, at most
 * `MEDIA_IMPORT_URL_MAX` characters. The API repeats these checks and also refuses private and loopback IP hosts.
 */
export function checkLink(raw: string): URL | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > MEDIA_IMPORT_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;
  return url;
}

/** The kind the link's path extension tells (`.jpg/.jpeg/.png/.webp` image, `.mp4/.mov/.webm` video), else null. */
export function inferLinkKind(url: URL): MediaKind | null {
  const last = url.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot < 0) return null;
  return LINK_KINDS[last.slice(dot + 1).toLowerCase()] ?? null;
}
