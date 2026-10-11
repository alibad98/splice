import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isLocale, langHeader, langParam, localeCookie } from './i18n/config';

/** Exposes a valid ?lang to server components and mirrors it into a first-party cookie (direct-link sessions). */
export function proxy(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get(langParam);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(langHeader);
  if (!isLocale(lang)) return NextResponse.next({ request: { headers: requestHeaders } });
  requestHeaders.set(langHeader, lang);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.set(localeCookie, lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  return response;
}

export const config = { matcher: ['/((?!_next/|brand/|icon.svg).*)'] };
