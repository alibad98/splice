---
title: 'Story 1.10: Receive install and uninstall webhooks and run the store lifecycle'
type: 'feature'
created: '2026-10-11'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Salla webhook specifics are desk-researched only (verify in Story 1.13): the signature header/encoding (hex HMAC-SHA256 of the raw body), the absence of an event id, the authorize payload fields (data.access_token, refresh_token, expires, scope) and whether created_at is present and in what format.
    evidence: |-
      Adapter: apps/api/src/adapters/salla (parseWebhook, SALLA_APP_EVENTS). Event id is the SHA-256 of the raw body because no id is documented; if Salla re-sends an event with a changed body (e.g. a new timestamp) it would not dedupe.
  - summary: >-
      Purge covers only registered StoreDataLifecycle modules (session and integration today). Media/CDN deletion, events_raw batches and every later module's purge are added by their own stories (Epics 2-7, Story 7.13 verification).
    evidence: |-
      The tombstone (stores row, store_locator, store_data_jobs row, lifecycle_audit, store_purge_schedule is removed) survives a purge by design; the 7.13 check "no row with that store_id remains in any tenant table" must exempt stores and store_data_jobs or the tombstone must move to a non-tenant table.
  - summary: >-
      webhook_inbox rows (processed/ignored/dead-lettered) and lifecycle_audit have no retention job; no Salla-side token revocation call on uninstall (the stored pair is deleted; Salla revokes its side on uninstall).
    evidence: |-
      Add with the event_deliveries and token_access_log retention job. Dead-lettered inbox rows are surfaced through the slips_dead_letter_depth gauge (queue integration.webhook.inbox) and need a replay procedure in docs/runbooks/alert-webhook-dead-letter.md.
  - summary: >-
      Billing-related processing "skipped for an uninstalled store" is provided as IntegrationService.isStoreActive/isStoreActiveById; the billing module (Epic 6) must call it. Epic 4's content endpoint must call isStoreActive with the request's locator.
    evidence: |-
      No billing code exists yet; the check returns false for unknown, disconnected, uninstalled and purged stores.
  - summary: >-
      Authorize/uninstall ordering relies on the event created_at against stores.epoch_started_at / uninstalled_at with a 5 s skew tolerance; events without created_at are applied in arrival order.
    evidence: |-
      Verify real ordering and timestamps in Story 1.13. Worst case is a stale event applied once; the next authorize/uninstall corrects it.
  - summary: >-
      Local dev DBs that applied an earlier draft of migration 0008 must be rebuilt (the migration was amended before release).
    evidence: |-
      Only matters to this environment's shared Postgres; CI builds from scratch.
---

<intent-contract>

## Intent

**Problem:** Slips can be installed but nothing reacts when a merchant uninstalls, reinstalls or leaves for good: webhooks are not received, there is no grace period or purge, and no active-store check protects storefront endpoints.

**Approach:** A signature-verified, idempotent webhook inbox; guarded lifecycle transitions (active, disconnected, uninstalled with 30-day grace, purged) with reinstall restoring the same row and bumping the epoch; one resumable per-store purge job over a StoreDataLifecycle port; Easy Mode authorize reusing installFromTokens.

## Boundaries & Constraints

**Always:** Verify X-Salla-Signature over the raw body, timing-safe, before anything else (401, nothing stored); store only the canonical allow-listed payload, body hash, type, store external id and event id; never log or store raw bodies; unknown-store events are parked and retried 15 minutes then dead-lettered, never 404; transitions run under a per-store lock with guarded writes; events via publishEvent in the same transaction; Salla names only in the adapter.

**Never:** Shopper PII in the inbox; plaintext tokens in the inbox; a second install path; modules touching each other's tables (they register a StoreDataLifecycle).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Bad signature | tampered body or wrong key | 401, no row | none stored |
| Duplicate event | same body twice | one row, transition once | 200 for both |
| Unknown store | uninstall/installed before OAuth | 200, parked, retried 1 min for 15 min | then dead_lettered |
| Uninstall | active store | uninstalled, grace_ends_at +30d, tokens deleted, sessions suspended, event, purge scheduled | stale (pre-epoch) event ignored |
| Reinstall | uninstalled store | same row, epoch+1, active, reinstalled event, purge schedule removed | purged store restarts as installed |
| Purge | grace over | batches, per-module progress, audit, state purged | epoch/state change aborts; stale epoch dropped |

</intent-contract>

## Code Map

