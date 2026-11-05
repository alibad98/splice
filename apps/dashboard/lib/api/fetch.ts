import type { z } from 'zod';
import type { SessionClient } from '../session/session-client';

/** A failed API call: the HTTP status (0 when the network failed) and the problem+json `code`, if any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    /** Seconds from a `Retry-After` header (429), when the API sent one. */
    readonly retryAfter?: number,
    /** The problem+json `type` slug (e.g. `cta-url-not-store-domain`), when not `about:blank`. */
    readonly type?: string,
  ) {
    super(`API request failed (${status}${code ? ` ${code}` : ''})`);
    this.name = 'ApiError';
  }
}

/** The `ApiError` for a non-2xx answer: status, problem `code` and `type` (when not `about:blank`), and `Retry-After`. */
async function errorOf(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { code?: string; type?: string } | null;
  const retryAfter = Number(res.headers.get('retry-after'));
  return new ApiError(res.status, body?.code, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined, body?.type && body.type !== 'about:blank' ? body.type : undefined);
}

/** GET a `v1` resource as the signed-in merchant and parse it with its contract schema. */
export async function getJson<S extends z.ZodType>(client: SessionClient, path: string, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await client.apiFetch(path, { headers: { 'x-slips-client': 'dashboard' } });
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) throw await errorOf(res);
  const parsed = schema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response');
  return parsed.data;
}

/** POST to a `v1` resource as the signed-in merchant (the session client adds the CSRF token) and parse the answer. */
export function postJson<S extends z.ZodType>(client: SessionClient, path: string, schema: S): Promise<z.infer<S>> {
  return sendJson(client, 'POST', path, undefined, schema);
}

/**
 * Send a state-changing request (`POST`/`PATCH`/`PUT`) with an optional JSON body as the signed-in merchant (the session
 * client adds the CSRF token) and parse the answer with its contract schema. Failures reject with an `ApiError`.
 */
export async function sendJson<S extends z.ZodType>(client: SessionClient, method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await client.apiFetch(path, {
      method,
      headers: { 'x-slips-client': 'dashboard', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0);
  }
  if (!res.ok) throw await errorOf(res);
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
  if (!res.ok) throw await errorOf(res);
}
