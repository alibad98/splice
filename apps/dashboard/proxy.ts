import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isLocale, langHeader, langParam, localeCookie } from './i18n/config';
import { frameAncestors, isAdminPath, isAuthPath } from './lib/embedded/policy';

const SESSION_COOKIE = 'slips_session';

/** Security headers (AD-12): framing policy, and no Referer so the host token on an embedded URL never leaks. */
function withSecurityHeaders(response: NextResponse, pathname: string): NextResponse {
  response.headers.set('content-security-policy', frameAncestors(pathname));
  response.headers.set('referrer-policy', 'no-referrer');
  if (isAdminPath(pathname) || isAuthPath(pathname)) {
    response.headers.set('x-frame-options', 'DENY');
  }
  return response;
}

/** Exposes a valid ?lang to server components and mirrors it into a first-party cookie (direct-link sessions). */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const lang = request.nextUrl.searchParams.get(langParam);
  const secFetchDest = request.headers.get('sec-fetch-dest');
  const isDirectDocumentNav = secFetchDest === 'document';
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // If a top-level unauthenticated browser visits a merchant page, redirect to /login
  if (
    isDirectDocumentNav &&
    !hasSessionCookie &&
    !isAuthPath(pathname) &&
    !isAdminPath(pathname) &&
    !pathname.startsWith('/api/')
  ) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    const redirectResponse = NextResponse.redirect(loginUrl);
    if (isLocale(lang)) {
      redirectResponse.cookies.set(localeCookie, lang, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    return withSecurityHeaders(redirectResponse, pathname);
  }

  // If an authenticated browser visits /login, redirect to /
  if (isDirectDocumentNav && hasSessionCookie && pathname === '/login') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    const redirectResponse = NextResponse.redirect(homeUrl);
    if (isLocale(lang)) {
      redirectResponse.cookies.set(localeCookie, lang, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    return withSecurityHeaders(redirectResponse, pathname);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(langHeader);

  if (!isLocale(lang)) {
    return withSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), pathname);
  }

  requestHeaders.set(langHeader, lang);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(localeCookie, lang, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return withSecurityHeaders(response, pathname);
}

export const config = { matcher: ['/((?!_next/|brand/|icon.svg).*)'] };