- `packages/db/migrations/0008_store_lifecycle.sql`, `src/schema/integration.ts` -- stores grace/epoch columns; webhook_inbox (non-tenant), store_data_jobs (tenant, RLS), lifecycle_audit, store_purge_schedule (non-tenant sweep index)
- `packages/contracts/src/v1/events.ts` -- uninstalled, reinstalled, purged events
- `apps/api/src/ports/commerce-platform.ts`, `adapters/salla/*` -- webhooks.parse and the canonical webhook (allow-list)
- `apps/api/src/ports/store-data-lifecycle.ts` -- StoreDataLifecycle (suspend, restore, export, purge); `modules/session/session.lifecycle.ts`, `modules/integration/integration.lifecycle.ts`
- `apps/api/src/modules/integration/webhook-inbox.ts`, `webhook.controller.ts` -- intake, parking, retry, dead letter
- `apps/api/src/modules/integration/store-lifecycle.ts` -- uninstall, reinstall, purge job; `integration.service.ts` -- installFromTokens restore branch, isStoreActive
- `apps/api/src/worker/integration-jobs.ts`, `worker.ts`, `queues.ts` -- minute sweep, purge queue, lifecycle event handlers
- `apps/api/src/composition/lifecycle.test.ts` -- live Postgres tests

## Tasks & Acceptance

**Execution:** all files above implemented; tests in lifecycle.test.ts, salla.test.ts, events.test.ts, schema/integration.test.ts.

**Acceptance Criteria:**
- Given an invalid signature, then 401 and no row; given a valid one, a canonical PII-free row, 200, and no body in logs (tested).
- Given the same event twice, then one row and one transition (tested, concurrent).
- Given an unknown store, then 200, parked, dead-lettered after 15 min (tested).
- Given an uninstall, then state, grace, event, tokens revoked and isStoreActive false (tested).
- Given a reinstall in the grace, then same row, epoch+1, reinstalled event (tested).
- Given the grace end, then one resumable purge with lock, state/epoch re-checks, every module, audit, purged; a reinstall stops further batches (tested).

## Spec Change Log

## Review Triage Log

### 2026-10-11 -- self-review (no subagent tool available; parent should run an independent review)
- verdicts: 5 findings -- high 1, medium 2, low 1, false 1
  - `[high]` `[patch]` An authorize delivered after (but created before) an uninstall would have resurrected the store -- fixed with authorizePredatesUninstall.
  - `[medium]` `[patch]` Purge checked state before epoch, so a stale-epoch job on a reinstalled store reported noop rather than stale -- reordered.
  - `[medium]` `[patch]` Lifecycle events had no worker handler (dispatcher fails events without one) -- logging handlers registered.
  - `[low]` `[patch]` Inbox timestamps used DB clock, not the service clock -- now explicit.
  - `[false]` `[reject]` Inline processing in the HTTP handler is long-running work -- it is one short DB transaction; authorize (outbound call) is left to the sweep.

## Implementation Notes

- DECISION: Salla documents no event id; the event id is the SHA-256 of the raw body (a retry resends the same bytes). Verify in Story 1.13.
- DECISION: only app.store.authorize, app.installed and app.uninstalled drive the lifecycle; every other signed event is stored canonical-only and marked ignored (billing and store events are later stories). app.installed is a no-op once the store exists (Easy Mode tokens arrive in authorize).
- DECISION: the Easy Mode token pair is kept in webhook_inbox.secret_enc, envelope-encrypted with AAD `inbox:<platform>:<event_id>`, and nulled when the row is processed or dead-lettered.
- DECISION: webhook_inbox is not a tenant table (the store may not exist yet); store_purge_schedule is a non-tenant index so the sweep can find due stores without a store context; lifecycle_audit is keyed by the platform locator so it survives a purge.
- DECISION: uninstall (no outbound call) is processed inline in the HTTP request after the row is stored so Slips stops immediately; authorize and retries are processed by a worker sweep every minute (queue integration.webhook.sweep), which also queues integration.store.purge jobs.
- DECISION: unknown-store events retry every 60 s for 15 minutes from first sighting, then dead-letter; other failures use the shared policy (5 attempts, 30 s doubling to 15 min); a rejected token dead-letters at once.
- DECISION: "tokens revoked" means deleting our stored pair (and refusing getAccessToken for non-active stores); no revoke call to Salla.
- DECISION: a reinstall is accepted while the state is `uninstalled` even past the grace if the purge has not finished (the merchant wins the race; the purge aborts at its next lock check); after `purged` the same row restarts as a fresh install at epoch+1 with `integration.store.installed`.
- DECISION: purge leaves a tombstone (stores row in state purged with name scrubbed, locator, job row, audit) so the locator and epoch stay valid; see deferred for Story 7.13.
- DECISION: an uninstall created more than 5 s before the current epoch started is dropped as stale; an authorize created more than 5 s before the uninstall is dropped.
- DECISION: StoreDataLifecycle also has `suspend` (called on uninstall) beyond the export/purge/restore in the story, so sessions end at once.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -- expected: 26/26 successful against local Postgres 16 (run after deleting every dist and .next).
- `pnpm turbo run build --filter=@slips/player... && pnpm --filter @slips/player test:e2e` -- expected: 18 passed.

## Auto Run Result

Status: done. Planning, implementation and review were performed by me in one pass (no subagent tool was available); the parent should run an independent review.
- Follow-up review recommended: true (Salla webhook shapes are fixture-only; purge tombstone vs Story 7.13; inline webhook processing in the http role).
