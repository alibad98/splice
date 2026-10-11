---
title: 'Story 1.3: Establish the observability baseline'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '205b97dd0472a5c00bd143fb63ccb51c466c4a7e'
baseline_revision: '205b97dd0472a5c00bd143fb63ccb51c466c4a7e'
route: 'dispatch'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The API and worker log with `console`, expose no metrics, redact nothing, have no alert rules, and `GET /v1/health` is always "ok" with no DB check and no worker liveness. The gate spike and pilot need to see and fix problems (AD-22, NFR7, NFR8, NFR3).

**Approach:** Add one `Telemetry` port (`src/ports`) with a vendor-neutral adapter (pino logs, in-process metric registry exposed in Prometheus text format, error capture). Carry `request_id`/`trace_id`/`store_id`/`job_id` through AsyncLocalStorage across HTTP and jobs. Add alert rules with owners and runbooks, a `feature_flags` config reader, a real DB health check, and a worker liveness endpoint.

## Boundaries & Constraints

**Always:**
- Domain modules depend only on the `Telemetry`, `FeatureFlags` and `DatabaseProbe` ports; the implementations live in `src/adapters` and are wired in `app.module.ts`/`main.ts`.
- Redaction is key-based and deep: tokens, secrets, passwords, cookies, `Authorization`, signatures and shopper PII fields (email, phone, name, address, customer) become `[REDACTED]` in every log line and captured error context.
- Job payloads are validated against a `JobMeta` v1 contract in `@slips/contracts` (`v`, `trace_id`, optional `store_id`).
- Adding a metric or alert (compile lag, player errors) must need only a new name in the metric catalogue, never a port change.
- Health stays `HealthResponse` v1, extended additively (`checks`).

**Never:**
- No vendor SDK (hosting/observability vendor is deferred), no DB tables or migrations, no raw request bodies in logs.
- No dashboard restyle.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Request logging | any HTTP request, optional `x-request-id` / `traceparent` | one pino JSON line with `request_id`, `trace_id`, status, duration; ids echoed in `x-request-id` | invalid inbound id replaced by a generated one |
| Job run | payload with `trace_id`, `store_id` | all logs inside carry `job_id`, `trace_id`, `store_id`; outcome counted per queue | payload without `trace_id`: job fails, counted as failed |
| Redaction | `Authorization`, `token`, `email` keys, nested | values `[REDACTED]` in logs and error context | cyclic objects do not throw |
| Health | DB reachable / unreachable | 200 `ok` / 503 `degraded`, `checks.database` | probe times out in 2 s |
| Worker liveness | worker health port | 200 when DB reachable, else 503 | N/A |
| Alert rules | rule file | each rule has owner and an existing runbook | test fails otherwise |
| Flag read | unset / set / malformed | default / configured value / default | malformed env fails boot naming `FEATURE_FLAGS` |

</intent-contract>

## Code Map

- `apps/api/src/ports/` -- empty; gets `telemetry.ts`, `feature-flags.ts`, `database-probe.ts`.
- `apps/api/src/adapters/` -- gets `telemetry/` (pino, registry, redaction, ALS context) and `postgres/` (probe); not `salla/`.
- `apps/api/src/{main,http,app.module}.ts`, `src/config/env.ts`, `src/worker/{worker,queues}.ts`, `src/modules/health/` -- wiring points; health test builds the app via `createHttpApp`.
- `packages/contracts/src/v1/health.ts` -- extend; `apps/dashboard/lib/health.ts` -- must read a 503 degraded body.
- `pg-boss` `getQueues()` gives `queuedCount` and `readyOldestSeconds` (queue depth and age).
- `docs/runbooks/` -- add alert runbooks (allowed path).

## Tasks & Acceptance

**Execution:**
- `packages/contracts/src/v1/{health,job-meta}.ts` -- additive `checks`; `JobMeta` v1 -- shared wire shapes
- `apps/api/src/ports/*.ts` -- Telemetry, FeatureFlags, DatabaseProbe ports and metric catalogue
- `apps/api/src/adapters/telemetry/*` -- redaction, ALS context, pino logger, metric registry (Prometheus text), error capture, request middleware, exception filter, job wrapper, queue stats poller
- `apps/api/src/adapters/{postgres,feature-flags}/*` -- DB probe; env-backed flags with defaults
- `apps/api/src/{config/env,main,http,app.module}.ts`, `src/worker/worker.ts`, `src/modules/health/*` -- wire in; DB-aware health; worker liveness and metrics server
- `ops/alert-rules.json`, `docs/runbooks/{alert-api-error-rate,alert-webhook-dead-letter}.md` -- alerts with owner and runbook
- Unit tests for each of the above, including an alert-rule integrity test and a redaction test.

