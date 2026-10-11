import { z } from 'zod';

/**
 * Envelope fields every job payload carries (v1) so one trace spans request and job.
 * Job payload schemas extend this. Additive changes only.
 */
export const JobMeta = z.object({
  v: z.literal(1),
  trace_id: z.string().min(1).max(64),
  store_id: z.string().min(1).max(64).optional(),
});
export type JobMeta = z.infer<typeof JobMeta>;
