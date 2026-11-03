---
title: 'Story 2.4: apply product webhooks in near real time'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '6131147a7cde2dc125312db48c74fc7ec15fdf36'
route: 'dispatch'
review_loop_iteration: 0
context: []
followup_review_recommended: false
deferred:
  - summary: >-
      The Story 2.4 rewrite of epic-2-context.md dropped Epic 2 constraints that the code and later stories rely on.
    evidence: |-
      The cached epic context lost: "Salla field names live only in adapters/salla", the <module>.<job> queue naming, "HTTP handlers never do long work inline", the Out-of-stock Arabic copy, WCAG 2.1 AA and 3 s interactivity, the price formatting rule, the "Syncing your products..." empty state, and the deleted-products exclusion. The Low bucket now reads "5 or fewer in stock", which overlaps Out of stock at 0 (epics.md:741 says 1-5). Later stories planned from this cache would miss these rules. The fix edits an agent-context file, so it is deferred: recompile or restore epic-2-context.md from the planning artifacts.
    location: >-
      _bmad-output/implementation-artifacts/epic-2-context.md
    severity: medium
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Price, stock and product edits in Salla only reach Slips on a full sync, so shoppers can see stale prices and stock. Salla product webhooks are verified and stored today, but the inbox marks them `ignored`.

**Approach:** The Salla adapter recognises product events and keeps an allow-listed canonical product in the inbox payload. The inbox hands `product` rows to a consumer registered by `catalog`. That consumer upserts the one product per store under a lock, with a write guarded on `source_updated_at`, and emits `catalog.product.updated` in the same transaction when a manifest-visible field changed.

## Boundaries & Constraints

**Always:**
- Keep the inbox order: verify, then parse, then store, then 200. Keep the dedup on `(platform, event_id = sha256(body))`, the retry and dead-letter timings, and the lifecycle paths, all unchanged.
- The canonical payload is an allow-list. Product fields are catalog data, never shopper PII. Salla names stay in `adapters/salla` (AD-4).
- Catalog writes happen only in `withStoreContext`, under `pg_advisory_xact_lock` keyed `catalog-product:<storeId>`. Events go out through `publishEvent` in the same transaction.
- A guarded write applies when the incoming `source_updated_at` is at or after the stored one, and skips when it is strictly older. Every skip is counted in a new metric `slips_catalog_stale_writes_total{source}`. Full-sync upserts use the same guard, with source `sync`.
- Manifest-visible fields: `name`, `image_url`, `price_minor`, `sale_price_minor`, `availability`, `has_required_options`, `visible`.

