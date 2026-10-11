// Telemetry port (AD-22). Domain code depends on this; adapters bring the vendor.
// Names are free strings validated against the catalogue below only by convention,
// so a new metric (compile lag, player errors) never changes the port.

export type Labels = Readonly<Record<string, string>>;

/** Metric catalogue. Add names here; callers and the port stay unchanged. */
export const Metric = {
  /** Counter, label `outcome`: `success` | `client_error` | `server_error`. API error rate and the NFR7 dashboard SLI derive from it. */
  ApiRequests: 'slips_api_requests_total',
  /** Histogram of API request duration in seconds. */
  ApiRequestDuration: 'slips_api_request_duration_seconds',
  /** Counter, label `outcome` (as ApiRequests): dashboard requests, the NFR7 dashboard SLI. */
  DashboardRequests: 'slips_dashboard_requests_total',
  /** Counter: failed Salla API calls, label `reason`. */
  SallaApiFailures: 'slips_salla_api_failures_total',
  /** Counter: webhook jobs that failed an attempt. */
  WebhookFailures: 'slips_webhook_failures_total',
  /** Gauge, label `queue`: jobs sitting in that queue's dead-letter queue. Above zero means a job gave up. */
  DeadLetterDepth: 'slips_dead_letter_depth',
  /** Counter, labels `queue`, `outcome` (`completed` | `failed`). */
  JobsProcessed: 'slips_jobs_processed_total',
  /** Gauge, label `queue`: jobs waiting to run. */
  QueueDepth: 'slips_queue_depth',
  /** Gauge, label `queue`: age in seconds of the oldest ready job. */
  QueueOldestAgeSeconds: 'slips_queue_oldest_age_seconds',
  /** Gauge: 1 while the worker's last DB check succeeded (worker liveness). */
  WorkerUp: 'slips_worker_up',
} as const;

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** Ids that follow a request into the jobs it causes. snake_case matches the log fields. */
export interface TraceContext {
  request_id?: string;
  trace_id: string;
  store_id?: string;
  job_id?: string;
}

export interface Telemetry {
  readonly log: Logger;
  counter(name: string, labels?: Labels, value?: number): void;
  gauge(name: string, value: number, labels?: Labels): void;
  /** Observe a value (seconds for durations) into a histogram. */
  observe(name: string, value: number, labels?: Labels): void;
  /** Record an error with redacted context; also logs it at error level. */
  captureError(err: unknown, context?: LogFields): void;
  /** Run `fn` with the given ids merged into the ambient context (logs pick them up). */
  withContext<T>(ctx: Partial<TraceContext>, fn: () => T): T;
  /** The live ambient context (empty outside any context). Read it; change it only via `setStoreId`/`withContext`. */
  context(): Readonly<Partial<TraceContext>>;
  /** Set `store_id` on the ambient context once the request resolves its store. */
  setStoreId(storeId: string): void;
}

/** DI tokens for the ports (Nest providers). */
export const TELEMETRY = Symbol('Telemetry');
