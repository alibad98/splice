import { z } from 'zod';

/** What the dashboard connection chip shows (Story 1.8). The platform is always Salla in the MVP. */
export const ConnectionStatus = z.object({
  v: z.literal(1).default(1),
  state: z.enum(['connected', 'disconnected', 'not_connected']),
  /** The store's name from the platform; absent when not connected. */
  store_name: z.string().optional(),
});
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;
