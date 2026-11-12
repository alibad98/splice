---
title: '4.4 Compile the per-store manifest of eligible content - controlled pilot slice'
type: 'feature'
created: '2026-11-11'
status: 'done'
pilot_slice_status: 'done'
full_story_status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bbe704cc506988e620d877f4e3e62a440475600f'
context: []
---

<frozen-after-approval reason="Approved by Ali on 2026-11-11 (approve and continue)">

## Intent

**Problem:** The only manifest is the per-item preview. No compiled per-store manifest exists that a storefront could read, and nothing recompiles when content, products or the store lifecycle change.

**Approach:** Extend the 3.10 `compileManifest` so it also emits placements and layouts. `publishing` owns a new `store_manifests` table and a worker job, triggered by one `MANIFEST_INPUTS` event list through the transactional outbox. The job is single-flight per store and debounced. It selects only live Home Story items with processed media and writes a monotonic revision. Preview keeps using the same compiler.

## Boundaries & Constraints

**Always:**
- One compiler: preview and store manifests both go through `compileManifest`.
- `store_manifests` is owned by `publishing` and has a non-null unique `store_id`, forced RLS, a cross-tenant test and an entry in `ownership.ts`. Purge removes the row. Export skips it, because it is derived data.
- `publishing` reads other modules only through their services (content, catalog, media, integration). It never reads their tables.
- Selection (pilot):
  - Include only items that are `published`, not deleted, `format = story`, have a Home placement, and have at least one slide where every slide asset is `processed`.
  - Exclude items whose linked product is deleted.
  - Order by `first_published_at` newest first, then `id`, and cap at 10.
- Media URLs come from processed renditions only: `MEDIA_PUBLIC_BASE_URL` + `/` + the rendition `storage_key`. That key contains a sha256, so the URL is immutable. Source, upload and authenticated preview URLs never appear in a store manifest.
- Compiles run in one transaction per store that holds a row lock on `store_manifests` and writes `revision = previous + 1`. A concurrent or older job can never leave a lower revision in place.
- Lifecycle:
  - `active`: compile.
  - `disconnected`: no write, so the last manifest is kept.
  - `uninstalled`, `purged` or unknown store: write an empty manifest (no placements, no items).
- CTA: re-check an `open_link` URL against the store's synced domains at compile time. If it no longer matches, set `cta_action`, `cta_label` and `cta_url` to null and emit a warning metric/log with the content id.
- Emit metrics for gzip size (warn above 15 KB) and compile lag measured from the triggering event's `occurred_at`.

