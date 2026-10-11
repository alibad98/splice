import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Metric, type Telemetry } from '../../ports/telemetry.js';

const ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;
const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function resolveRequestId(req: Request): string {
  const inbound = header(req, 'x-request-id');
  return inbound && ID_PATTERN.test(inbound) ? inbound : randomUUID();
}

/** trace_id from W3C `traceparent`, else `x-trace-id`, else a fresh 128-bit id. */
export function resolveTraceId(req: Request): string {
  const tp = TRACEPARENT.exec(header(req, 'traceparent') ?? '')?.[1];
  if (tp && !/^0+$/.test(tp)) return tp;
  const inbound = header(req, 'x-trace-id');
  return inbound && ID_PATTERN.test(inbound) ? inbound : randomBytes(16).toString('hex');
}

export function outcomeOf(status: number): 'success' | 'client_error' | 'server_error' {
  return status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'success';
}

/** Requests from the merchant dashboard count towards the NFR7 dashboard SLI. */
export function isDashboardRequest(req: Request): boolean {
  return header(req, 'x-slips-client') === 'dashboard' || req.path.startsWith('/v1/dashboard');
}

const QUIET_PATHS = new Set(['/v1/health', '/metrics']);

/** Express middleware: ids into context, response header echo, completion log and request metrics. */
export function requestTelemetry(telemetry: Telemetry) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const request_id = resolveRequestId(req);
    const trace_id = resolveTraceId(req);
    res.setHeader('x-request-id', request_id);
    res.setHeader('x-trace-id', trace_id);
    telemetry.withContext({ request_id, trace_id }, () => {
      const live = telemetry.context();
      const started = process.hrtime.bigint();
      res.once('finish', () => {
        const seconds = Number(process.hrtime.bigint() - started) / 1e9;
        const outcome = outcomeOf(res.statusCode);
        telemetry.counter(Metric.ApiRequests, { outcome });
        if (isDashboardRequest(req)) telemetry.counter(Metric.DashboardRequests, { outcome });
        telemetry.observe(Metric.ApiRequestDuration, seconds);
        // `live` is read at finish time so a store_id set by the handler is included.
        telemetry.withContext(live, () => {
          const fields = { method: req.method, path: req.path, status: res.statusCode, duration_ms: Math.round(seconds * 1000) };
          if (QUIET_PATHS.has(req.path)) telemetry.log.debug('request completed', fields);
          else telemetry.log.info('request completed', fields);
        });
      });
      next();
    });
  };
}

/** Captures unexpected errors and answers with RFC 9457 problem+json. */
export class TelemetryExceptionFilter implements ExceptionFilter {
  constructor(private readonly telemetry: Telemetry) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) this.telemetry.captureError(exception);
      const body = exception.getResponse();
      res.status(status).type('application/problem+json').json({
        type: 'about:blank',
        title: exception.message,
        status,
        ...(typeof body === 'object' ? { detail: (body as { message?: unknown }).message } : {}),
      });
      return;
    }
    this.telemetry.captureError(exception);
    res.status(500).type('application/problem+json').json({ type: 'about:blank', title: 'Internal Server Error', status: 500 });
  }
}

/** Constant-time check of `Authorization: Bearer <token>`. Returns false when no token is configured. */
export function isAuthorizedForMetrics(authorization: string | undefined, token: string | undefined): boolean {
  if (!token || !authorization) return false;
  const given = Buffer.from(authorization.replace(/^Bearer\s+/i, ''));
  const wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
