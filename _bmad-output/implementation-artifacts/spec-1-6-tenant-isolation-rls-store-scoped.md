---
title: 'Story 1.6: Enforce tenant isolation with RLS and the StoreScoped repository'
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_revision: '1ad83b6a9833f4a15b28291d6f4db8c60c45b51d'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred:
  - summary: >-
      The admin read-only role exists but no code uses it and nothing audits its reads yet.
    evidence: |-
      AD-3 says every admin read lands in admin_audit_log. The admin_audit_log table and admin module arrive in Epic 7; add the audited admin read helper there.
  - summary: >-
      The API Docker image may not carry packages/db/migrations, and no deploy step runs runMigrations or grants LOGIN and a password to slips_app.
    evidence: |-
      Dockerfile copies a pruned /out; not verified that migrations are included. Hosting is undecided (Q-05). Verify when the first real migration job is wired.
    severity: medium (unverified)
  - summary: >-
      No tenant table exists yet, so the harness and convention audit run only against test fixture tables; the real-schema checks pass vacuously.
    evidence: |-
      Each tenant table story must call tenantTableStatements in its migration, register with registerTenantTable, and run assertCrossTenantIsolation. Consider a CI test that runs findTenantViolations on the fully migrated schema once tables exist.
---

<intent-contract>

## Intent

**Problem:** Nothing yet stops a query from reading another store's data.

**Approach:** Fence tenant access in code (StoreScoped repository plus one context helper) and in Postgres (forced RLS that fails closed), with an ownership registry and a cross-tenant test harness.

## Boundaries & Constraints

**Always:** AD-2 and AD-3 as in the architecture spine; tests of RLS run as a non-superuser, non-owner role.

**Never:** Create real tenant tables in this story (fixtures in tests only); set the store context any way but the helper.

</intent-contract>

## Code Map

- `packages/db/migrations/0000_app_roles.sql` -- creates slips_app (no tables, no BYPASSRLS) and slips_admin_ro (read-only, BYPASSRLS), default privileges
- `packages/db/src/tenant/context.ts` -- withStoreContext: the one helper (tx + set_config local), AsyncLocalStorage context, MissingStoreContextError
- `packages/db/src/tenant/store-scoped.ts` -- StoreScoped base class
- `packages/db/src/tenant/rls.ts` -- tenantTableStatements (migration convention), findTenantViolations, tablesOwnedBy
- `packages/db/src/ownership.ts` -- spine ownership map, findUnownedTables
- `packages/db/src/testing/cross-tenant.ts` -- harness registry and assertCrossTenantIsolation
- `packages/db/src/migrate.ts` -- runMigrations
- `packages/config/eslint.js` -- lint rule banning other ways to set the context
- `apps/api/src/worker/store-job.ts` -- storeScopedJob wraps a job handler in the job's store context

## Tasks & Acceptance

**Execution:** all files above, with tests in `packages/db/src/tenant/tenant-isolation.test.ts`, `packages/config/test/boundaries.test.ts`, `apps/api/src/worker/store-job.test.ts`.

**Acceptance Criteria:**
- Given migrations run, then slips_app exists, is not superuser, owns no tables, and a convention (tenantTableStatements + findTenantViolations) requires NOT NULL store_id, ENABLE and FORCE RLS, and a policy on current_setting('app.store_id') without missing_ok.
- Given code sets the store context other than through withStoreContext, then lint fails.
- Given a StoreScoped repository with no context, then it throws; a raw query with no context errors rather than returning rows (also after a prior context on the same pooled connection).
- Given a worker job with store_id, then storeScopedJob sets the context for that job only; no store_id fails the job.
- Given a table with no declared owner, then a test fails.
- Given the harness on a table with rows for stores A and B, then A cannot read, update, delete or move rows of B; a table without RLS fails the harness.

## Implementation Notes

- DECISION: store_id columns are `uuid`; withStoreContext rejects non-UUID ids and the policy casts `current_setting('app.store_id')::uuid` (an empty or unset setting errors, so it fails closed). `tenantTableStatements` accepts `storeIdType: 'text'` if an owner needs it.
- DECISION: the helper uses `select set_config('app.store_id', $1, true)`, which is SET LOCAL semantics with a bound parameter (SET LOCAL cannot take parameters). Lint bans `set_config`, `SET LOCAL/SESSION` and `SET/RESET app.` string literals outside `tenant/context.ts`.
- DECISION: roles are slips_app and slips_admin_ro, created NOLOGIN by migration; deployment grants login and passwords. Tests grant LOGIN to slips_app with a test password and revoke it afterwards.
- DECISION: the worker integration is `storeScopedJob(pool, handler)` in apps/api, composed inside `instrumentJob`; no real queue handler exists yet to wire it into.
- DECISION: the ownership map is the spine table verbatim; "infrastructure" (pg-boss) has no Drizzle tables.

## Review Triage Log

### 2026-10-11 -- Review pass (self-review; no subagent tool was available)
- verdicts: 3 findings -- high 0, medium 1, low 1, false 1, maybe-false 0
- findings:
  - `[medium]` `[defer]` Docker image may lack migrations / login grants -- see deferred list.
  - `[low]` `[defer]` Admin role unused and unaudited -- Epic 7.
  - `[false]` `[reject]` Policy on a pooled connection could leak a previous store -- set_config is transaction-local; test "does not leak" with pool max 1 proves it.

## Verification

**Commands:**
- `pnpm turbo run lint typecheck test build` -- expected: 26 tasks successful (clean checkout, dist removed)

## Auto Run Result

Status: done. Delivered the items in the Code Map. Verified: full turbo run passes on a clean tree against local Postgres 16 using the non-superuser slips_app role (20 db tests, 3 api job tests, 5 lint-rule tests); player CLS CI job build command also passes. Reviews were done by me, not subagents; the parent should run an independent review. Residual risk: only tested on Postgres 16 locally (CI uses 18).
