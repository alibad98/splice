import type { z } from 'zod';
import type { SessionClient } from '../session/session-client';

/** A failed API call: the HTTP status (0 when the network failed) and the problem+json `code`, if any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    /** Seconds from a `Retry-After` header (429), when the API sent one. */
    readonly retryAfter?: number,
  ) {
    super(`API request failed (${status}${code ? ` ${code}` : ''})`);
    this.name = 'ApiError';
  }
}

/** GET a `v1` resource as the signed-in merchant and parse it with its contract schema. */
export async function getJson<S extends z.ZodType>(client: SessionClient, path: string, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await client.apiFetch(path, { headers: { 'x-slips-client': 'dashboard' } });
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    throw new ApiError(res.status, body?.code);
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response');
  return parsed.data;
}

/** POST to a `v1` resource as the signed-in merchant (the session client adds the CSRF token) and parse the answer. */
export async function postJson<S extends z.ZodType>(client: SessionClient, path: string, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await client.apiFetch(path, { method: 'POST', headers: { 'x-slips-client': 'dashboard' } });
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ApiError(res.status, body?.code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
  }
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response');
  return parsed.data;
}

/** DELETE a `v1` resource as the signed-in merchant (CSRF added by the session client). Resolves on any 2xx (usually 204). */
export async function deleteResource(client: SessionClient, path: string): Promise<void> {
  let res: Response;
  try {
    res = await client.apiFetch(path, { method: 'DELETE', headers: { 'x-slips-client': 'dashboard' } });
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    throw new ApiError(res.status, body?.code);
  }
}
