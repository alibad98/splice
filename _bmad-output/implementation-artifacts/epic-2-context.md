# Epic 2 Context: Product Catalog Sync

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The merchant's Salla products, prices and stock appear in Slips and stay in sync through the first-install import, near-real-time webhooks, manual sync, daily reconciliation, deletion handling and disconnection handling. The Products page lists them with category, price, linked content and availability. This catalog feeds the product picker, storefront product cards, manifest freshness and later attribution, so it must stay correct, tenant-isolated, PII-free and resilient to missed, duplicated or out-of-order Salla events.

## Stories

- Story 2.1: Import the full product catalog on first install
- Story 2.2: Browse products on the Products page
- Story 2.3: Sync products manually and see last sync time
- Story 2.4: Apply product webhooks in near real time
- Story 2.5: Handle products deleted in Salla
- Story 2.6: Reconcile the catalog daily
- Story 2.7: Pause sync when disconnected and resume on reconnect

## Requirements & Constraints

- Synced fields: name, image, category, price, sale price, `tax_inclusive`, currency, availability, required-options flag. Merchant sees the last sync time (store time zone, default Asia/Riyadh).
- Availability bucket: stock 0 = Out of stock, 1-5 = Low, more than 5 = Available. Stored only by `catalog`; no client ever recomputes it.
- Freshness: a webhook change is applied within 1 minute of receipt (part of the 2-minute P95 price/stock-to-storefront bound). On add to cart Salla's price governs.
- Integrity: reconciliation runs at least every 24 hours per active store and back-fills missed products. Out-of-order webhooks never overwrite newer data. A repeated Salla event ID is a no-op. Webhooks are verified and idempotent.
- Deletion: a product deleted in Salla is soft-deleted (tombstone `deleted_at`, never a cascading FK delete), excluded by default from the Products page and the product picker, and its deletion must lead linked content to leave the storefront and be flagged "Linked product deleted" (consumers in Epics 3 and 4). Recreating the same external ID clears the tombstone.
- Lost access: store goes `disconnected`; sync pauses (jobs skip with reason `disconnected`), storefront keeps serving last data, a reconnect path is offered, and reconnect enqueues a full sync immediately. `disconnected` and `uninstalled` stores are skipped by schedules. Reinstall within the 30-day grace keeps the same product rows and triggers a full sync.
- Plan never limits product count; catalog reads no billing entitlements (`content` is the only limit decision point; non-`live` stores skip enforcement).
- Failed jobs retry automatically, then surface as `failed` with a reason code (exposed through `catalog`'s service) and a merchant retry action. Failure of one store never affects others.
- Manual sync: at most once per 60 s per store; single-flight (a second request while running returns the running job).
- Privacy/security: no shopper PII, tokens or secrets in DB rows, logs or job payloads; raw webhook bodies are never persisted, enqueued or logged.
- Retention: `webhook_inbox` 30 days; pg-boss archive 7 days; app logs 30 days. Catalog data is exported on request and purged after uninstall grace.

## Technical Decisions

- **Ownership:** `catalog` owns `products` and `categories` (declared in the ownership map; a test fails on undeclared owners). Only the owner writes. Others read via `catalog` service batch reads (never N+1) or domain events. No cross-module SQL joins outside analytics rollups; no cascading FKs across modules.
- **Tenant isolation:** non-null `store_id` on every table; `StoreScoped` repository base; Postgres RLS on `app.store_id` that fails closed, with `FORCE ROW LEVEL SECURITY`, set only via the one lint-enforced `SET LOCAL` helper; workers set store context per job; one cross-tenant test per table.
- **Platform access:** domain code depends only on the `CommercePlatform` port, never on Salla SDKs/types; domain modules never import adapters (lint-enforced). Rows carry `(platform, external_id)` and `source_updated_at`; primary keys are UUIDv7. The Salla adapter paces per store and honours `Retry-After`. Tokens come only from `integration.getAccessToken(storeId)`; catalog never refreshes tokens (refresh is single-flight in `integration`; definitive failure moves the store to `disconnected`).
- **Background work:** only in the worker via pg-boss; HTTP handlers never do long work inline. Full sync (`catalog.full-sync`) and reconcile (`catalog.reconcile`) run on the `batch` queue; default retry policy 5 attempts, 30 s to 15 min backoff, set in the single queue-policy file. Queue names `<module>.<job>`. Job payloads are Zod-versioned (`v`, current + previous accepted) and carry `trace_id` and `store_id`. Stale-install-epoch work is dropped.
- **Webhooks:** Epic 1 verifies `X-Salla-Signature` and stores only the canonical PII-free payload in `webhook_inbox` (unique on Salla event ID); `salla.*` inbox types stay inside `integration`. Catalog handlers process per store, serialized, with guarded writes (`WHERE source_updated_at < new`); skipped stale writes are counted in a metric. Exhausted retries dead-letter the row and alert via telemetry; reconciliation repairs.
- **Domain events:** emitted through the transactional outbox in the same DB transaction as the write; consumed only by the worker; handlers idempotent on event ID; no in-process cross-module emitters (lint). Names `<module>.<entity>.<past-verb>`, with schema and owner catalogued in `packages/contracts`. Catalog events: `catalog.sync.completed` (created/updated counts), `catalog.product.updated` (only when a manifest-visible field changes: price, sale price, availability bucket, name, image, required-options flag; description-only changes emit nothing; also on tombstone clear), `catalog.product.deleted` with `(store_id, product_id)`. These feed `publishing`'s manifest recompile triggers.
- **Money and time:** integer minor units plus ISO 4217 currency code (exponent table in contracts), prices carry `tax_inclusive`; timestamps are UTC `timestamptz`.
- **API and contracts:** all wire shapes are hand-written Zod v1 schemas in `packages/contracts` (strict API input, additive-only within v1). Paths `/v1/<resource>` (e.g. `POST /v1/catalog/sync`). Errors are RFC 9457 `application/problem+json` with a stable `type` slug (e.g. `sync-rate-limited`); the API returns no user-facing text. The dashboard reads data only via the API with per-module TanStack Query hooks and a query-key factory; Next.js never touches the DB.
- **Lifecycle:** catalog implements `StoreDataLifecycle`: export returns products and categories, restore keeps rows and triggers a full sync, purge deletes them after grace (part of the resumable orchestrated purge).
- **Observability:** pino JSON logs with `request_id`, `trace_id`, `store_id`, `job_id`; no PII, tokens or secrets. Reconcile logs a structured line plus metrics with created/updated/deleted/unchanged counts. Alerts (webhook failures, Salla API failures, queue depth/age) go through the telemetry module and map to runbooks. During a Salla outage sync pauses and manifests keep serving.
- **Testing:** Vitest units; API integration tests against real Postgres; Playwright for dashboard flows.

## UX & Interaction Patterns

- Products table: shadcn Table in Card, 56px rows with thumbnail; columns name, category, price, linked-content count, attributed orders, availability. Becomes a card list on `sm`, no horizontal page scroll, in RTL and LTR.
- Price: sale price when set, `Intl.NumberFormat` in store currency, Western digits, `tabular-nums`, wrapped in `<bdi>`. Merchant text `dir="auto"`; product names and numbers isolated.
- Availability: status chip with a text label, never colour alone ("Out of stock" / "نفد المخزون"). The reusable status-chip and data-table components live in `packages/ui` for Epic 3 reuse.
- Search debounced, matching Arabic or English names; category filter and search held in the URL via nuqs, restored by Back; filtered-empty shows a sentence and "Show all".
- States: syncing empty state with a link to Salla products; boneyard skeleton of 6 rows after 150 ms (no page spinners); inline error with Retry while the shell keeps working.
- Header: "Last synced {relative time}" plus secondary "Sync products" button (spinner, `aria-busy`, ignores repeat clicks). Final failure: action toast with "Retry" that never auto-dismisses; previous catalog stays shown.
- Disconnected: persistent in-flow danger banner on every dashboard page, "Your Salla connection dropped, so syncing paused. Reconnect to continue." / "انقطع الاتصال بسلة، فتوقفت المزامنة. أعد الربط لتكمل.", with last sync time and one "Reconnect" action; clears on reconnect.
- All copy in `ar` and `en` catalogs, Arabic drafted first in the friendly-coach voice (no emoji, no blame, one next step). Logical CSS properties only. WCAG 2.1 AA; status changes and errors announced via live regions.

## Cross-Story Dependencies

- Epic 1 provides: install lifecycle event (triggers 2.1), `webhook_inbox` transport and signature fixture (2.4), outbox/event transport, `integration.getAccessToken`, store lifecycle state, reconnect flow and `StoreDataLifecycle` hooks (2.7), app shell, tokens and toast region (2.2, 2.3).
- 2.1 creates the tables, sync state and last-sync time that 2.2, 2.3, 2.6 and 2.7 build on. 2.1's full sync only upserts, so products deleted in Salla stay visible until 2.5/2.6 handle them; offset paging can miss products, which 2.6 must catch.
- 2.4 sets the guarded-write, locking, dedup and event rules; 2.5 and 2.6 reuse that same write path rather than a parallel one.
- 2.5's deletion handling is invoked by both `product.deleted` webhooks and 2.6 reconciliation. Its `catalog.product.deleted` is consumed by `content` (Story 3.4, "Linked product deleted" flag) and `publishing` (Epic 4 manifest removal).
- 2.7 must make webhook-driven fetches for a disconnected store skip or park instead of retrying into dead-letter; reconciliation repairs after reconnect.
- `catalog.product.updated` drives Epic 4's storefront refresh (Story 4.6). Linked-content counts come from Epic 3 via `getLinkCountsByProductIds(storeId, ids)` (0 until then); attributed orders from Epic 6 ("—" until then).
- Later consumers: product picker and out-of-stock link warning (Epic 3), onboarding "products synced" step and Slips Admin sync state / last sync view (Epic 7).