**Acceptance Criteria:**
- Given the http role handles a request, when it completes, then its pino line carries `request_id` and `trace_id` (and `store_id` once set).
- Given a job runs, when it logs, then the line carries `job_id`, `trace_id`, `store_id`.
- Given a secret or PII key in a log or captured error, then it is redacted (unit-tested).
- Given the metrics endpoint, then it lists API error rate, Salla failure, webhook failure, queue depth/age and dashboard-request SLI counters.
- Given the database is down, when `/v1/health` is called, then 503 with `degraded`.
- Given alert rules, then each names an owner and links an existing runbook.
- Given an unset flag, then its registered default is returned.

## Spec Change Log

## Review Triage Log

### 2026-10-11 - Review pass (self-review; no subagent tool was available)
- verdicts: 3 findings - high 0, medium 1, low 2, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` No producer-side helper put trace_id/store_id into job payloads (only the consumer validated them) - added `jobMeta()` with tests.
  - `[low]` `[reject]` Unauthenticated /v1/health runs a DB query per call - bounded by a 1-connection pool and 2 s timeout.
  - `[low]` `[reject]` Dashboard SLI header can be spoofed - metrics-only effect; recorded in deferred-work.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` (Node 24) -- expected: all green

## Implementation Notes

- DECISION: Telemetry is one vendor-neutral adapter (pino logs, in-process registry served as Prometheus text at `GET /metrics`, errors logged redacted). The endpoint is disabled (404) unless `METRICS_TOKEN` is set, otherwise bearer-protected. Error-tracking vendor is deferred.
- DECISION: Redaction is key-based, deep and over-cautious (any key containing token, secret, password, cookie, authorization, signature, email, phone, name parts, address, customer, shopper...). Bearer and JWT strings are scrubbed from error text.
- DECISION: Alerts are vendor-neutral PromQL rules in `ops/alert-rules.json` (threshold 5% 5xx over 5 minutes; dead-letter depth above 0). Owners are role names `platform-oncall` and `integration-owner` until real contacts exist. Runbooks: `docs/runbooks/alert-*.md`. A test checks owner, threshold, existing runbook and declared metrics.
- DECISION: Webhook dead-lettering is detected by a gauge of each queue's `<queue>.dead_letter` depth, not by consuming the dead-letter queue, so failed jobs stay available for replay.
- DECISION: Feature flags are env-backed (`FEATURE_FLAGS=name=true`) with code defaults; the DB config table named in AD-22 waits for the schema stories.
- DECISION: Dashboard requests for the NFR7 SLI are those with `x-slips-client: dashboard` or a `/v1/dashboard` path.
- DECISION: `/v1/health` returns 503 with `degraded` when the database is unreachable; the worker role serves its own `GET /health` on `WORKER_HEALTH_PORT` (default 3002). The dashboard shows the degraded body.
- Resolved deferred items from 1.1: health DB check and worker liveness; `startWorker` now takes the queue list and handlers and `registerQueues` is unit-tested. Health now reads the validated version (also closes triage row 3 of 1.1).
- CI: `checks` job gains a Postgres 18 service on port 5433 (same URL as the local test DB) for the probe test.
- Subagents were not available: implementation and review were done in-process; an independent review should follow.

## Auto Run Result

Status: done. Added the Telemetry, FeatureFlags and DatabaseProbe ports with adapters (`apps/api/src/adapters/{telemetry,postgres,feature-flags}`), request and job context propagation, redaction, metrics endpoint, queue depth/age/dead-letter poller, DB-aware health, worker liveness server, alert rules and runbooks, contracts `JobMeta` and `checks`. Verified: `pnpm turbo run lint typecheck test build` 25/25 under Node 24 (api 41 tests); manual boot of both roles against local Postgres.
