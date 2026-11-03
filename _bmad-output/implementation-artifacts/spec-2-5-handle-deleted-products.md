---
title: 'Story 2.5: handle products deleted in Salla'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_revision: '04eff5d5fe7e37faf5b09c70681b8a52175b66fb'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-4-apply-product-webhooks.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A Salla product whose status is `deleted` (in a product webhook or a sync page) is mapped to hidden (`visible: false`), not tombstoned, so no `catalog.product.deleted` is emitted.
    evidence: |-
      `HIDDEN_STATUSES = new Set(['hidden', 'deleted'])` in salla-platform.ts. Hidden products already leave the list and emit `catalog.product.updated` with `changed: ['visible']`, but content would not get the "Linked product deleted" flag. Unverified whether Salla ever reports a live product with status `deleted` (trash) instead of sending `product.deleted`; settle by recording a real deletion and a trash/restore on the demo store with the webhook recorder.
    location: >-
      apps/api/src/adapters/salla/salla-platform.ts:152
    severity: medium (unverified)
  - summary: >-
      The `product.deleted` event name and data shape, and the 404 answer of `GET /products/<id>` for a deleted product, are unverified against a live Salla store.
    evidence: |-
      Taken from the docs and covered only with mocked HTTP. If Salla names the event differently it is stored as `other` and ignored (reconciliation in Story 2.6 repairs); if a deleted product's fetch answers something other than 404, the fetch path keeps retrying into dead-letter as before. Settle with the webhook recorder on the demo store.
    location: >-
      apps/api/src/adapters/salla/salla-endpoints.ts:52
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** When a merchant deletes a product in Salla, Slips keeps showing it as a live, in-stock product: `product.deleted` webhooks are ignored, the full sync only upserts, and a webhook fetch that gets a 404 retries until it is dead-lettered (deferred from Story 2.4). Content could then keep selling something that no longer exists.

**Approach:** Add a `deleted_at` tombstone on `products`. One reusable catalog deletion function tombstones products by external id under the store's product lock, guarded on `source_updated_at`, and emits `catalog.product.deleted` in the same transaction. The `product.deleted` webhook and a 404 on the product fetch both call it, and Story 2.6 reconciliation will call it for products absent from Salla. A later create/update webhook for the same external id clears the tombstone and emits `catalog.product.updated`. Deleted products are excluded from the products list.

## Boundaries & Constraints

**Always:**
- Soft delete only: set `deleted_at`, never `DELETE` the row, never a cascading FK delete.
- Reuse Story 2.4's write path: `withStoreContext`, `lockProductWrites()` (`catalog-product:<storeId>`), categories-then-product lock order, events via `publishEvent` in the same transaction. Keep the inbox order (verify, parse, store, 200), the dedup and the retry/dead-letter timings unchanged.
- Ordering: a deletion observed at time `at` applies when `at >= stored source_updated_at` (ties go to the deletion) and sets `deleted_at = at` and `source_updated_at = at`. An older deletion is skipped and counted in `slips_catalog_stale_writes_total{source}`.
- A tombstoned row is revived only by a write whose `source_updated_at` is strictly newer than the stored one, so a same-second update delivered after the delete never resurrects it.
- `catalog.product.deleted` is emitted only on the live-to-deleted transition: a repeated delete, a delete of an unknown external id, and a stale delete emit nothing and do not throw.
- The canonical deleted payload is allow-listed: `{ event, kind: 'product', product_id, deleted: true }`. Salla names stay in `adapters/salla`.
- The deletion function takes the caller's transaction and a list of external ids so Story 2.6 can batch it; it requires the caller to hold the product lock.

**Never:** Change the full sync to delete, revive or emit events (it leaves `deleted_at` untouched; reconciliation in 2.6 handles absence and revival). Add the reconcile job, a new queue, or dashboard UI changes. Add an "include deleted" API option. Delete or hide categories. Handle disconnected-store fetches (Story 2.7). Refresh tokens in catalog.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete | signed `product.deleted` for a live stored product, event time ≥ stored time | `deleted_at` set; `catalog.product.deleted` `{v:1, store_id, product_id, external_id}`; inbox `processed`; product gone from `GET /v1/products` | — |
| Repeat delete | second `product.deleted` (different body) for an already deleted product | no change, no event; inbox `processed` | — |
| Unknown product | `product.deleted` for an external id never stored | nothing written, no event; inbox `processed` | — |
| Stale delete | delete event time older than stored `source_updated_at` | row stays live; stale metric +1 (`source: webhook`) | — |
| Late update | `product.updated` with `updated_at` ≤ the deletion time arrives after the delete | row stays deleted; stale metric +1; no event | — |
| Recreate | `product.created`/`updated` for a deleted external id, strictly newer | `deleted_at` cleared, fields written; `catalog.product.updated` with every visible field in `changed`; product listed again | — |
| Fetch 404 | product webhook needs a fetch and `GET /products/<id>` answers 404 | treated as a deletion observed at fetch time (same function, same event rules); inbox `processed` | — |
| No id | `product.deleted` without a readable id | payload `invalid: true` | dead-letter at once (`invalid_payload`) |
| Full sync | sync page contains a tombstoned product | fields updated by the guard, `deleted_at` untouched, no event | — |

