import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiUrl } from '../../../../lib/health';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string[] }> }
) {
  const { action } = await context.params;
  const endpoint = action.join('/');
  const base = apiUrl().replace(/\/+$/, '');
  const url = `${base}/v1/auth/${endpoint}`;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': request.headers.get('x-request-id') ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await upstream.json().catch(() => ({}));
    const response = NextResponse.json(data, { status: upstream.status });

    // Forward any Set-Cookie headers from the API (such as slips_session)
    const setCookie = upstream.headers.getSetCookie?.() ?? [upstream.headers.get('set-cookie')].filter(Boolean) as string[];
    for (const cookie of setCookie) {
      response.headers.append('set-cookie', cookie);
    }

    return response;
  } catch (err) {
    return NextResponse.json(
      { code: 'network_error', message: err instanceof Error ? err.message : 'Failed to reach API' },
      { status: 502 }
    );
  }
}