**Never:** Handle `product.deleted` (Story 2.5). Add a new pg-boss queue or a migration. Refresh tokens in catalog. Read integration tables from catalog. Emit events from the full sync (Story 2.6 adds reconcile events). Make dashboard changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Update | signed `product.updated`, known store, newer `updated_at`, price changed | product row updated; `catalog.product.updated` with `changed: ['price_minor']`; inbox `processed` | — |
| Created | `product.created` for a new external id | row inserted; no event (no content can link it yet) | — |
| Stale | update older than the stored `source_updated_at` | row untouched; stale metric +1 (`source: webhook`); inbox `processed` | — |
| Duplicate delivery | same body twice | second is `duplicate: true`, never processed | — |
| Non-visible only | only description or stock count changed, bucket unchanged | row updated (`stock`); no event | — |
| Stock event | `product.quantity.low` / `product.available` / `product.price.updated` / `product.status.updated` | handled like `product.updated` | — |
| Data unreadable | product `data` fails the canonical mapping, id readable | payload keeps `product_id` only; consumer fetches it through `products.get` | fetch errors retry, then dead-letter |
| No id | product event without a readable id | payload `invalid: true` | consumer throws `InvalidWebhookPayloadError`; dead-letter at once (`invalid_payload`) |
| Unknown store | merchant not installed | existing park, then dead-letter path | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/ports/commerce-platform.ts` -- `WebhookKind` gains `'product'`; `products.get(session, externalId): Promise<CanonicalProduct>` (model: `orders.get`).
- `apps/api/src/adapters/salla/salla-endpoints.ts`, `salla-platform.ts` -- `SALLA_PRODUCT_EVENTS` (created, updated, price.updated, quantity.low, available, status.updated). `parseWebhook` maps the kind to `product`, with payload `{ event, kind, product_id, product?: <canonical JSON> }`, built via `toCanonicalProduct(data)` inside a try. `products.get` uses `this.admin(session, '/products/<id>')` and expects `{ data }` (unverified, matching `list`). Also update `dev-platform.ts` and `adapters/salla/index.ts` stubs.
- `apps/api/src/modules/integration/webhook-inbox.ts` -- `onKind('product', consumer)` registry. In `handle()`, a `product` row locates the store (park if unknown), then awaits `consumer({ storeId, payload, eventId, occurredAt })`. Missing consumer → throw (retry; the worker sweep has it). `fail()` maps `InvalidWebhookPayloadError` → `invalid_payload`, dead-lettered at once like `platform_rejected`. `receiveAndProcess` keeps its rule of no outbound calls inline: a `product` row without `product` data (fetch needed) is left to the sweep.
- `apps/api/src/modules/catalog/product-writes.ts` (new) -- extract `toWrites` from `catalog-sync.ts:191` as `toProductWrites(platform, items, fetchedAt)`, with no behaviour change. `CatalogSync` calls it.
- `apps/api/src/modules/catalog/catalog.repository.ts` -- guard `upsertProducts` and `upsertCategories` with `setWhere excluded.source_updated_at >= …source_updated_at`. Return `skipped` (inputs − returned). New `applyProduct(row)`: `select … for update` of the visible fields, then the guarded upsert. Returns `{ outcome: 'created' | 'updated' | 'stale', productId, changed: string[] }`.
- `apps/api/src/modules/catalog/product-webhooks.ts` (new) -- `ProductWebhooks(pool, platform, tokens, telemetry, events)`. `handle()`: canonical product from the payload, or `products.get` with `tokens.getAccessToken(storeId)`. `sourceUpdatedAt ?? occurredAt ?? now`. Inside the lock, `applyProduct`, then publish `catalog.product.updated` when `changed` is non-empty, and log.
- `apps/api/src/modules/catalog/catalog-sync.ts` -- count stale skips from `upsertProducts` (metric, source `sync`).
- `apps/api/src/ports/telemetry.ts` -- `Metric.CatalogStaleWrites`.
- `packages/contracts/src/v1/events.ts` (+ `events.test.ts`) -- `catalog.product.updated` v1: `store_id`, `product_id`, `external_id`, `changed` (enum array), and the visible snapshot (`name`, `image_url`, `price_minor`, `sale_price_minor`, `currency`, `availability`, `has_required_options`, `visible`).
- `apps/api/src/worker/catalog-jobs.ts`, `worker.ts` -- register a no-op logging handler for `catalog.product.updated` (the dispatcher requires one). Register `ProductWebhooks` on `integration.inbox`.
- `apps/api/src/modules/catalog/catalog.module.ts` -- provider that registers `ProductWebhooks` on `IntegrationService.inbox` in `onModuleInit` (import `IntegrationModule`).
- Tests: `adapters/salla/salla.test.ts` (parse), `composition/catalog.test.ts` or a new `composition/product-webhooks.test.ts` (live DB; new role name), `composition/lifecycle.test.ts` pattern for a signed POST.
- Do not change: the `catalog.full-sync` queue, run-id semantics, `catalog.sync.completed`, the inbox constants, the `integration.webhook.inbox` dead-letter gauge label.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/v1/events.ts` -- add `catalog.product.updated` + tests -- the event contract.
- [x] `ports/commerce-platform.ts`, `adapters/salla/*` -- product kind, allow-listed payload, `products.get`, stubs + parse tests -- the platform seam.
- [x] `modules/catalog/product-writes.ts`, `catalog-sync.ts`, `catalog.repository.ts`, `ports/telemetry.ts` -- extract writes, guard upserts, `applyProduct`, stale metric -- the guarded write.
- [x] `modules/integration/webhook-inbox.ts` -- consumer registry, product dispatch, `invalid_payload` -- the hand-off.
- [x] `modules/catalog/product-webhooks.ts`, `catalog.module.ts`, `worker/worker.ts`, `worker/catalog-jobs.ts` -- the consumer and its wiring in API and worker.
- [x] Composition tests -- cover every matrix row, through a signed `POST /v1/webhooks/salla` for update, stale, duplicate and invalid; a full sync no longer overwrites a newer webhook write.

**Acceptance Criteria:**
- Given a verified product webhook for a known store, when it is received, then the product row reflects it before the 200 is returned (inline processing). The sweep retries within a minute if inline processing fails.
- Given retries are exhausted, when the inbox dead-letters, then `slips_webhook_failures_total{reason="dead_lettered_<code>"}` increments and the existing dead-letter depth alert covers it.
- Given `pnpm turbo run lint typecheck test`, then everything passes.

