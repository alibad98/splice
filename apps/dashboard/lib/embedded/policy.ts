// Framing policy (AD-12): merchant pages may be framed only by the Salla Merchant Dashboard; /admin never.

/** Origin of the Salla Merchant Dashboard, overridable per environment. */
export function embedOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.EMBED_ALLOWED_ORIGIN;
  try {
    const url = new URL(raw ?? 'https://s.salla.sa');
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : 'https://s.salla.sa';
  } catch {
    return 'https://s.salla.sa';
  }
}

export const isAdminPath = (pathname: string): boolean => pathname === '/admin' || pathname.startsWith('/admin/');

/** The `frame-ancestors` directive for a request path. */
export function frameAncestors(pathname: string, origin: string = embedOrigin()): string {
  return isAdminPath(pathname) ? "frame-ancestors 'none'" : `frame-ancestors ${origin}`;
}
