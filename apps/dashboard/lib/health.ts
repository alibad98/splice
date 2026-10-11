import { HealthResponse } from '@slips/contracts';

export type HealthResult = { ok: true; health: HealthResponse } | { ok: false; error: string };

export function apiUrl(): string {
  return process.env.API_URL ?? 'http://localhost:3001';
}

/** Fetch `GET /v1/health` from the API and parse it with the shared contract (non-strict). */
export async function getHealth(fetchImpl: typeof fetch = fetch, baseUrl: string = apiUrl()): Promise<HealthResult> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/health`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    // 503 carries a valid `degraded` body (database down); show it rather than a bare status code.
    if (!res.ok && res.status !== 503) return { ok: false, error: `HTTP ${res.status}` };
    const parsed = HealthResponse.safeParse(await res.json());
    return parsed.success ? { ok: true, health: parsed.data } : { ok: false, error: `HTTP ${res.status}: invalid health response` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