## Implementation Notes

- The webhook consumer also upserts the product's categories (guarded the same way), so category names exist for the Products list.
- A product with an unknown currency or an unreadable amount throws `InvalidWebhookPayloadError` and is dead-lettered at once. Reconciliation (Story 2.6) repairs it.
- `apps/api/vitest.config.ts` now uses `fileParallelism: false`. The live-DB test files share the global `webhook_inbox`, and `lifecycle.test.ts`'s sweep claimed rows from `product-webhooks.test.ts` when files ran in parallel. The suite takes about 35 s.
- Test retries are made due with `now() - interval '1 hour'`, because the Docker DB clock can run ahead of the host clock that `processDue` compares against.
- During a rolling deploy, an old process (without the `product` kind) marks product rows `ignored`. Reconciliation repairs these.
- The Salla product event names, the webhook `data` shape and the `GET /products/<id>` envelope are unverified against a live store. Record fixtures with the webhook recorder on the demo store.

## Spec Change Log

## Review Triage Log

### 2026-11-03 -- blind-hunter, edge-case-hunter, verification-gap (3 Sonnet subagents)

- `low` patch (applied): `applyProduct` reports `created` when a concurrent full sync inserts the row between the read and the upsert. Decide from `w.inserted`.
- `low` patch (applied): `ProductVisibleField` duplicates `PRODUCT_VISIBLE_FIELDS`. Derive it from contracts.
- `medium` patch (verification-gap, applied): the worker's `onKind('product')` wiring is untested. Use one shared registration helper for the worker and the test.
- `medium` patch (verification-gap, applied): the `catalog.product.updated` handler is never dispatched in a test. Add a dispatch case.
- `medium` patch (verification-gap, applied): the unknown-currency / unreadable-amount dead-letter path is untested. Add a composition test.
- `low` patch (verification-gap, applied): the category guard is unasserted. Add a test for category create and an older write.
- defer (verification-gap): the lost-race branch `!w` in `applyProduct` is untested. It is unreachable under the row lock and advisory lock.
- defer: a fetch-path event for a disconnected store retries as `internal`, then dead-letters, because `getAccessToken` throws `StoreDisconnected*`. Story 2.7 owns pause and resume.
- defer `maybe-false` (medium if true): a partial payload from `product.quantity.low` or `product.available` might map with defaults and overwrite fields. Settle it with a recorded real delivery.
- false: fallback timestamps reorder sync and webhook writes. Both stamp the time the state was observed (fetch time for the sync, event time for the webhook), so the later observation wins.
- false: category `sourceUpdatedAt` uses the event time. The same reasoning applies, since the event time is when that name was observed.
- false: `staleCount` assumes a default increment of 1. The webhook path calls `counter` once per skip, and the test counts the calls.
- low rejected: `changed` omits currency and tax-inclusive (a store-level setting that rarely changes), and the event has no ordering field (consumers re-read).
- low rejected: inline advisory-lock latency on bulk edits (a write takes milliseconds), the dev-platform `get` throwing, the bare `catch` in the adapter, and `fileParallelism: false` (35 s suite).
- low rejected: a fetched id differing from `product_id`, `onKind` registered twice, a 404 on `get` (deleted products are Story 2.5), and `skipped` with non-deduplicated callers (`toProductWrites` deduplicates).
- low rejected: product writes for a non-live store. This is by design (Design Notes), and the data stays during grace.
- rejected (fix edits the spec): AC "reflected before 200" versus `needsFetch`. The Code Map carves out the sweep path.

### 2026-11-03 — Review pass

