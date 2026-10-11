// The single source of queue groups, concurrency and retry policy (AD-1).
// Default: 5 attempts with exponential backoff 30 s -> 15 min; media: 3 attempts.
import { EVENT_QUEUE } from '@slips/contracts';
import type { QueueOptions } from 'pg-boss';

export const QUEUE_GROUPS = ['realtime', 'media', 'batch'] as const;
export type QueueGroup = (typeof QUEUE_GROUPS)[number];

export interface GroupPolicy {
  /** Total attempts including the first run. */
  attempts: number;
  /** Jobs processed concurrently per worker process. */
  concurrency: number;
}

export const RETRY_DELAY_SECONDS = 30;
export const RETRY_DELAY_MAX_SECONDS = 15 * 60;

export const GROUP_POLICY: Record<QueueGroup, GroupPolicy> = {
  realtime: { attempts: 5, concurrency: 10 },
  media: { attempts: 3, concurrency: 2 },
  batch: { attempts: 5, concurrency: 4 },
};

/** pg-boss queue options for a group: retryLimit counts retries, so attempts - 1. */
export function queueOptions(group: QueueGroup): QueueOptions {
  return {
    retryLimit: GROUP_POLICY[group].attempts - 1,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    retryDelayMax: RETRY_DELAY_MAX_SECONDS,
  };
}

/** A job queue (`<module>.<job>`) and the group whose worker runs it. */
export interface QueueDefinition {
  name: string;
  group: QueueGroup;
}

/** Name of the queue that receives a queue's jobs after their last attempt fails. */
export function deadLetterName(queue: string): string {
  return `${queue}.dead_letter`;
}

/** Registered queues. Modules add theirs here as they land. */
export const QUEUES: readonly QueueDefinition[] = [{ name: EVENT_QUEUE, group: 'realtime' }];

export function queuesFor(groups: readonly QueueGroup[], queues: readonly QueueDefinition[] = QUEUES): QueueDefinition[] {
  return queues.filter((q) => groups.includes(q.group));
}
