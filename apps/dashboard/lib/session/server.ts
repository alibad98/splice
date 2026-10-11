import { SessionInfo } from '@slips/contracts';
import { cookies, headers } from 'next/headers';
import { apiUrl } from '../health';

/** Name of the API's session cookie; the dashboard only forwards it, it never reads or sets it. */
export const SESSION_COOKIE = 'slips_session';

export type ServerSession = { kind: 'signed-in'; info: SessionInfo } | { kind: 'expired' } | { kind: 'none' };

/** Ask the API who the request's cookie session is (direct-link sign-in). Never trusts anything from the URL. */
export async function getServerSession(fetchImpl: typeof fetch = fetch): Promise<ServerSession> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return { kind: 'none' };
  try {
    const res = await fetchImpl(`${apiUrl().replace(/\/+$/, '')}/v1/session`, { headers: { cookie: `${SESSION_COOKIE}=${value}` }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (res.status === 401) return (((await res.json().catch(() => null)) as { code?: string } | null)?.code === 'session_expired' ? { kind: 'expired' } : { kind: 'none' });
    if (!res.ok) return { kind: 'none' };
    const parsed = SessionInfo.safeParse(await res.json());
    return parsed.success ? { kind: 'signed-in', info: parsed.data } : { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

/** True when the browser says this navigation is for an iframe (Salla embedding): avoids flashing the sign-in card. */
export async function isFramedNavigation(): Promise<boolean> {
  return (await headers()).get('sec-fetch-dest') === 'iframe';
}

/** Browser-reachable API base for client components (server env, read at request time). */
export function publicApiUrl(): string {
  return process.env.PUBLIC_API_URL ?? apiUrl();
}
