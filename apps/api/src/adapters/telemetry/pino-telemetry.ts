import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type DestinationStream, type Logger as PinoLogger } from 'pino';
import { Metric, type Labels, type LogFields, type Logger, type Telemetry, type TraceContext } from '../../ports/telemetry.js';
import { MetricRegistry } from './registry.js';
import { redact, scrubString } from './redact.js';

export interface PinoTelemetryOptions {
  level?: string;
  role: 'http' | 'worker';
  version?: string;
  /** Log destination; defaults to stdout. */
  stream?: DestinationStream;
}

const OUTCOMES = [{ outcome: 'success' }, { outcome: 'client_error' }, { outcome: 'server_error' }];

/** Vendor-neutral Telemetry adapter: pino JSON logs, an in-process metric registry, redacted error capture. */
export class PinoTelemetry implements Telemetry {
  readonly registry = new MetricRegistry();
  readonly log: Logger;
  private readonly als = new AsyncLocalStorage<Partial<TraceContext>>();
  private readonly pino: PinoLogger;

  constructor(opts: PinoTelemetryOptions) {
    this.pino = pino(
      {
        level: opts.level ?? 'info',
        base: { service: 'slips-api', role: opts.role, version: opts.version },
        timestamp: pino.stdTimeFunctions.isoTime,
        mixin: () => ({ ...this.als.getStore() }),
        // Every field of every log line goes through redaction before it is written.
        formatters: { log: (obj) => redact(obj) as Record<string, unknown> },
      },
      opts.stream,
    );
    const emit = (level: 'debug' | 'info' | 'warn' | 'error') => (msg: string, fields?: LogFields) => {
      const safe = scrubString(msg);
      if (fields) this.pino[level](fields, safe);
      else this.pino[level](safe);
    };
    this.log = { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };

    this.registry.declare(Metric.ApiRequests, 'counter', OUTCOMES);
    this.registry.declare(Metric.DashboardRequests, 'counter', OUTCOMES);
    this.registry.declare(Metric.SallaApiFailures, 'counter', [{}]);
    this.registry.declare(Metric.WebhookFailures, 'counter', [{}]);
    this.registry.declare(Metric.ApiRequestDuration, 'histogram');
    this.registry.declare(Metric.JobsProcessed, 'counter');
    this.registry.declare(Metric.QueueDepth, 'gauge');
    this.registry.declare(Metric.QueueOldestAgeSeconds, 'gauge');
    this.registry.declare(Metric.DeadLetterDepth, 'gauge');
    this.registry.declare(Metric.WorkerUp, 'gauge');
  }

  counter(name: string, labels?: Labels, value?: number): void {
    this.registry.counter(name, labels, value);
  }
  gauge(name: string, value: number, labels?: Labels): void {
    this.registry.gauge(name, value, labels);
  }
  observe(name: string, value: number, labels?: Labels): void {
    this.registry.observe(name, value, labels);
  }

  captureError(err: unknown, context?: LogFields): void {
    // No vendor yet (deferred): errors are logged at error level with redacted context.
    this.pino.error({ ...context, err: err instanceof Error ? err : new Error(String(err)), captured: true }, 'error captured');
  }

  withContext<T>(ctx: Partial<TraceContext>, fn: () => T): T {
    return this.als.run({ ...this.als.getStore(), ...ctx }, fn);
  }
  context(): Readonly<Partial<TraceContext>> {
    return this.als.getStore() ?? {};
  }
  setStoreId(storeId: string): void {
    const store = this.als.getStore();
    if (store) store.store_id = storeId;
  }
}
