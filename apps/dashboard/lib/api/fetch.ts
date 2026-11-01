import type { z } from 'zod';
import type { SessionClient } from '../session/session-client';

/** A failed API call: the HTTP status (0 when the network failed) and the problem+json `code`, if any. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
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
