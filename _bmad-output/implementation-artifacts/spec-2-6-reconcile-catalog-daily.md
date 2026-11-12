---
title: 'Story 2.6: reconcile the catalog daily'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_revision: '4ff8e70d641cf18052bcd51ff9fc50fcf023f240'
baseline_commit: '4ff8e70d641cf18052bcd51ff9fc50fcf023f240'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-5-handle-deleted-products.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Missed webhooks, offset-paging misses in the full sync, and deletions Salla never announced leave wrong, missing or ghost products in Slips. Nothing repairs them, and a product tombstoned by a false 404 (or not revived by the full sync) stays hidden for good (Story 2.5 residual risk).

**Approach:** A daily cron fan-out queues one `catalog.reconcile` job per `active` store. Each job lists every Salla product page and applies it through Story 2.4's guarded write path with its event rules: create, update, revive tombstoned products Salla still has, count unchanged rows. Local live products absent from the listing are confirmed one by one with `products.get`, and only a "not found" answer tombstones them via Story 2.5's `deleteProducts`. The job then logs and meters the counts and moves the store's last sync time forward.

## Boundaries & Constraints

**Always:**
- Writes run per page in `withStoreContext`, under `lockProductWrites()`, categories before products, events through `publishEvent` in the same transaction. `catalog.product.updated` is emitted only for changed visible fields (a revival lists every visible field), and `catalog.product.deleted` only via `deleteProducts` with source `reconcile`.
- Stale writes (stored copy newer) are skipped and counted in `slips_catalog_stale_writes_total{source="reconcile"}`.
- A tombstoned product that appears in a listing fetched at `fetchedAt > deleted_at` is revived. It is written with `source_updated_at = max(product time, fetchedAt)`.
- Absence never tombstones by itself: a candidate is tombstoned only when `products.get` returns null (observedAt = that answer's time). A candidate that `get` returns is written like a listed product. Ids of products the adapter could not read count as present.
- One job per store per UTC day (singleton key `<store_id>:<yyyy-mm-dd>`), started at a fixed per-store offset (hash of the store id, 0–3599 s) after the 00:00 UTC cron, so the same store runs 24 h apart. Each job gets its own `trace_id`.
- At job time a store that is not connected (`StoreDisconnectedError`/`StoreNotConnectedError`) is skipped with a log line (reason `disconnected`) and no retry. The fan-out lists only `active` stores.
- Batch-queue default retry policy. A failed attempt restarts from page 1 (idempotent writes). After the last attempt the job dead-letters and an alert rule fires on `slips_dead_letter_depth{queue="catalog.reconcile"} > 0`, with a runbook.
- On success: one `catalog reconcile finished` log line with `created`, `updated`, `deleted`, `unchanged`, `stale`, `skipped` (store_id and trace_id come from the job context), and `slips_catalog_reconcile_products_total{outcome}` counted by outcome (created|updated|deleted|unchanged). The last sync time is set to the finish time. If the store has no sync-state row yet, insert one as `succeeded` with run id = a new UUIDv7. Otherwise set only `last_synced_at`, never status, run id or `updated_at`.

**Never:** Change full-sync behaviour, its run state machine, `catalog.sync.completed`, the inbox, or webhook handling (beyond the shared `applyProduct` changes below). Add dashboard UI. Reconcile a disconnected store (Story 2.7). Delete rows or categories. Read billing data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missing | Salla has product P, no local row | row created; counted `created`; no event | — |
| Differs | price/stock changed in Salla, webhook missed | row updated; `catalog.product.updated` with the changed visible fields | — |
| Non-visible diff | only stock within the same bucket / category list differs | row updated; counted `updated`; no event | — |
| Unchanged | listing equals stored row | no write; counted `unchanged` | — |
| Stale | stored `source_updated_at` newer than listing | skipped; stale metric +1 (`reconcile`) | — |
| Absent, gone | live local P not listed, `get` → null | tombstoned; `catalog.product.deleted`; counted `deleted` | — |
| Absent, exists | live local P not listed (paging drift), `get` returns it | written like a listed product; not deleted | — |
| Revive | tombstoned P listed, fetched after `deleted_at` | `deleted_at` cleared; `catalog.product.updated` with all visible fields; counted `updated` | — |
| Unreadable | listing item unreadable, id readable | not written, not a deletion candidate; counted `skipped` | — |
| Disconnected | store `disconnected`/`uninstalled` at job time | nothing fetched or written; skip log | no retry |
| Outage | `list`/`get` throws `PlatformUnavailableError` | attempt fails; retried; last attempt logs warn | dead-letter → alert |
| Never synced | no sync-state row | catalog imported; row inserted `succeeded` with `last_synced_at` | — |

</frozen-after-approval>

## Code Map

- `packages/db/migrations/0015_active_store_ids.sql` (new) + `meta/_journal.json` (idx 15, `when` after 1761350400000) -- `active_store_ids(p_after uuid, p_limit int) RETURNS SETOF uuid`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, `lifecycle_state = 'active' AND id > coalesce(p_after, nil uuid) ORDER BY id LIMIT p_limit`. `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO slips_app`. Same pattern as `locate_store` in 0005. Hand-written like 0014.
- `apps/api/src/modules/integration/integration.service.ts` (~line 172, next to `locate`) -- `activeStoreIds(after: string | null, limit: number): Promise<string[]>`.
- `apps/api/src/ports/commerce-platform.ts:61` -- `ProductPage.skippedExternalIds?: string[]`. `adapters/salla/salla-platform.ts:296`: for an unreadable item, `SallaId.safeParse(raw?.id)` and push the id when readable. `salla.test.ts` covers it.
- `apps/api/src/modules/catalog/catalog.repository.ts` -- `applyProduct(row, opts?: { observedAt?: Date })`: also select `categoryExternalIds`, `currency`, `taxInclusive`, `stock`. New outcome `'unchanged'` when a live row equals the write on every stored field (no write). Tombstone revival also when `opts.observedAt > deletedAt`, writing `sourceUpdatedAt = max(row.sourceUpdatedAt, observedAt)` via `upsertGuarded(..., { restore: true })`. New `liveExternalIds(platform): Promise<string[]>` (not deleted). New `touchLastSynced(at, runId)`: insert `succeeded` row if absent, else update `last_synced_at` only.
- `apps/api/src/modules/catalog/catalog-reconcile.ts` (new) -- `CATALOG_RECONCILE_QUEUE = 'catalog.reconcile'`, `CATALOG_RECONCILE_SCHEDULE_QUEUE = 'catalog.reconcile.schedule'`, `RECONCILE_CRON = '0 0 * * *'`, `ReconcileJob = JobMeta.extend({ store_id: z.uuid() })`, `reconcileOffsetSeconds(storeId)`. Class `CatalogReconcile(pool, platform, tokens, telemetry, events, now)` with `run(storeId, { finalAttempt })`. Mirror `CatalogSync.importPages` (token per page, `toProductWrites`, `MAX_PAGES`, unknown-currency handling) but write with `applyProduct` per product. Collect seen ids, then handle absent candidates in batches of 100 (one transaction per batch under the lock). Reuse `deleteProducts` from `product-deletions.ts`.
- `apps/api/src/worker/catalog-jobs.ts` -- `catalogJobHandlers(sync, reconcile, integration, boss, telemetry)`. The schedule handler pages `activeStoreIds` (500 per page) and sends `catalog.reconcile` with `{ v:1, trace_id: random hex, store_id }`, `singletonKey`, `singletonSeconds: 86400`, `startAfter: offset`. The reconcile handler parses the job and calls `run` with `isFinalAttempt(meta)`.
- `apps/api/src/worker/queues.ts` -- add both queues to `batch`. `worker/worker.ts:128` -- build `CatalogReconcile`, pass the new deps, and `boss.schedule(CATALOG_RECONCILE_SCHEDULE_QUEUE, RECONCILE_CRON, { v: 1, trace_id: 'schedule' })` when selected (like the sweep).
- `apps/api/src/ports/telemetry.ts`, `adapters/telemetry/pino-telemetry.ts:47` -- `Metric.CatalogReconcileProducts = 'slips_catalog_reconcile_products_total'`, declared with the 4 outcome labels. Update the `CatalogStaleWrites` doc comment to include `reconcile`.
- `ops/alert-rules.json` + `docs/runbooks/alert-catalog-reconcile-dead-letter.md` (new) -- rule `catalog-reconcile-dead-lettered`, severity `ticket`, owner `catalog-owner`. `apps/api/src/ops/alert-rules.test.ts` checks the runbook exists.
- Tests: `apps/api/src/composition/catalog-reconcile.test.ts` (new) -- live DB. Copy setup from `composition/catalog.test.ts` (its `FakePlatform`, `product()`, role and pgboss schema pattern; use a new schema/role name), and add a `get` map to the fake.
- Do not change: `CatalogSync`, `upsertProducts`, `tombstoneProducts`, the webhook inbox, `catalog.sync.completed`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/migrations/0015_active_store_ids.sql`, `meta/_journal.json` -- cross-store active list -- fan-out without bypassing RLS elsewhere.
- [x] `modules/integration/integration.service.ts` -- `activeStoreIds` -- the only way catalog learns store ids.
- [x] `ports/commerce-platform.ts`, `adapters/salla/salla-platform.ts`, `salla.test.ts` -- `skippedExternalIds` -- unreadable products are never deletion candidates.
- [x] `modules/catalog/catalog.repository.ts` -- `unchanged`, observed-time revival, `liveExternalIds`, `touchLastSynced` -- shared guarded writes.
- [x] `modules/catalog/catalog-reconcile.ts` -- the job -- the matrix behaviour.
- [x] `worker/catalog-jobs.ts`, `queues.ts`, `worker.ts` -- fan-out, handler, cron -- daily per active store.
- [x] `ports/telemetry.ts`, `pino-telemetry.ts`, `ops/alert-rules.json`, runbook -- metric and alert.
- [x] `composition/catalog-reconcile.test.ts` (+ existing webhook/catalog tests if `unchanged` changes an asserted outcome) -- one test per matrix row. Also: the fan-out sends one job per active store only (disconnected/uninstalled skipped) with distinct trace ids and the day-keyed singleton; one store failing does not stop the next store's job; a rolled-back page leaves no event; queue policy assertion.

**Acceptance Criteria:**
- Given two active stores and one disconnected store, when the schedule job runs, then exactly two `catalog.reconcile` jobs are queued, and running it again the same UTC day queues none.
- Given a reconcile that finishes, when the log is read, then one `catalog reconcile finished` line carries the counts, `store_id` and `trace_id`, and `GET /v1/catalog/sync` shows the new last sync time.
- Given `pnpm turbo run lint typecheck test build`, then everything passes.

## Implementation Notes

- `unchanged` compares every written field including `source_updated_at`. A listing with equal data but a newer time is still written (counted `updated`, no event), so the ordering stamp moves forward and an older out-of-order webhook stays stale. Products without a Salla `updated_at` get the listing time, so they count `updated` on each run.
- The fan-out sends `startAfter` as an absolute time (`00:00 UTC + offset`), not seconds from send time, so a late fan-out keeps each store's run 24 h apart.
- Only a disconnected or not-connected store skips. Every other error (auth rejected, more than `MAX_PAGES` pages, a database error) is retried and then dead-lettered. A listing page where every product has an unknown currency counts them `skipped` instead of failing, because listed ids are never deletion candidates.
- `deleteProducts` runs once per confirmed id inside the batch transaction, so each deletion uses the time of its own `get` answer.

## Spec Change Log

## Review Triage Log

### 2026-11-03 — Review pass

- verdicts: 30 findings — high 0, medium 3, low 21, false 3, maybe-false 3
- findings:
  - `[medium]` `[patch]` (blind, edge) The listing/found time is taken after the platform answers. A delete webhook applied while the request is in flight (deleted_at < response time) is revived as a ghost for up to a day, with `catalog.product.updated`. Fix: use the request start time.
  - `[medium]` `[patch]` (blind) Same cause: the fallback source time for products without `updated_at` is the response time, so a webhook newer than the request start loses as stale. Grouped with the row above.
  - `[medium]` `[patch]` (edge) pg-boss 12.37's default 15-minute job expiry, plus restarting from page 1, means a large store's reconcile can expire on every attempt (overlapping runs) and dead-letter daily. Fix: a job-level `expireInSeconds` on send.
  - `[medium]` `[patch]` (blind, edge) A dead-lettered `catalog.reconcile.schedule` (no store reconciled that day) fires no alert. Fix: widen the rule to `catalog\.reconcile.*`.
  - `[low]` `[patch]` (blind, edge) `touchLastSynced` sets `last_synced_at` unconditionally, so a full sync that finished later can be moved backwards by seconds. `run()` reads the clock twice. Both fixes are direct.
  - `[low]` `[patch]` (edge) `deleteProducts` `alreadyDeleted` results (a webhook tombstoned the product between listing and batch) are dropped from the counts.
  - `[low]` `[patch]` (blind) The runbook replay step gives no way to follow it.
  - `[low]` `[patch]` (verification-gap) "Unchanged" is never tested with the same source time and differing non-price fields. Dropping the stock or category comparison would pass.
  - `[low]` `[patch]` (verification-gap, blind) `fanOutReconcile` never pages past one page in tests.
  - `[low]` `[patch]` (verification-gap) The reconcile handler's `finalAttempt` wiring is untested. The runbook's last-attempt warning depends on it.
  - `[maybe-false]` `[defer]` (verification-gap) The daily cron registration in `startWorker` is untested. No worker-startup harness exists (the sweep cron is untested the same way). Deferred.
  - `[maybe-false]` `[defer]` (blind, edge) A truncated listing makes most products candidates: unbounded sequential `get` calls, and a mass tombstone if `get` answered 404 systemically. Unverified whether Salla's 404 can be systemic (Story 2.5 deferred). Medium if true; deferred with a candidate-cap idea.
  - `[maybe-false]` `[defer]` (edge) Grouped with the row above (unbounded confirmations restart from page 1 on one rate-limit failure).
  - `[low]` `[reject]` (verification-gap) A revived product is stored at listing time, so later reconciles count it stale until Salla bumps `updated_at`. This follows the frozen `max(product time, fetchedAt)` rule; the fix would edit the spec.
  - `[low]` `[reject]` (verification-gap) A Salla clock behind ours could drop a change made just after a revival. Needs a skewed clock and an edit within seconds of the revival, under the same frozen rule.
  - `[low]` `[reject]` (blind) Revivals are counted as `updated`, not a separate outcome. The frozen matrix counts a revival as `updated`, and the `restored` log/event still identifies them.
  - `[low]` `[reject]` (blind) The finished line lacks pages, `get` calls and duration. Job duration is already logged by `instrumentJob`; the rest is nice-to-have with no named harm.
  - `[low]` `[reject]` (blind) The webhook path now logs `unchanged` for an identical redelivery under a new event id, with no webhook test. The behaviour is correct (no write, no event), and the outcome is only a log value.
  - `[low]` `[reject]` (blind) A different category order counts as `updated` and rewrites daily. Salla's order is stable, and sorting would change which category is shown first.
  - `[low]` `[reject]` (blind) Category rows are rewritten every run. This matches the full sync's existing behaviour, at negligible cost.
  - `[low]` `[reject]` (blind) A disconnect mid-run leaves its committed pages uncounted. This is rare, and reporting partial counts adds branching.
  - `[low]` `[reject]` (blind) `MAX_PAGES`, day-boundary and late fan-out paths are untested. Low-value edge tests.
  - `[low]` `[reject]` (edge) A late fan-out sets `startAfter` in the past, so jobs start at once. That only happens when the cron itself is late, and starting at once is the right recovery.
  - `[low]` `[reject]` (blind) The RLS assertion `catch(() => ({ rowCount: 0 }))` passes on error. Under fail-closed RLS the unset `app.store_id` raises, and either outcome means the app role cannot list stores directly.
  - `[false]` `[reject]` (blind) The new test hardcodes port 5433. Every live test in the repo does; it is the CI convention.
  - `[low]` `[reject]` (blind) `active_store_ids` is executable by `slips_app`, which the API also uses. It returns ids only (like `locate_store`), and per-role separation is pre-existing role design.
  - `[false]` `[reject]` (blind) `p_limit` NULL returns every row. The only caller always passes 500, so NULL is unreachable.
  - `[false]` `[reject]` (blind) sprint-status says `in-progress` while the spec says `in-review`. Sprint status is synced at the end of the workflow by design.
  - `[low]` `[reject]` (blind) The webhook change has no Spec Change Log entry. The change log records review loopbacks only; the `unchanged` outcome is in the Code Map.
  - `[low]` `[reject]` (edge) A candidate that turns `unknown` (purged between listing and batch) goes uncounted. A purge cannot run while the store is active.

## Design Notes

- Confirm-before-delete: offset paging can shift while products are added or removed during a listing, so "not listed" is weak evidence. `products.get` → null is the same evidence Story 2.5 uses for a 404. The cost is one call per candidate, which is rare outside mass deletions.
- Revival uses listing time because a false-404 tombstone keeps Salla's older `updated_at`, and a strictly-newer-time rule would never revive it (Story 2.5 residual risk).
- Retries restart from page 1 instead of persisting a cursor. Reconcile is daily and idempotent, and keeping the seen-id set in memory avoids a new table.

## Verification

**Commands:**
- `pnpm -C apps/api exec vitest run src/composition/catalog-reconcile.test.ts src/composition/catalog.test.ts src/composition/product-webhooks.test.ts src/adapters src/worker src/ops` -- expected: pass (live DB; locally use the Docker DB on 5436 per the port-conflict note).
- `pnpm turbo run lint typecheck test build` -- expected: pass (`@slips/player#build` fails on Windows only, a known issue).


### Pilot review closeout — 2026-11-11

Closed: current catalog/reconcile/webhook tests pass, including guarded writes, logs/metrics, retries and alerts; new worker startup coverage pins reconcile/sweep cron registration and all catalogued event handlers.

Actual shared verification: API 677, dashboard 367, contracts 92, DB 62, UI 102 and player 62 unit tests passed; dashboard 16 and player 33 browser tests passed. All 26 repository lint/typecheck/test/build tasks succeeded. See [review-gap closeout](review-gap-closeout-2026-11-11.md) for commands, environment, initial failures, cache use and remaining acceptance/launch gates. These are executed results; older expected-only commands above remain historical.
