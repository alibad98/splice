---
title: 'Story 2.1: Import the full product catalog on first install'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '27ae54cd9d592e6bd79bac772e528ef4da5dd383'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - _bmad-output/planning-artifacts/epics.md#story-21-import-the-full-product-catalog-on-first-install
  - _bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md (AD-1, AD-2, AD-4, AD-14, AD-17, AD-18; Money and Availability conventions)
  - docs/spike-findings.md (G3: required options; G6: product webhook fixtures)
warnings: []
deferred:
  - summary: >-
      Task 1: record a real Salla `/admin/v2/products` page from the demo store and check the adapter mapping against it (sale price, with_tax/taxed_price, quantity/unlimited_quantity/is_available, images, embedded categories, options[].required, updated_at format).
    evidence: |-
      The G6 webhook recordings are no longer on disk and live store access was not available in this run. The mapping lives in apps/api/src/adapters/salla/salla-platform.ts (mapProduct); tests use documented-shape inputs only.
  - summary: >-
      Stores installed before this release have no catalog until a sync runs; Story 2.3 (manual sync) covers them.
    evidence: |-
      Only integration.store.installed / reinstalled queue catalog.full-sync.
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
- [ ] 1. Capture a real `/admin/v2/products` page from demo store 73897098 as a fixture (strip nothing secret; products are merchant data, no shopper PII). Confirm field names for sale price, tax-inclusive flag, quantity/unlimited, images, categories, options, `updated_at`. **Blocked: needs live demo-store access (the G6 recordings are no longer on disk). Deferred; mapping built from Salla's documented product resource with lenient parsing.**
- [x] 2. Money table and `toMinorUnits` in `contracts`, with tests.
- [x] 3. Migration + Drizzle schema + ownership entry + cross-tenant test.
- [x] 4. Port widening + Salla mapping + adapter tests (against documented-shape fixtures, not a recording; see Task 1).
- [x] 5. `catalog` module: sync job, repository, availability, service.
- [x] 6. Queue + event handler wiring, `catalog.sync.completed` in the catalogue.
- [x] 7. Composition tests for every row of the matrix.

**Acceptance Criteria:**
- Given an `integration.store.installed` event, when the worker consumes it, then a `catalog.full-sync` job imports every page and stores name, image, categories, price, sale price, `tax_inclusive`, currency, availability bucket and required-options flag (tested).
- Given stock 0, 1-5 or >5, then the bucket is out_of_stock, low or available (tested); prices are integer minor units with a currency code; every row has `(platform, external_id)` and `source_updated_at` (tested).
- Given a 429 or transient error, then the adapter paces and honours Retry-After, the job retries per AD-1, and a final failure sets state `failed` with a reason code readable through `CatalogService.getSyncState` (tested).
- Given the import needs a token, then it calls only `integration.getAccessToken(storeId)` (tested by a fake that asserts no refresh path is used).
- Given any plan or a non-`live` store, then product count is not limited and no billing data is read (asserted by module dependency check).
- Given the import finishes, then `last_synced_at` is recorded and `catalog.sync.completed` is emitted in the same transaction with created/updated counts (tested).
- `products` and `categories` have non-null `store_id`, RLS, and pass the cross-tenant test.

## Open Questions

- Salla product payload shape is unverified against a live store (Task 1, deferred). The adapter parses each product leniently; an unreadable product is skipped and counted, never stored.
- Category names: taken from the `categories[]` embedded in each product (no `/categories` call). Verify with the Task 1 fixture.
- Hidden/deleted products: resolved -- imported with `visible = false`; Story 2.5 owns deletion.
- Large catalogs: resolved -- one job that stores `next_page` in `catalog_sync_state`; a retry resumes.

## Spec Change Log

## Review Triage Log

### 2026-11-01 -- blind-hunter, edge-case-hunter, verification-gap (3 subagents)
Fixed in place as patches (no loopback: no root cause in the intent, and each fix is local to the diff).