- verdicts: 41 findings — high 0, medium 6, low 21, false 13, maybe-false 1
- findings:
  - `[low]` `[patch]` (blind) Webhook locks the product row then categories, while a full-sync page locks categories then products, so the two can deadlock — fixed: `ProductWebhooks.handle` now upserts categories before `applyProduct`, the same order as sync (categories keep their own guard).
  - `[low]` `[reject]` (blind) A product deleted before the fetch 404s and retries until dead-lettered — carried: earlier pass rejected it (deleted products are Story 2.5).
  - `[low]` `[reject]` (blind) A stored product that fails the `StoredProduct` parse falls back to an inline fetch inside the HTTP request — real only for adapter/consumer schema drift (e.g. a padded 2-letter currency); the fetch then maps the same way and dead-letters. Unlikely, and the fix adds a branch.
  - `[low]` `[reject]` (blind) Inline processing holds connections and delays the 200 during bulk edits — carried: earlier pass rejected inline lock latency.
  - `[false]` `[reject]` (blind) The fetch path can miss the 1-minute freshness target — `SWEEP_CRON` is `* * * * *` and the row is due at receipt, so the sweep applies it within a minute.
  - `[false]` `[reject]` (blind) Sync-applied changes emit no `catalog.product.updated` — the intent's Never list forbids events from the full sync (Story 2.6).
  - `[false]` `[reject]` (blind) No event when a concurrent sync inserted the row between read and upsert — that row was created moments earlier, so no content can link it yet; the same reason the Created row emits no event.
  - `[medium]` `[defer]` (blind) The epic-2-context.md rewrite drops constraints (Salla names in adapters, no long work inline, UX rules) and the Low bucket loses its lower bound — real; the fix edits an agent-context file, so deferred.
  - `[low]` `[patch]` (blind) The `catalog.product.updated` log handler comment says Epic 3 publishes the event — fixed: catalog publishes it; content (Story 3.4) and publishing (Epic 4) will consume it (epics.md:881).
  - `[low]` `[patch]` (blind) The `product webhook applied` log has no `store_id` — fixed: added `store_id`. The trace-id and throughput-metric parts are rejected (no trace id on inbox rows; a new metric is scope creep).
  - `[low]` `[reject]` (blind) Writes for a disconnected or uninstalled store during grace — carried: earlier pass rejected it as by design.
  - `[false]` `[reject]` (blind) The event contract is loose (`currency` any string, empty name, no sale < price check) — the only producer emits values `toProductWrites` already validated (known currency, sale below price) and `StoredProduct`/adapter require a non-empty name.
  - `[false]` `[reject]` (blind) The category guard compares sync fetch time with webhook event time — carried: earlier pass found both stamp when the name was observed.
  - `[low]` `[reject]` (blind) `toProductWrites` has no unit tests of its own — moved without behaviour change and still covered by the sync and webhook composition tests.
  - `[medium]` `[patch]` (blind) Nothing checks the worker registers the product consumer — carried: earlier pass patched it with the shared `registerProductWebhooks` helper; not patched again.
  - `[low]` `[reject]` (blind) Two concurrent webhooks for one store (the advisory lock) are untested — a one-line `pg_advisory_xact_lock`; a concurrency test adds cost for little signal.
  - `[low]` `[reject]` (blind) `onKind` twice silently replaces, and fetched `externalId` is not checked against `product_id` — carried: earlier pass rejected both.
  - `[low]` `[reject]` (blind) Composition tests share global inbox state across tests — the suite passes serially and deterministically; restructuring the fixtures is out of proportion.
  - `[low]` `[reject]` (edge) A future-dated `updated_at` pins the row against later syncs — sync and webhook both use the product's `updated_at` when Salla sends it, so they share a clock; only seconds of skew in the fallback path. Unlikely, and a clamp adds a branch.
  - `[false]` `[reject]` (edge) Category guard mixes clock domains — carried: same as the earlier false row.
  - `[false]` `[reject]` (edge) Concurrent insert yields no event — see the blind-hunter row above: no content can link a just-created product.
  - `[low]` `[reject]` (edge) A currency-only change emits no event — carried: earlier pass rejected `changed` omitting currency.
  - `[low]` `[reject]` (edge) An uninstalled-but-not-purged store's catalog is written — carried: by design.
  - `[low]` `[defer]` (edge) `getAccessToken` throws for a disconnected store on the fetch path, classified `internal` — carried: deferred to Story 2.7.
  - `[low]` `[reject]` (edge) A 404 on `GET /products/:id` retries until dead-lettered — carried.
  - `[low]` `[reject]` (edge) A stored product failing the parse fetches inline — same as the blind-hunter row; rejected.
  - `[low]` `[reject]` (edge, claim) AC "reflected before the 200" versus `needsFetch` — carried: rejected, the fix edits the spec.
  - `[false]` `[reject]` (edge, claim) Visible changes are missed on concurrent insert or currency change — the concurrent-insert part is refuted above; the currency part is carried rejected.
  - `[medium]` `[patch]` (verification-gap) The worker's own `registerProductWebhooks` call is untested — carried: earlier pass's patch introduced the shared helper; not patched again.
  - `[medium]` `[patch]` (verification-gap) No test shows an event for a change of `name`, `image_url` or `has_required_options` alone — fixed: new composition test posts three signed updates and asserts `changed` is `['name']`, `['image_url']`, `['has_required_options']`.
  - `[false]` `[reject]` (intent) Product rows are processed inline before the 200 — the inline step predates this story (uninstall), and the spec's AC requires the row to reflect the webhook before the 200.
  - `[false]` `[reject]` (intent) Full sync does not take the `catalog-product` lock — the Approach scopes the lock to the consumer; ordering against sync is the guard's job, and the deadlock it allowed is patched above.
  - `[maybe-false]` `[defer]` (intent) Stock events are tested with complete synthetic payloads only — carried: deferred until a real delivery is recorded.
  - `[medium]` `[patch]` (intent) The data-unreadable sweep path runs on a test-built service, not `startWorker` — carried with the worker-registration row; the deferral to the sweep itself is carried rejected.
  - `[low]` `[reject]` (intent) The unknown-store test asserts the park only, and an invalid event for an unknown store parks before dead-lettering — the park-to-dead-letter path is existing inbox behaviour; either order ends dead-lettered.
  - `[false]` `[reject]` (intent) The metric is only checked through a stubbed counter — `pino-telemetry.ts:47` declares `slips_catalog_stale_writes_total` with both `source` labels.
  - `[false]` `[reject]` (intent) The diff stops at the outbox, not shopper-visible freshness — the intent's Never list and matrix put consumers out of scope.
  - `[low]` `[reject]` (intent) Category guard skips are not counted in the stale metric — no operator harm; counting them would add return values and counter calls in two callers.
  - `[false]` `[reject]` (intent) `invalid_payload` also covers unknown currency and unreadable amount — documented design in Implementation Notes.
  - `[low]` `[reject]` (intent) `fileParallelism: false` — carried: earlier pass rejected it.
  - `[medium]` `[defer]` (intent) The epic-context rewrite drops "no long work inline" — grouped with the deferred epic-context row.