**Never:**
- CDN upload, CDN purge or a public manifest route (that is 4.5). Product-driven refresh guarantees beyond enqueueing a compile on the existing catalog events (that is 4.6).
- Schedules, Category/Product placements, Reels in store manifests, plan-limit trimming, store keys or manifest sharding.
- A second compiler, or a merchant-visible flag for a dropped CTA (deferred; save-time validation already rejects off-domain URLs).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Publish | Story item published with Home placement and processed media | Compile enqueued in the publish transaction; manifest has 1 Home/ring placement listing the item, with public rendition URLs and the product snapshot | N/A |
| Ineligible | Draft, processing, failed, archived, deactivated, deleted, reel, no Home, pending/empty media, deleted product | Omitted | N/A |
| Cap | 12 eligible items | 10 newest by `first_published_at` | N/A |
| Withdraw | Archive or delete a listed item | Next compile drops it; revision +1 | N/A |
| Burst | 5 triggers for one store within 10 s | At most 2 compiles (singleton + next slot); revisions strictly increase | Dispatcher dedupes event ids |
| Race | Two compile jobs run concurrently | Serialized by row lock; each commits previous + 1 | No lower revision stored |
| Disconnected | Store `disconnected` | Row untouched | N/A |
| Uninstall / purge | `uninstalled` or `purged` event | Empty manifest (uninstall); purge deletes the row | N/A |
| Off-domain CTA | `open_link` to a domain no longer synced | CTA fields null; warning metric | Item still listed |
| Isolation | Other tenant | Cannot read or write the row | RLS |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/publishing/manifest-compiler.ts` (`compileManifest`), `publishing.service.ts` (preview selection and URL resolution), `publishing.module.ts`. Extend these and keep the preview behavior.
- `packages/contracts/src/v1/manifest.ts`:
  - `StoreManifest` gains `placements: [{ type: 'home', layout: StoryLayout, item_ids: uuid[] (max 10) }]`.
  - `ManifestItem` makes `cta_label` and `cta_action` nullable.
  - Preview emits the item's own placements. Update `manifest.test.ts` and the player (`packages/player`) so a null CTA renders no button.
- `packages/contracts/src/v1/events.ts:35-157`: the event names that `MANIFEST_INPUTS` lists.
- `apps/api/src/events/outbox.ts:39` `publishEvent`, `events/dispatcher.ts:14` `EventHandlerRegistry.on`. Handlers are registered in `worker/*-jobs.ts` and wired in `worker/worker.ts:117-140`.
- `apps/api/src/worker/queues.ts:47`: add `publishing.manifest.compile` (realtime). `worker/store-job.ts` `storeScopedJob`. For singleton/debounce, follow `worker/catalog-jobs.ts:80,90` (`singletonKey`, `singletonSeconds: 10`, `singletonNextSlot`), sending with `db: tx`.
- `apps/api/src/modules/content/content.repository.ts` / `content.service.ts`: add an owner query for store candidates. It returns the snapshot shape that `getItemSnapshot` uses, plus placements and `firstPublishedAt`. `content-lifecycle.ts` already emits every transition and edit event.
- `apps/api/src/modules/media/media.service.ts:130` `getPreviewMediaByIds`: copy its profile selection into a new `getPublishedMediaByIds` (processed only, public URLs). Add `MEDIA_PUBLIC_BASE_URL` in `config/env.ts`; required in production, dev default `${S3_ENDPOINT}/${S3_BUCKET}`.
- `apps/api/src/modules/catalog/catalog.service.ts` `getProductsByIds`. `integration.service.ts:314` synced domains, plus a lifecycle-state read; add one if none is exported.
- `packages/db/src/schema/` new `publishing.ts` (`store_manifests`: id, store_id unique, revision bigint, manifest jsonb, size_gzip_bytes int, compiled_at), `ownership.ts`, `schema/index.ts`, migration `0024_store_manifests.sql`. Mirror 0023/0022 for RLS, FORCE, grants and `tenantTableStatements` (`tenant/rls.ts:13`). Cross-tenant registration goes in `src/testing/cross-tenant.ts`.
- `apps/api/src/ports/store-data-lifecycle.ts:18`, `http.ts:172`: add a `publishing.lifecycle.ts` (purge deletes the row; export returns nothing).
- Tests: `apps/api/src/composition/preview.test.ts` pattern (isolated PG via `TEST_DATABASE_PORT`), `worker/queues.test.ts`, `worker/startup.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] DB: `store_manifests` schema, migration 0024, ownership, RLS/cross-tenant/constraint tests.
- [x] Contracts and player: placements, nullable CTA, tests; player hides a null CTA.
- [x] Media and env: `getPublishedMediaByIds` with public immutable URLs; `MEDIA_PUBLIC_BASE_URL`; tests.
- [x] Content, catalog and integration owner reads needed for selection, lifecycle state and domains.
- [x] Publishing:
  - Extend the compiler.
  - `ManifestCompiler` job: lock, lifecycle branch, select, compile, revision +1, metrics.
  - `MANIFEST_INPUTS` handlers that enqueue in the transaction.
  - Queue and worker wiring.
  - Lifecycle purge.
  - Preview kept on the shared compiler.
- [x] Tests covering every I/O matrix row: compile composition, burst/race and revision monotonicity, lifecycle, CTA drop, size metric, startup handler registration.
- [x] Tracking: evidence here and in `pilot-readiness.md`; full 4.4 stays in progress.

**Acceptance Criteria:**
- Given any trigger in `MANIFEST_INPUTS`, when its transaction commits, then a compile job for that store exists. When it rolls back, then none does.
- Given the same content item, when previewed and when compiled for the store, then both outputs come from `compileManifest` and validate as `StoreManifest` v1.

## Original full Story 4.4 acceptance criteria (preserved)

The manifest contains only Published, in-schedule items with placements, layouts, display options, product snapshots and immutable processed asset URLs. Every other status is excluded. Each placement is ordered by `first_published_at` newest first and capped at 10. Compile is single-flight and debounced over the `ManifestInputs` list, with a monotonic `store_manifests.revision` that is never overwritten by an older one. Off-domain open-link CTAs are dropped and the item is flagged for the merchant. A manifest above 15 KB gzip emits a size metric and a warning. This slice delivers Home/Story/Ring/publish-now only; schedules, other placements and layouts, Reels, display options and the merchant CTA flag stay open.

## Implementation Notes

Implemented on 2026-11-11 (review pending).

- **DB:** `store_manifests` (`packages/db/src/schema/publishing.ts`, migration `0024_store_manifests.sql`): unique non-null `store_id`, `revision bigint >= 0` (0 = locked but never compiled), and a check that `manifest`, `size_gzip_bytes` and `compiled_at` are set exactly when `revision > 0`. Forced RLS with the `tenantTableStatements` convention, already listed under `publishing` in `ownership.ts`. Cross-tenant registration and constraint tests are in `src/schema/publishing.test.ts`.
- **Contracts and player:** `ManifestPlacement` (`home`, `StoryLayout`, `item_ids` max `MANIFEST_PLACEMENT_MAX_ITEMS` = 10) is required on `StoreManifest`. `ManifestItem.cta_label` and `cta_action` are nullable. The player's `isManifest` accepts a dropped CTA only when label, action and URL are all null, and it requires valid placements. `hasCta` hides the button.
- **Media and env:** `MediaService.getPublishedMediaByIds` returns processed assets only, with the same profile selection as preview, at `MEDIA_PUBLIC_BASE_URL/<rendition storage_key>`. `MEDIA_PUBLIC_BASE_URL` is required in production. Otherwise `mediaPublicBaseUrl()` falls back to `${S3_ENDPOINT}/${S3_BUCKET}`, and to `http://localhost:9000/slips-media` when no endpoint is set. Trailing slashes are stripped.
- **Owner reads:** `ContentService.getStoreManifestCandidates` returns live published Home Stories in the `getItemSnapshot` shape plus `placements` and `firstPublishedAt`, ordered by `first_published_at desc nulls last, id desc`. `getItemSnapshot` now also returns placements. `IntegrationService.getLifecycleState` returns the state, or null for an unknown store. Catalog reuses `getProductsByIds`. Every call joins the compile transaction.
- **Publishing:**
  - `compileManifest(storeId, CompileSnapshot[])` groups placements by type and layout in input order and caps each at 10.
  - `toCompileSnapshot` (`manifest-snapshot.ts`) is the one mapping that preview and store compiles share.
  - `StoreManifestCompiler` (`store-manifest.ts`) runs in one transaction: lifecycle check, then `insert … on conflict do nothing` + `select … for update`, then select, compile, `StoreManifest.parse`, gzip, and `revision + 1`.
  - Metrics: `slips_manifest_compiles_total{outcome}`, `slips_manifest_compile_lag_seconds`, `slips_manifest_size_gzip_kilobytes`, `slips_manifest_oversize_total` with a warning log above 15 KB, and `slips_manifest_cta_dropped_total` with a warning log carrying `content_id`.
  - `MANIFEST_INPUTS` (`manifest-inputs.ts`) lists 20 catalogued events: content transitions into and out of published plus edits, `media.asset.processed`/`failed`, catalog product updated/deleted and sync completed, and every store lifecycle event. `registerPublishingEventHandlers` (`worker/publishing-jobs.ts`) sends `publishing.manifest.compile` with `db: tx`, `singletonKey: storeId`, `singletonSeconds: 10` and `singletonNextSlot: true`.
  - The queue is in the realtime group and wired in `worker.ts`. `publishingStoreData` purges the row and exports nothing.
  - The dispatcher now passes `occurredAt` (envelope `occurred_at`) to handlers, for the lag metric.
- **Verification (isolated PostgreSQL on port 15434):**
  - Unit tests: contracts 96, DB 72, API 741 (1 pre-existing MinIO-only skip), player 65, dashboard 381.
  - Browser tests: dashboard 24, player 33.
  - `pnpm turbo run lint typecheck build`: 19/19 tasks passed. `git diff --check` is clean.
  - `apps/api/src/composition/store-manifest.test.ts` covers every I/O matrix row and both acceptance criteria: commit and rollback for each of the 20 triggers, rollback of the delivery transaction, burst, race, lifecycle, CTA, size and lag metrics, isolation, and preview against store compile.
- **Decisions and risks:**
  - (a) Superseded in the parent run on 2026-11-11: a `purged` or unknown store gets no row (`outcome: 'removed'`; any row is deleted). The frozen Always rule ("write an empty manifest") and the matrix row ("purge deletes the row") conflict, because `integration.store.purged` fires after the module purge. An absent row is read as the empty manifest (4.5), which satisfies both: storefronts see empty, and nothing is recreated after purge. `uninstalled` still writes an empty manifest at the next revision.
  - (b) The enqueue uses the delivery transaction (`db: tx`). This needs the worker's `DATABASE_URL` role to own or write the pg-boss schema, as `grantEventPublishing` already assumes. The app role cannot enqueue compiles.
  - (c) A burst that straddles a 10 s slot boundary can queue a third compile. The test aligns to the start of a slot.
  - (d) `catalog.sync.completed` and `media.asset.*` trigger compiles for every store event, including stores with no live content. The debounce bounds this.
  - (e) The schedule (`in-schedule`), Category/Product placements, Reels, the merchant CTA flag and CDN delivery remain open (4.5/4.6 and full 4.4).

## Spec Change Log

## Review Triage Log

Independent review on 2026-11-11 with three layers: blind (B), edge case (E) and verification gap (V). No layer was skipped. Each finding was checked against the code.

| ID | Verdict | Evidence and disposition |
| --- | --- | --- |
| B1 / E4 | medium | `ManifestItem` accepts a half-null CTA that the player's `isManifest` rejects, so one inconsistent item would make the player reject the whole manifest. **Patch**: contract refinement plus tests. |
| B2 | medium | `compile` reads `getLifecycleState` before `select … for update`, so a compile waiting on the lock can write live content after an uninstall or disconnect committed. The next lifecycle-triggered compile would heal it, but the docstring and Design Notes claim lock-then-read. **Patch**: lock first, then read the state. |
| B3 | medium | Every compile bumps the revision even when the output is unchanged (unrelated catalog/media events, repeated uninstalled compiles). The harm lands in 4.5, which would upload and purge once per revision. **Defer** to 4.5: skip the upload/purge (or the revision bump) when the content hash is unchanged. |
| B4 / E1 / V-other | medium | `getPublishedMediaByIds` keys every `processed` asset even when it has no playable public rendition, so `select()` lists a blank slide. **Patch**: omit such assets. |
| B5 / E2 | low | A linked `productId` missing from `getProductsByIds` passes the `?.deleted` filter and ships `product: null` with a product CTA. Catalog rows are soft-deleted, so this is rare, but the fix is a direct correction. **Patch**. |
| B6 | low | `StoreManifest.parse` throws on any invalid item, failing the whole compile. Rows are written through the same contract limits and the job failure is already instrumented by `instrumentJob`; no reachable invalid row was shown. Rejected. |
| B7 | low | The candidate query is unbounded. At pilot scale (one to three merchants) the cost is negligible, and the bound must come after media/product filtering. **Defer**. |
| B8 | false | `item_ids` are built by `compileManifest` from the same `items` list, so missing references cannot occur in compiled output. |
| B9 | false | The player may not import contract runtime values (AD-7: contracts are type-only in the player), so the literals are required. |
| B10 | medium | `MEDIA_PUBLIC_BASE_URL` accepts `http:` in production, which HTTPS storefronts would block as mixed content. **Patch**. |
| B11 / E5 | low | The `ManifestCompiles` doc omits `removed`, and lag is recorded for no-op runs. **Patch** (direct correction). |
| B12 | low | No reader of `store_manifests` exists yet; "absent row = empty" is a 4.5 read-side rule. Out of scope by intent (no public route in 4.4). Rejected; noted for 4.5. |
| B13 | false | The worker builds its services by hand everywhere (`worker.ts` composition); this follows the established pattern and the startup test checks the wiring. |
| B14 | low | `env.test.ts` imports `mediaPublicBaseUrl` from `http.ts`. No named harm beyond import weight. Rejected. |
| B15 | low | The `occurredAt` fallback to now is never taken: the dispatcher always sets it. Covered by the V1 patch test. Rejected. |
| E3 | medium | Reinstall/refresh of an already-active store updates `synced_domains` without a `MANIFEST_INPUTS` event, so a CTA drop decision can stay stale until the next trigger. This is pre-existing: no domains-changed event exists, and save-time validation still applies. **Defer**. |
| E6 | low | The AC says a compile job exists when the trigger commits; in fact the event job is committed with the trigger and the compile job is enqueued in its delivery transaction (AD-17 outbox). Both are atomic with their transactions, and the tests assert exactly this chain. Rejected. |
| V1 | medium | Pre-verified: nothing checks that `occurred_at` travels dispatcher → handler → job → lag metric. **Patch**: end-to-end test. |
| V2 | medium | Pre-verified: the image branch of `getPublishedMediaByIds` never runs in a test. **Patch**: an image Story compile test. |

## Design Notes

Monotonicity comes from the transaction, not from a separate counter. The compile runs `SELECT … FOR UPDATE` on the store's row (inserting revision 0 if the row is missing, then locking it), reads the inputs, and writes `revision + 1`. Because the row lock serializes compiles, the latest committed revision always reflects inputs at least as new as any earlier one. 4.5 uploads only when its revision is newer than the last uploaded one.

## Verification

**Commands:**
- `pnpm turbo run lint typecheck build --continue --concurrency=2` -- expected: all tasks pass.
- `pnpm --filter <contracts|db|api|player|dashboard> exec vitest run --maxWorkers=2` with an isolated `TEST_DATABASE_PORT` -- expected: all pass. Never use the development database.
- `pnpm --filter @slips/dashboard exec playwright test --workers=2` -- expected: preview browser tests still pass.
- `git diff --check` -- expected: clean.

### Post-review verification - 2026-11-11 (parent run)

The review patches were applied: B1/E4, B2, B4/E1, B5/E2, B10, B11/E5, V1 and V2 (see the triage log). B3, B7 and E3 are deferred in `deferred-work.md`. The parent run also changed purged and unknown stores to have no row (Implementation Notes (a)). Executed against the isolated PostgreSQL container `splice-4-4-testdb` (port 15434); no development or production database was touched.

- `pnpm turbo run lint typecheck build --continue --concurrency=2`: **19/19 successful**.
- vitest (`--maxWorkers=2`, `TEST_DATABASE_PORT=15434`): contracts **96**, DB **72**, API **744 passed / 1 skipped** (pre-existing MinIO-only test), player **65**, dashboard **381**: all passed.
- Playwright (`--workers=2`): dashboard **24 passed**, player **33 passed**.
- `git diff --check`: clean.

The sprint tracker keeps 4.4 `in-progress`: this is the pilot slice only, and full Story 4.4 acceptance (schedules, other placements, Reels, display options, the merchant CTA flag) remains open.