- `[medium]` `[patch]` One malformed product (bad amount, unknown currency) failed the whole run as final (BH3, EC3, EC claim 2) -- now skipped and counted per product; the run fails `unknown_currency` only when every product on a page has it (the store's own currency).
- `[medium]` `[patch]` A retry of an older run could restart and take the row from a newer failed/succeeded run (BH1, EC2) -- runs are ordered by run id (UUIDv7 event id); an older run returns `superseded`.
- `[medium]` `[patch]` A second attempt of the same run (pg-boss re-delivers an expired job) could page alongside the first (EC1) -- throws retryable `RunBusyError` while the run wrote a page within 2 min.
- `[medium]` `[patch]` Default lifecycles wiring (catalog purge) untested (VG1) -- assertion added in integration.test.ts.
- `[medium]` `[patch]` Run superseded mid-sync and markFailed guard untested (VG4) -- tests added.
- `[low]` `[patch]` `StoreNotConnectedError` -> store_inactive untested (VG3) -- added to the it.each; invalid_data path now a per-product skip, tested.
- `[low]` `[patch]` Sale price rounding to the regular price stored as a fake discount (EC10) -- nulled when sale >= price in minor units.
- `[low]` `[patch]` Image URLs not restricted (BH8) -- only http(s) kept.
- `[low]` `[patch]` Currency with whitespace / status in another case (EC8, EC9) -- trimmed / lower-cased.
- `[low]` `[patch]` Deduplicated `boss.send` (null) not logged (EC16, BH7 part) -- logged.
- `[low]` `[patch]` "without leaking the body" test asserted nothing about the body (BH10) -- asserts the message.
- `[low]` `[patch]` `parseEventTime` called twice; mid-run superseded exit not logged (BH12 parts) -- fixed.
- `[low]` `[patch]` dev-platform `products.list` return type out of step with the port (VG other) -- uses `ProductPage`.
- `[medium]` `[defer]` Products/categories deleted in Salla are never removed by a full sync (BH2, EC12) -- Stories 2.5/2.6 own deletion and reconciliation.
- `[medium]` `[defer]` Page-number paging can skip/duplicate items when the catalog changes mid-sync (BH12, EC11) -- Story 2.6 daily reconcile.
- `[medium]` `[defer]` A run that exhausts retries stays failed with no resync; `failed` also shows between retries (BH6) -- Story 2.3 manual sync + UI.
- `[low]` `[defer]` Skipped-product count not persisted or surfaced (BH4) -- Story 2.3 UI.
- `[maybe-false]` `[defer]` Missing `pagination` on a multi-page response ends after page 1 (EC5) -- would be medium; settle with the Task 1 fixture.
- `[medium]` `[defer]` Worker boot wiring (`startWorker`) untested (VG2) -- pre-existing pattern; needs a `buildWorkerHandlers` extraction.
- `[false]` `[reject]` Rate limits burn job retries, Retry-After ignored (BH5) -- SallaHttp waits Retry-After in-process per store before throwing.
- `[false]` `[reject]` Purge between fetch and upsert recreates data (EC13) -- purge runs only after the 30-day grace of an uninstalled store; getAccessToken refuses non-active stores first.
- `[false]` `[reject]` Queue name literal can drift (BH11) -- the queue test asserts `QUEUES` contains `CATALOG_FULL_SYNC_QUEUE`.
- `[low]` `[reject]` Number amounts in exponent form (EC4), quantity beyond int4 (EC6), sale/price currency mismatch (EC7, BH9), unbounded categories delete (EC14), invalid job payload retried (EC15), stock_unreported per attempt (EC17), brittle AD-14 grep (BH12), tax default unlogged (BH9; already deferred with Task 1) -- unlikely in practice and the fix adds guards; now skipped per product where relevant.
- `[low]` `[reject]` Quick reinstall dropped by the 60 s singleton (BH7, EC16) -- the running install run imports the same catalog; now logged.

## Implementation Notes

- DECISION: Salla mapping (adapter only): `sale_price` counts only when > 0 and below `price`; `tax_inclusive` = `with_tax` when sent, else `taxed_price == price`, else true; stock is null for `unlimited_quantity`, 0 when `is_available` is false or `status` is `out`; image = `main_image`, then the main image, first image, thumbnail; an option counts as required unless `required: false` (the player then shows "View options", FR23); `updated_at` is read like webhook times (zone-less = Asia/Riyadh); `hidden`/`deleted` -> `visible = false`. All unverified until Task 1.
- DECISION: the port carries prices as decimal strings; `catalog` converts with `toMinorUnits` (contracts money table, no float math, half away from zero). An unknown currency fails the run as `unknown_currency` (final, no retry) rather than storing a guess.
- DECISION: `catalog_sync_state` (one row per store, added to `OWNERSHIP.catalog`) holds the run id, status, reason, `next_page` and counts. Each page is written in its own short store-context transaction under `SELECT ... FOR UPDATE` on that row; HTTP calls hold no transaction.
- DECISION: the run id is the triggering event id (UUIDv7, time-ordered). Same run again: `already_succeeded`, or resume from `next_page` after a failure; if that run wrote a page within 2 min, `RunBusyError` (retryable) instead. A run older than the stored one: `superseded`. A newer run while another is `running` and touched within 15 min: `superseded` (skipped); older than that: replaced.
- DECISION (review): a product with an unknown currency or an unreadable/negative amount is skipped and counted (logged per page); the run fails `unknown_currency` only when every product on a page has an unknown currency.
- DECISION: pg-boss gives the handler no attempt number, so every retryable failure (platform unavailable, unexpected error) marks the run `failed` with its reason and rethrows; the next attempt sets it back to `running`. After the last attempt the state stays `failed`. Final failures (`auth_rejected`, `store_inactive`, `unknown_currency`, `invalid_data`) return without a retry.
- DECISION: the install/reinstall handler enqueues `catalog.full-sync` on pg-boss's own connection (singleton per store, 60 s), not on the delivery transaction: the app role may insert only into the event queue's table. A send repeated by a retried delivery reuses the same run id, so it is harmless.
- DECISION: no foreign key from catalog tables to `stores` (AD-2: no cross-module cascades); catalog data is removed by `catalogStoreData.purge` (batched products, then categories and sync state), registered before `integration` in the store lifecycle. Nothing is suspended on uninstall: a reinstall resyncs anyway.
- DECISION: products repeated on one page are de-duplicated before the upsert (last wins), since one `ON CONFLICT DO UPDATE` statement may not touch a row twice. Category ids are kept on the product as `category_external_ids text[]`; names are in `categories`.
- NOTE: stores installed before this deploy have no catalog until a sync is triggered (manual sync is Story 2.3).

## Verification

**Commands:**
- `pnpm turbo run lint typecheck test build --continue` -- result: 25/26 tasks succeeded against Postgres 18 in Docker. Only `@slips/player#build` fails, from an existing Windows-only path bug in `packages/player/scripts/check-size.mjs` (`D:\D:\...`), not touched by this story; CI runs on Linux.
- Local note: a native Postgres holds 127.0.0.1:5433 on this machine, so the live tests ran against a throwaway container on 5436 with the test URLs pointed there temporarily (restored afterwards). New catalog tests: 15 composition, 7 schema, 5 adapter mapping, 3 money, 1 event contract.

## Auto Run Result