## Design Notes

- Use the webhook data rather than fetching: it costs no API call, and it is still fresh when a bulk edit triggers hundreds of events. Fall back to fetching only when the data is unreadable. Ordering comes from the product's `updated_at`, falling back to the envelope `created_at`.
- `visible` is added to the visible set because hiding a product in Salla must drop it from the storefront.
- A disconnected store (Story 2.7) still applies webhook data, since there is no token use on the happy path.

## Verification

**Commands:**
- `pnpm -C packages/contracts test && pnpm -C apps/api exec tsc --noEmit` -- expected: pass.
- Live DB tests on Docker port 5436 (temporarily switch the URLs from 5433, then switch back): `pnpm -C apps/api exec vitest run src/composition src/adapters/salla src/worker` -- expected: pass.
- `pnpm turbo run lint typecheck` -- expected: pass.

## Auto Run Result

Follow-up review pass on Story 2.4 (baseline `6131147a7cde2dc125312db48c74fc7ec15fdf36`), four reviewer layers: blind hunter, edge-case hunter, verification gap, intent alignment.

**Summary:** Four small patches. Product webhooks now take category locks before the product row, the same order as a full-sync page, which removes a webhook/sync deadlock. The applied log carries `store_id`. A misleading handler comment is fixed. A test now covers events for name, image and required-options changes.

**Files changed:**
- `apps/api/src/modules/catalog/product-webhooks.ts` -- categories upserted before `applyProduct`; `store_id` in the applied log.
- `apps/api/src/worker/catalog-jobs.ts` -- the comment names the event's real consumers (Story 3.4, Epic 4).
- `apps/api/src/composition/product-webhooks.test.ts` -- new test for `changed: ['name']`, `['image_url']`, `['has_required_options']`.

**Review findings:** 41 findings. Patches applied: 4 (medium 1, low 3). Carried patches (applied in the earlier pass, not re-patched): 2. Deferred: 1 new (epic-context rewrite, plus its grouped intent row), 2 carried. Rejected: every other row, each with its reason in the Review Triage Log above.

**Follow-up review recommended:** false. This was a follow-up pass and it patched no `high` finding (patched: high 0, medium 1, low 3).

**Verification:** `pnpm -C apps/api exec vitest run src/composition/product-webhooks.test.ts src/composition/catalog.test.ts` passed (69 tests, live DB on 5433). `pnpm turbo run lint typecheck test build` passed (26 of 26 tasks).

**Residual risks:** Category upserts within one webhook and one sync page can still lock several categories in different orders, so a deadlock remains possible but rarer (Postgres aborts one side and it retries). The epic-2-context.md cache is still lossy until recompiled. The Salla product payload shapes are still unverified against a live store.
