---
title: 'Story 2.1: Import the full product catalog on first install'
type: 'feature'
created: '2026-11-01'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/planning-artifacts/epics.md#story-21-import-the-full-product-catalog-on-first-install
  - _bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md (AD-1, AD-2, AD-4, AD-14, AD-17, AD-18; Money and Availability conventions)
  - docs/spike-findings.md (G3: required options; G6: product webhook fixtures)
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** A store can be installed, but Slips knows nothing about its products. Every later epic (product picker, manifest, product card, attribution) needs a local, store-scoped copy of the catalog.

**Approach:** A new `catalog` module. It consumes `integration.store.installed` (and `integration.store.reinstalled`), queues one `catalog.full-sync` job per store on the batch queue, pages through `CommercePlatform.products.list` with a token from `integration.getAccessToken`, upserts `products` and `categories` keyed by `(store_id, platform, external_id)`, records sync state, and emits `catalog.sync.completed` through the outbox.

## Boundaries & Constraints

**Always:** Tables owned by `catalog` (already declared in `OWNERSHIP`), each with non-null `store_id`, RLS and a cross-tenant test. Prices are integer minor units plus an ISO 4217 code, using the exponent table in `contracts`; stored with `tax_inclusive`. Availability bucket is computed once in `catalog` (0 = out_of_stock, 1-5 = low, >5 = available). Every row has `platform`, `external_id` and `source_updated_at`. Salla field names exist only in `adapters/salla`. Tokens come only from `integration.getAccessToken(storeId)`. Retries use the AD-1 batch policy; the adapter keeps its per-store pacing and Retry-After handling. Events go out through `publishEvent` in the same transaction as the state change.

**Never:** Refresh tokens in `catalog`; read billing or plan entitlements (AD-14, product count is unlimited); touch another module's tables; let a client recompute availability; store floats for money.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| First install | `integration.store.installed` | one `catalog.full-sync` job, all pages imported, state `succeeded`, `last_synced_at` set, event with created/updated counts | — |
| Re-delivered install event | same event twice | one job running (singleton key per store), upserts are idempotent | second job no-ops or dedupes |
| Reinstall | `integration.store.reinstalled` | full sync runs again; existing rows updated, not duplicated | — |
| Stock buckets | stock 0 / 3 / 6 / unlimited | out_of_stock / low / available / available | unknown stock → available + logged |
| Money | SAR 12.50, KWD 1.250 | 1250 SAR, 1250 KWD (exponent from table) | unknown currency → job fails with reason `unknown_currency` |
| 429 / 5xx | adapter throws `PlatformUnavailableError` | job retried per AD-1 (5 attempts, 30 s → 15 min) | after last attempt: state `failed`, reason `platform_unavailable` |
| Token rejected | `PlatformAuthRejectedError` / store not active | no retry | state `failed`, reason `auth_rejected` or `store_inactive` |
| Store uninstalled mid-sync | state changes between pages | job stops at next page check | state `failed`, reason `store_inactive` |

</intent-contract>

## Code Map

- `packages/db/migrations/0012_catalog.sql`, `packages/db/src/schema/catalog.ts` -- `categories`, `products`, `catalog_sync_state` (one row per store: status, reason, started_at, last_synced_at, counts). Add `catalog_sync_state` to `OWNERSHIP.catalog`. RLS + grants like 0004/0008.
- `packages/contracts/src/v1/money.ts` -- ISO 4217 exponent table and `toMinorUnits(amount, currency)` (decimal-safe, no float multiply).
- `packages/contracts/src/v1/events.ts` -- `catalog.sync.completed` (owner `catalog`): `store_id`, `created`, `updated`, `finished_at`.
- `apps/api/src/ports/commerce-platform.ts` -- widen `CanonicalProduct`: `imageUrl`, `categoryExternalIds`, `price` and `salePrice` as decimal strings, `taxInclusive`, `currency`, `stock` (number | null for unlimited), `hasRequiredOptions`, `sourceUpdatedAt`; add `categories.list` if Salla does not embed category names.
- `apps/api/src/adapters/salla/salla-platform.ts` (+ `salla.test.ts`) -- map the real `/products` fields; recorded fixture from the demo store.
- `apps/api/src/modules/catalog/` -- `catalog.module.ts`, `catalog.repository.ts` (store-scoped upserts), `catalog-sync.ts` (the job), `availability.ts`, `catalog.service.ts` (`getSyncState(storeId)` for Story 2.3 UI).
- `apps/api/src/worker/queues.ts`, `worker.ts` -- register `catalog.full-sync` (batch group) and event handlers for installed/reinstalled.
- `apps/api/src/composition/catalog.test.ts` -- live Postgres tests with a fake `CommercePlatform`.

## Tasks & Acceptance

**Execution:**
1. Capture a real `/admin/v2/products` page from demo store 73897098 as a fixture (strip nothing secret; products are merchant data, no shopper PII). Confirm field names for sale price, tax-inclusive flag, quantity/unlimited, images, categories, options, `updated_at`.
2. Money table and `toMinorUnits` in `contracts`, with tests.
3. Migration + Drizzle schema + ownership entry + cross-tenant test.
4. Port widening + Salla mapping + adapter tests against the fixture.
5. `catalog` module: sync job, repository, availability, service.
6. Queue + event handler wiring, `catalog.sync.completed` in the catalogue.
7. Composition tests for every row of the matrix.

**Acceptance Criteria:**
- Given an `integration.store.installed` event, when the worker consumes it, then a `catalog.full-sync` job imports every page and stores name, image, categories, price, sale price, `tax_inclusive`, currency, availability bucket and required-options flag (tested).
- Given stock 0, 1-5 or >5, then the bucket is out_of_stock, low or available (tested); prices are integer minor units with a currency code; every row has `(platform, external_id)` and `source_updated_at` (tested).
- Given a 429 or transient error, then the adapter paces and honours Retry-After, the job retries per AD-1, and a final failure sets state `failed` with a reason code readable through `CatalogService.getSyncState` (tested).
- Given the import needs a token, then it calls only `integration.getAccessToken(storeId)` (tested by a fake that asserts no refresh path is used).
- Given any plan or a non-`live` store, then product count is not limited and no billing data is read (asserted by module dependency check).
- Given the import finishes, then `last_synced_at` is recorded and `catalog.sync.completed` is emitted in the same transaction with created/updated counts (tested).
- `products` and `categories` have non-null `store_id`, RLS, and pass the cross-tenant test.

## Open Questions

- Salla product payload shape is unverified: no product fixture is in the repo yet (spike G6 recorded product *webhook* events; check whether those include the full product). Task 1 resolves this before coding the mapping.
- Category names: does `/products` embed categories, or is a separate `/categories` call needed? Decide in Task 1.
- Should a product with `status` hidden/deleted in Salla be imported? Default: import with a `visible` flag; Story 2.5 owns deletion.
- Large catalogs: one job for all pages vs. a resumable cursor. Default: one job that stores `next_page` in `catalog_sync_state` so a retry resumes rather than restarting.

## Spec Change Log

## Review Triage Log

## Implementation Notes

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm turbo run lint typecheck test build` -- expected: all tasks pass against local Postgres 16.

## Auto Run Result
