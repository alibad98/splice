import { Metric, type Telemetry } from '../../ports/telemetry.js';

/** The slice of pg-boss `getQueues` the poller needs. */
export interface QueueStatsSource {
  getQueues(names?: string[]): Promise<Array<{ name: string; queuedCount: number; readyOldestSeconds: number | null }>>;
}

export interface WatchedQueue {
  name: string;
  deadLetter: string;
}

/** One pass: publish queue depth, oldest-ready age and dead-letter depth per queue. */
export async function pollQueueStats(
  source: QueueStatsSource,
  queues: readonly WatchedQueue[],
  telemetry: Telemetry,
  probe?: { isReachable(): Promise<boolean> },
): Promise<void> {
  if (probe) telemetry.gauge(Metric.WorkerUp, (await probe.isReachable()) ? 1 : 0);
  if (queues.length === 0) return;
  const stats = new Map((await source.getQueues(queues.flatMap((q) => [q.name, q.deadLetter]))).map((s) => [s.name, s]));
  for (const q of queues) {
    const main = stats.get(q.name);
    telemetry.gauge(Metric.QueueDepth, main?.queuedCount ?? 0, { queue: q.name });
    telemetry.gauge(Metric.QueueOldestAgeSeconds, main?.readyOldestSeconds ?? 0, { queue: q.name });
    telemetry.gauge(Metric.DeadLetterDepth, stats.get(q.deadLetter)?.queuedCount ?? 0, { queue: q.name });
  }
}

/** Poll on an interval; a failed pass is logged and the next one still runs. Returns a stop function. */
export function startQueueStatsPoller(source: QueueStatsSource, queues: readonly WatchedQueue[], telemetry: Telemetry, intervalMs = 30_000, probe?: { isReachable(): Promise<boolean> }): () => void {
  const run = () => pollQueueStats(source, queues, telemetry, probe).catch((err: unknown) => telemetry.captureError(err, { task: 'queue-stats' }));
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
