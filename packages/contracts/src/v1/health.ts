import { z } from 'zod';

/** `GET /v1/health` response body (v1). Additive changes only. */
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  role: z.enum(['http', 'worker']),
  version: z.string(),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
