import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isLocale, langHeader, langParam, localeCookie } from './i18n/config';
import { frameAncestors, isAdminPath } from './lib/embedded/policy';

/** Security headers (AD-12): framing policy, and no Referer so the host token on an embedded URL never leaks. */
function withSecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  response.headers.set('content-security-policy', frameAncestors(pathname));
  response.headers.set('referrer-policy', 'no-referrer');
  if (isAdminPath(pathname)) response.headers.set('x-frame-options', 'DENY');
  return response;
}

/** Exposes a valid ?lang to server components and mirrors it into a first-party cookie (direct-link sessions). */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const lang = request.nextUrl.searchParams.get(langParam);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(langHeader);
  if (!isLocale(lang)) return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), pathname);
  requestHeaders.set(langHeader, lang);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(localeCookie, lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return withSecurityHeaders(response, pathname);
}

export const config = { matcher: ['/((?!_next/|brand/|icon.svg).*)'] };
