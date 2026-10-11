---
title: 'Story 1.8: Install Slips through Salla OAuth and store tokens securely'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_revision: 'd4bc80be2f585d6ce66a5083ad3aae8080e6736f'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      Salla payload shapes and behaviours are desk-researched only; they need confirming on a real store (verify in Story 1.11-1.13).
    evidence: |-
      Token response fields and TTL, user/info shape (merchant.id as the storefront store.id, merchant.domain format), whether a refresh that fails mid-flight still consumes the single-use refresh token, 429/Retry-After header form, the Admin API order/product/subscription shapes, and the webhook signature header and encoding.
  - summary: >-
      The dashboard connection chip stays on the not-connected placeholder; it needs the merchant session (Story 1.9) to know which store to ask about.
    evidence: |-
      connectionFromStatus() (apps/dashboard/lib/shell.ts) and IntegrationService.getConnection() are ready and tested; getShellContext() cannot call the API for "the signed-in store" before sessions exist, and passing a store id from the browser would be unauthenticated.
  - summary: >-
      Reinstall of an uninstalled or purged store and install_epoch increments are not implemented; install refuses such a store (StoreLifecycleConflictError).
    evidence: |-
      AD-20 grace-period restore, uninstall states and Easy Mode app.store.authorize belong to Story 1.10; installFromTokens() is the shared entry point for it.
  - summary: >-
      Master key rotation is not wired in config: the cipher supports several key ids, the env carries one.
    evidence: |-
      TOKEN_ENCRYPTION_KEY plus TOKEN_ENCRYPTION_KEY_ID only. Add a key ring env and a re-encrypt job before the first rotation (runbook docs/runbooks/token-encryption-key.md).
  - summary: >-
      token_access_log grows by one row per getAccessToken call and has no retention job; SallaHttp per-store pacing maps are never pruned.
    evidence: |-
      Low volume at pilot scale. Add a retention/prune job with the event_deliveries one.
  - summary: >-
      The app role needs INSERT/SELECT on the pg-boss schema for the outbox, granted by the worker at boot (grantEventPublishing); an http publish before the first worker boot fails.
    evidence: |-
      Deploy order must be migrate, worker, http (or run grantEventPublishing from the deploy step). The http process also needs pg-boss schema migrated by a worker first.
---

<intent-contract>

## Intent

**Problem:** There is no way to install Slips from Salla, no store, merchant or token storage, and no safe way for the rest of the system to get a platform token.

**Approach:** A CommercePlatform port with a Salla adapter (OAuth, paced HTTP), the first tenant tables (stores, merchant_accounts, platform_tokens), envelope-encrypted tokens, an install flow, and integration.getAccessToken with single-flight refresh and disconnect-on-rejection.

## Boundaries & Constraints

**Always:** Salla names, URLs and fields only in apps/api/src/adapters/salla; tenant tables use tenantTableStatements and register with the cross-tenant harness; tokens and secrets never appear in logs, errors or responses; each token access is recorded; events go through publishEvent in the same transaction.

**Never:** Shopper PII; plaintext tokens in the DB; a second token refresher; Salla imports in domain modules.

</intent-contract>

## Code Map

- `packages/db/migrations/0004_integration_tables.sql`, `packages/db/src/schema/integration.ts` -- stores, store_locator, merchant_accounts, platform_tokens, token_access_log; forced RLS and explicit grants
- `packages/db/src/migrate.ts`, `packages/db/src/testing/app-role.ts` -- advisory-locked migrations; non-superuser test role helper
- `packages/contracts/src/v1/events.ts`, `connection.ts` -- integration.store.disconnected; ConnectionStatus
- `apps/api/src/ports/commerce-platform.ts`, `token-cipher.ts` -- the ports and error classes
- `apps/api/src/adapters/salla/*` -- endpoints, paced HTTP with Retry-After, OAuth, canonical mapping, webhook verification
- `apps/api/src/adapters/crypto/envelope-cipher.ts` -- AES-256-GCM envelope (data key per value, master key from env, AAD binds store and field)
- `apps/api/src/adapters/pgboss/send-only-producer.ts`, `events/queue-grants.ts` -- http-role event producer and the app-role grants on the pg-boss schema
- `apps/api/src/modules/integration/*` -- service (install, getAccessToken, getConnection), repository (StoreScoped), OAuth state, controller (GET /v1/integrations/salla/install and /callback)
- `apps/api/src/http.ts`, `infra.module.ts`, `config/env.ts` -- wiring and env (TOKEN_ENCRYPTION_KEY, SALLA_*)
- `apps/api/src/composition/integration.test.ts` -- live-Postgres tests (RLS role, real pg-boss)
- `apps/dashboard/lib/shell.ts` -- connectionFromStatus mapper

## Tasks & Acceptance

**Execution:**
- Port, Salla adapter, envelope cipher, tables and migration, install flow, getAccessToken, send-only producer, env and docs as listed in the Code Map -- all done.