</intent-contract>

## Code Map

- `packages/db/src/schema/catalog.ts` -- `products`: add nullable `deletedAt: ts('deleted_at')`.
- `packages/db/migrations/0014_product_tombstones.sql` (new) + `meta/_journal.json` (idx 14, `when` after 1761264000000) -- `ALTER TABLE products ADD COLUMN deleted_at timestamptz`. Hand-written like 0013 (no snapshots exist). RLS and grants are table-level, already in 0012.
- `packages/contracts/src/v1/events.ts` (+ `events.test.ts`) -- `catalog.product.deleted` owned by `catalog`: `v: 1`, `store_id`, `product_id` (uuid), `external_id`. Document consumers (content Story 3.4, publishing Epic 4) and that they dedupe on event id.
- `apps/api/src/adapters/salla/salla-endpoints.ts` -- `SALLA_PRODUCT_DELETED_EVENT = 'product.deleted'` (fix the "Story 2.5" comment).
- `apps/api/src/adapters/salla/salla-platform.ts` -- `parseWebhook` (~line 356): `product.deleted` maps to kind `product` with payload `{ event, kind, product_id, deleted: true }` (no product mapping); no readable id → `invalid: true`. `products.get` (~line 300): a 404 returns `null`. `admin()` (~line 415) currently throws `PlatformUnavailableError` on any non-ok; add a way for `get` to see a 404 without changing `list`/`orders`.
- `apps/api/src/ports/commerce-platform.ts:155` -- `products.get(...)`: `Promise<CanonicalProduct | null>`, null = the platform says it does not exist. Update `adapters/salla/dev-platform.ts` and `adapters/salla/index.ts` stubs to match.
- `apps/api/src/modules/integration/webhook-inbox.ts:94` -- `needsFetch` must be false when `payload.deleted === true` (a delete needs no platform call, so it is processed inline).
- `apps/api/src/modules/catalog/catalog.repository.ts` -- `applyProduct`: select `deletedAt` too; a tombstoned row with `row.sourceUpdatedAt <= existing` is `stale`; a strictly newer one is outcome `'restored'` with `changed` = all `PRODUCT_VISIBLE_FIELDS`, and the upsert clears `deleted_at` (only on this path: `upsertGuarded` takes an option, so `upsertProducts` from the full sync never touches `deleted_at`). New `tombstoneProducts(platform, externalIds, at)`: `select … for update` by external ids, then update the live, not-newer ones; returns per id `{ outcome: 'deleted' | 'already_deleted' | 'stale' | 'unknown', productId? }`. `CatalogReadRepository.where` (~line 213): add `isNull(products.deletedAt)`.
- `apps/api/src/modules/catalog/product-deletions.ts` (new) -- the reusable entry point for 2.5 and 2.6: `deleteProducts(tx, deps: { events, telemetry }, input: { storeId, platform, externalIds, observedAt, source: 'webhook' | 'reconcile' })` → `{ deleted, alreadyDeleted, stale, unknown }`. Caller holds `lockProductWrites()` inside `withStoreContext`. Calls `tombstoneProducts`, publishes one `catalog.product.deleted` per newly deleted product, counts stale skips in `Metric.CatalogStaleWrites` with the `source` label (declare the `{ source: 'reconcile' }` label next to `webhook` and `sync` in `adapters/telemetry/pino-telemetry.ts:47`), logs `product deleted` with `store_id`, `external_id`, `source`.
- `apps/api/src/modules/catalog/product-webhooks.ts` -- `handle()`: if `payload.deleted === true`, run `deleteProducts` under the lock with `observedAt = occurredAt ?? now`, source `webhook`. In `canonical()`, a `null` from `products.get` means deleted: run the same path with `observedAt = now`. Restored products publish `catalog.product.updated` like any change. Update the header comment.
- `apps/api/src/worker/catalog-jobs.ts:49` -- add a logging handler for `catalog.product.deleted` (the dispatcher requires one), like `catalog.product.updated`.
- `apps/api/src/composition/product-webhooks.test.ts` -- live-DB tests via signed `POST /v1/webhooks/salla`; reuse its `hook`, `post`, `sallaProduct`, `productAnswer` (the fetch mock needs a 404 option). `composition/catalog.test.ts:519` -- list exclusion test pattern for `GET /v1/products`.
- Do not change: `CatalogSync` behaviour, the `catalog.full-sync` queue, `catalog.sync.completed`, inbox constants, `catalogStoreData.purge`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/catalog.ts`, `packages/db/migrations/0014_product_tombstones.sql`, `meta/_journal.json` -- add `deleted_at` -- the tombstone.
- [x] `packages/contracts/src/v1/events.ts`, `events.test.ts` -- add `catalog.product.deleted` and a parse test -- catalogued event and owner.
- [x] `ports/commerce-platform.ts`, `adapters/salla/salla-endpoints.ts`, `salla-platform.ts`, `dev-platform.ts`, `index.ts`, `salla.test.ts` -- deleted payload, 404 → null, parse tests -- the platform seam.
- [x] `modules/integration/webhook-inbox.ts` -- process deletions inline -- no needless sweep delay.
- [x] `modules/catalog/catalog.repository.ts` -- tombstone, revive, list exclusion -- the guarded writes.
- [x] `modules/catalog/product-deletions.ts`, `product-webhooks.ts`, `adapters/telemetry/pino-telemetry.ts`, `worker/catalog-jobs.ts` -- reusable deletion and its wiring.
- [x] `apps/api/src/composition/product-webhooks.test.ts` (and `catalog.test.ts` where it fits) -- one test per matrix row through the signed webhook POST, plus a direct `deleteProducts` test with several ids and source `reconcile` (counts and one event per newly deleted product), and the `catalog.product.deleted` handler dispatch.

**Acceptance Criteria:**
- Given a deleted product, when a merchant calls `GET /v1/products` (with or without search or category filters), then it is not in the rows or the total.
- Given a deletion and its event, when the transaction rolls back, then neither the tombstone nor the event exists (same transaction).
- Given `pnpm turbo run lint typecheck test build`, then everything passes.

## Spec Change Log

## Review Triage Log

### 2026-11-03 — Review pass

- verdicts: 29 findings — high 0, medium 0, low 19, false 7, maybe-false 3
- findings:
  - `[low]` `[patch]` (verification-gap) The pre-declared `slips_catalog_stale_writes_total` series, including the new `reconcile` label, is never asserted in the rendered metrics — fixed: telemetry.test.ts now asserts the `webhook`, `sync` and `reconcile` zero series.
  - `[false]` `[reject]` (intent) No reconcile job discovers absent products — the epic assigns the reconcile job to Story 2.6, whose AC says absent products are "handled per Story 2.5"; this story supplies that path (`deleteProducts`, source `reconcile`) and tests it directly.
  - `[low]` `[reject]` (intent) `catalog.product.deleted` makes `external_id` required beyond the AC's `(store_id, product_id)` — a superset that the only producer always fills; no consumer harm.
  - `[false]` `[reject]` (intent) The product picker exclusion is unenforced — no picker exists yet (Epic 3); the only product read query excludes tombstones, and a picker built on catalog's service inherits it.
  - `[low]` `[reject]` (intent) "Excluded by default" has no opt-in — no consumer needs deleted rows yet; adding an API option is new surface without a user.
  - `[low]` `[reject]` (intent) `listCategories` still lists a category whose products are all deleted — same as the existing behaviour for hidden products; the fix needs an extra subquery for a cosmetic filter entry.
  - `[false]` `[reject]` (intent) AC3 revival is narrowed by an ordering rule — the epic requires that out-of-order webhooks never overwrite newer data; strict-newer revival is that rule applied to tombstones.
  - `[low]` `[reject]` (intent) A recreated product seen only by the full sync stays deleted — needs a missed restore webhook on a same-id recreate; reconciliation (Story 2.6) revives with events, which the full sync may not emit (Story 2.4 rule). Noted for 2.6 under residual risks.
  - `[false]` `[reject]` (intent) No storefront/content effect is observable — AC4 names content (Story 3.4) and publishing (Epic 4) as the consumers; this story's surface ends at the catalogued event.
  - `[maybe-false]` `[defer]` (intent) A Salla product with status `deleted` is hidden, not tombstoned — deferred (medium, unverified); settle with a recorded deletion/trash on the demo store.
  - `[maybe-false]` `[defer]` (intent) `product.deleted` name/shape and the 404 behaviour are unverified against Salla — deferred (medium, unverified); settle with the webhook recorder.
  - `[low]` `[reject]` (edge) A `product.deleted` without `created_at` retried late by the sweep is stamped with processing time and could tombstone a newer recreate — needs a missing envelope time, an inline failure and a same-id recreate in that window; the fix adds a field to the inbox consumer input.
  - `[low]` `[reject]` (edge) A transient 404 (read lag) on the fetch path tombstones or skips a product — the fetch path runs only for unreadable webhook data; a just-created product is `unknown` (nothing written, as before it dead-lettered); an existing product is revived by the next newer edit or reconciliation. A bounded re-check adds retry state. Listed in residual risks.
  - `[low]` `[reject]` (edge) A 404 observed at host time older than a stored Salla time is counted stale and dropped — needs the host clock behind Salla's; the `product.deleted` webhook (Salla time) still tombstones it.
  - `[low]` `[reject]` (edge) A full sync after a missed restore webhook leaves the product hidden — same as the intent row above (reconciliation revives).
  - `[low]` `[reject]` (edge) The full sync counts tombstoned rows as `updated` in `catalog.sync.completed` — only logged counts; excluding them needs an extra RETURNING column and branch.
  - `[low]` `[patch]` (edge) `tombstoneProducts` binds one parameter per id, so a large reconcile batch can hit the 65,535 bind limit — fixed: the select and update match with one array parameter (`= any($1::text[])`, `= any($1::uuid[])`).
  - `[false]` `[reject]` (edge) `deleteProducts` could publish with a store id other than the context store — its only caller passes the `withStoreContext` store, RLS confines the rows, and `publishEvent` throws on a payload/ambient store conflict.
  - `[low]` `[reject]` (blind) The full sync never revives and bumps `source_updated_at`, so a same-time restore webhook after it is stale — needs a same-id recreate with the sync fetching it in the seconds before the webhook; reconciliation (2.6) repairs. Grouped with the intent/edge rows above.
  - `[low]` `[reject]` (blind) A 404 becomes a permanent deletion without a second check — grouped with the edge 404 row.
  - `[maybe-false]` `[defer]` (blind) Status `deleted` maps to hidden — grouped with the deferred intent row.
  - `[low]` `[reject]` (blind) A stale deletion is dropped for good — both times come from Salla's clock through the same zone-aware parser; a miss is repaired by reconciliation, and a confirming fetch adds a branch and an API call.
  - `[low]` `[reject]` (blind) The deleted event has no time and a restore looks like an ordinary update, so unordered delivery can confuse consumers — consumers re-read catalog state (same rule as Story 2.4's rejected "no ordering field"); adding fields is contract surface without a consumer.
  - `[low]` `[patch]` (blind) `tombstoneProducts` does not handle large id lists — grouped with the edge bind-limit row; fixed there.
  - `[false]` `[reject]` (blind) A future-dated deletion time blocks revival — the deletion and the recreate are both stamped by Salla's clock, so they compare in one clock domain; clamping to host time would mix domains.
  - `[low]` `[reject]` (blind) No index supports `deleted_at IS NULL` — the filter applies to rows already selected by store; no measured cost at pilot scale.
  - `[false]` `[reject]` (blind) A restored hidden product is announced as back in the manifest — the event carries the snapshot with `visible: false`, so consumers see it is hidden.
  - `[low]` `[reject]` (blind) Test gaps: no `created_at` fallback test, no stale 404 test, no lost-race restore test, no sync-count test, weak handler assertion — the lost-race branch is unreachable under the row and advisory locks (as in 2.4); the rest are low-value and the handler test also checks the log line.
  - `[low]` `[reject]` (blind) The dev platform's `products.get` never returns null — deliberate, so local dev never tombstones; the 404 path is covered by the adapter and composition tests.

## Design Notes

- Tombstone time doubles as the ordering stamp: setting `source_updated_at = at` lets the existing guard reject any older update, and the strict-newer revive rule settles the same-second tie in favour of the deletion.
- A 404 on the fetch is the platform's own answer that the product is gone, the same evidence reconciliation uses, so it takes the deletion path instead of retrying into dead-letter.
- The full sync leaves tombstones alone because it emits no events (Story 2.4 rule). Reviving silently would leave content flagged "Linked product deleted" with no `catalog.product.updated`. Reconciliation (2.6) revives with events.
- A restored product sends every visible field in `changed`, so consumers treat it as a full refresh without a contract change.

## Verification

**Commands:**
- `pnpm -C packages/contracts test` -- expected: pass.
- `pnpm -C apps/api exec vitest run src/composition/product-webhooks.test.ts src/composition/catalog.test.ts src/adapters/salla src/worker` -- expected: pass (live DB on 127.0.0.1:5433).
- `pnpm turbo run lint typecheck test build` -- expected: pass.

## Auto Run Result

Status: done

**Summary:** Products deleted in Salla are now soft-deleted. `products.deleted_at` is the tombstone. One reusable function, `deleteProducts` (`apps/api/src/modules/catalog/product-deletions.ts`), tombstones products by external id under the store's product lock, guarded on `source_updated_at` (ties go to the deletion), and emits `catalog.product.deleted` in the same transaction, only on the live-to-deleted transition. The `product.deleted` webhook (processed inline) and a 404 on the product fetch (the Story 2.4 deferred item) both use it; Story 2.6 reconciliation can call it with a batch of ids and source `reconcile`. A strictly newer create/update webhook restores a tombstoned product and emits `catalog.product.updated` with every visible field changed. `GET /v1/products` excludes deleted products. The full sync leaves tombstones untouched.

**Files changed:**
- `packages/db/src/schema/catalog.ts`, `packages/db/migrations/0014_product_tombstones.sql`, `meta/_journal.json` -- nullable `deleted_at`.
- `packages/contracts/src/v1/events.ts` (+ test) -- `catalog.product.deleted` v1 owned by catalog.
- `apps/api/src/ports/commerce-platform.ts` -- `products.get` returns null when the platform says the product does not exist.
- `apps/api/src/adapters/salla/salla-endpoints.ts`, `salla-platform.ts`, `dev-platform.ts` (+ `salla.test.ts`) -- `product.deleted` parsed to an id-only deletion payload; 404 on `products.get` returns null (list and orders unchanged).
- `apps/api/src/modules/integration/webhook-inbox.ts` -- deletions need no fetch, so they run inline.
- `apps/api/src/modules/catalog/catalog.repository.ts` -- `tombstoneProducts`, tombstone-aware `applyProduct` (`restored` outcome), restore-only clearing in `upsertGuarded`, list exclusion.
- `apps/api/src/modules/catalog/product-deletions.ts` (new), `product-webhooks.ts` -- reusable deletion and its webhook/404 wiring.
- `apps/api/src/adapters/telemetry/pino-telemetry.ts` (+ `telemetry.test.ts`) -- `reconcile` label on the stale-writes metric.
- `apps/api/src/worker/catalog-jobs.ts` -- logging handler for `catalog.product.deleted`.
- `apps/api/src/composition/product-webhooks.test.ts`, `catalog.test.ts` -- one test per matrix row through signed webhook POSTs, batch `deleteProducts`, rollback, list exclusion, handler dispatch.

**Review findings:** 29 findings (high 0, medium 0, low 19, false 7, maybe-false 3). Patches applied: 3 rows in 2 entries (both low): one-parameter array matching in `tombstoneProducts`, and the rendered stale-writes series assertion. Deferred: 3 rows in 2 entries (status `deleted` mapped to hidden; unverified Salla deletion shape and 404), both medium (unverified). Rejected: 24, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false. First pass; patched entries: high 0, medium 0, low 2.

**Verification:** `pnpm -C packages/contracts test` passed (35). `pnpm -C apps/api exec vitest run src/composition/product-webhooks.test.ts src/composition/catalog.test.ts src/adapters/salla src/adapters/telemetry src/worker` passed (155, live DB on 127.0.0.1:5433). `pnpm turbo run lint typecheck test build` passed (26 of 26 tasks). Matrix audit: all 9 matrix rows have a passing composition test.

**Residual risks:**
- Every 404 on `GET /products/<id>` is treated as a deletion. A 404 for another reason (path or API change, read lag) would tombstone a product whose webhook data was unreadable; the next strictly newer edit or reconciliation revives it.
- The full sync never revives a tombstoned product and may move its `source_updated_at` forward, so a same-time restore webhook after a sync is stale. Story 2.6 reconciliation must revive tombstoned products that are present in Salla (with `catalog.product.updated`), not rely on a strictly newer time alone.
- The Salla deletion payload and 404 behaviour are unverified against a live store (deferred).

