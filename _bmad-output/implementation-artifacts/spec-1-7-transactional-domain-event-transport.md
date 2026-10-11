---
title: 'Story 1.7: Provide the transactional domain event transport'
type: 'feature'
created: '2026-10-11'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      The http role has no pg-boss producer yet; publishEvent takes an EventSender (a PgBoss instance), but nothing constructs one in the http role.
    evidence: No module publishes yet. When the first one does, build a send-only PgBoss (no work, no start-time migration) in the http infra; the events.dispatch queue is created by the worker at boot, so publishing before the first worker boot fails on the queue foreign key.
  - summary: >-
      The event catalogue holds one seed event (integration.store.installed); real events arrive with their owning stories.
    evidence: Each story that emits adds its entry to packages/contracts/src/v1/events.ts and a handler via EventHandlerRegistry.
---

<intent-contract>

## Intent

**Problem:** Cross-module reactions could fire before commit, after rollback, or be lost on a crash.

**Approach:** Outbox helper enqueues a pg-boss job on the caller's transaction; a catalogue in contracts types events; a worker-only dispatcher runs idempotent handlers.

## Boundaries & Constraints

**Always:** AD-17; reuse withStoreContext and instrumentJob/queue metrics.

**Never:** In-process emitters across modules; consuming events in http.

</intent-contract>

## Code Map

- `packages/contracts/src/v1/events.ts` -- EVENT_CATALOG (owner + v1 Zod schema), EventName/EventPayload types, EventEnvelope, EVENT_QUEUE
- `packages/db/migrations/0002_event_deliveries.sql` -- idempotency ledger, PK (event_id, handler)
- `apps/api/src/events/outbox.ts` -- publishEvent (pg-boss `send` with `db` = caller's tx, job id = event id), uuidv7
- `apps/api/src/events/dispatcher.ts` -- EventHandlerRegistry, eventDispatcher (ledger insert + handler in one tx, in store context when store_id)
- `apps/api/src/worker/{queues,worker}.ts` -- events.dispatch queue (realtime); startWorker wires the dispatcher and takes a registry
- `packages/config/eslint.js` -- bans EventEmitter / @nestjs/event-emitter / mitt in apps/api/src outside adapters

## Tasks & Acceptance

**Acceptance Criteria:**
- Given publishEvent inside a transaction, when it commits one job exists, when it rolls back none (not visible before commit).
- Given an unknown name (compile error), a bad payload or wrong v, then publish fails and nothing is enqueued; names match the pattern and prefix their owner.
- Given the same event id delivered twice, the handler effect happens once; a failing handler rolls back its ledger row so retry reruns it.
- Given http role code, then no pg-boss work/fetch/subscribe outside src/worker (test).
- Given an in-process emitter import in apps/api/src, lint fails.

## Implementation Notes

- DECISION: one queue `events.dispatch` (realtime group) carries all events; the dispatcher fans out to handlers by name, each tracked by (event_id, handler id).
- DECISION: the ledger is an infrastructure table created by raw SQL migration (not in the Drizzle schema, so no module ownership entry); granted to slips_app.
- DECISION: pg-boss job id = event id (UUIDv7, generated in-process), making a retried publish idempotent.
- DECISION: seed catalogue entry `integration.store.installed` (spine: integration emits store lifecycle events).
- DECISION: deferred item "startWorker takes the queue list and test queue registration" was already closed in Story 1.3 (startWorker takes queues, handlers; registerQueues is unit-tested); this story adds the first real registered queue and an end-to-end test through it.

## Review Triage Log

### 2026-10-11 -- self-review (no subagent tool available)
- Findings: http producer wiring missing (defer, above); handler failure retry semantics covered by test; no high findings.

## Verification

- `pnpm turbo run lint typecheck test build` -- 26 tasks successful after deleting all dist/.next, against local Postgres 16.

## Auto Run Result

Status: done. Reviews done by me, not subagents; parent should run an independent review.