**Acceptance Criteria:**
- Given the port and Salla adapter, when domain code needs Salla, then it depends on the port only and lint fails on Salla imports outside the adapter (existing boundaries test).
- Given an OAuth install, then a stores row (salla, platform_store_id, name, active, epoch 1, domains), one merchant_accounts row and envelope-encrypted platform_tokens exist, located by (platform, platform_store_id) (composition test).
- Given any log line or error, then no token or secret appears and each token access is recorded (log capture test, token_access_log rows).
- Given concurrent callers with an expired token, then exactly one refresh happens under pg_advisory_xact_lock and all get the new token (composition test).
- Given a definitive refresh rejection, then the store is disconnected and integration.store.disconnected is emitted once (composition test).
- Given a 429 with Retry-After, then the adapter waits and paces per store (adapter tests).
- Given an installed store, then the chip data is available (ConnectionStatus); the dashboard wiring waits for Story 1.9 sessions (see Implementation Notes).

## Spec Change Log

## Review Triage Log

### 2026-10-11 -- self-review (no subagent tool available; parent should run an independent review)
- verdicts: 7 findings -- high 0, medium 3, low 2, false 2, maybe-false 0
- findings:
  - `[medium]` `[patch]` Domain code hard-coded the literal 'salla' in SQL and the repository -- fixed to use platform.platform from the port.
  - `[medium]` `[patch]` Outbox insert ran as the app role without privileges on the pg-boss schema (found by the composition test) -- added grantEventPublishing at worker boot; deploy-order risk deferred.
  - `[medium]` `[defer]` Dashboard chip cannot be wired without a session -- deferred to 1.9.
  - `[low]` `[defer]` token_access_log retention and pacer map pruning -- deferred.
  - `[low]` `[reject]` State is replayable within 10 minutes -- the cookie is cleared on callback and the code is single-use at Salla.
  - `[false]` `[reject]` Refresh holds a DB transaction during the Salla call -- required by AD-4 (persist in the same transaction); the adapter times out at 10 s.
  - `[false]` `[reject]` Callback query could be logged -- request logging records req.path only, tested paths exclude the query.

## Implementation Notes

- DECISION: Custom Mode OAuth (authorization code at accounts.salla.sa) implements this story's "OAuth flow"; installFromTokens() is the shared core so Easy Mode (app.store.authorize webhook, Story 1.10) reuses it.
- DECISION: `stores` carries `store_id` = `id` (CHECK) so the standard tenant RLS policy applies; a non-RLS `store_locator` table maps (platform, platform_store_id) to the id before any store context exists (no separate public ID; it exposes only that mapping).
- DECISION: scopes default to offline_access, settings.read, products.read, orders.read, webhooks.read_write (SALLA_SCOPES overrides).
- DECISION: envelope encryption is AES-256-GCM with a per-value data key wrapped by the env master key; AAD = `<store_id>:<field>`; key id stored per row; env TOKEN_ENCRYPTION_KEY required only in production.
- DECISION: token access is recorded in a tenant table `token_access_log` (purpose, outcome, time; no token values), written in the same transaction.
- DECISION: only a definitive OAuth rejection (401, or invalid_grant/invalid_token/unauthorized_client/access_denied) disconnects a store; network errors, 5xx, 429 and unknown 4xx surface as PlatformUnavailableError and change nothing.
- DECISION: re-authorising a `disconnected` store reactivates it without bumping install_epoch or re-emitting installed; `uninstalled`/`purged` stores are refused until Story 1.10.
- DECISION: http-role publishing uses a lazily started send-only pg-boss (migrate/supervise/schedule off); the worker grants the app role INSERT/SELECT on the pg-boss schema after creating queues.
- DECISION: runMigrations takes a session advisory lock so parallel test files and deploys do not race; @slips/db re-exports drizzle `and`/`eq` so apps/api needs no direct drizzle dependency (no lockfile change).
- DECISION: dashboard chip wiring is deferred to Story 1.9 (no session to identify the store safely); the contract, API service method and mapper are done.

- DECISION (security review): store_locator is write-once (trigger; cascade delete from stores allowed), readable by the app role only via SECURITY DEFINER locate_store(); the app role's pg-boss access is INSERT plus SELECT(id) on the event queue's job table and SELECT on queue-settings columns of pgboss.queue only; token-endpoint calls never sleep on 429 (0 retries, 8 s timeout); a rotated token pair is persisted in its own transaction (3 attempts, token_persist_failed telemetry, persist_failed marker in token_access_log, invalid_grant within 10 minutes of it leaves the store connected as unavailable); install takes the refresh advisory lock; OAUTH_STATE_SECRET is required in production.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -- expected: all tasks successful (26/26), against local Postgres 16 at 127.0.0.1:5433.

## Auto Run Result

Status: done. Planning, implementation and review were performed by me in one pass (no subagent tool was available); the parent should run an independent review.
- Summary: Salla install via OAuth, first tenant tables with RLS and cross-tenant tests, envelope-encrypted tokens, single-flight refresh with disconnect event, per-store paced Salla HTTP with Retry-After, send-only http event producer, connection status contract.
- Follow-up review recommended: true (unverified risk: pg-boss schema grants and deploy order for http-role publishing; Salla response shapes are fixture-only).
