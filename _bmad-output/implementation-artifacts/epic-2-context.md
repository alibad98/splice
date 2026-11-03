# Epic 2 Context: Product Catalog Sync

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The merchant's Salla products, prices and stock appear in Slips and stay in sync through webhooks, manual sync, daily reconciliation and disconnection handling. The Products page lists them with category, price, linked content and availability. This catalog is the source of truth for the product picker, storefront product cards and later attribution, so it must stay correct, tenant-isolated and resilient to missed or out-of-order Salla events.

## Stories

- Story 2.1: Import the full product catalog on first install
- Story 2.2: Browse products on the Products page
- Story 2.3: Sync products manually and see last sync time
- Story 2.4: Apply product webhooks in near real time
- Story 2.5: Handle products deleted in Salla
- Story 2.6: Reconcile the catalog daily
- Story 2.7: Pause sync when disconnected and resume on reconnect

## Requirements & Constraints

- Synced product data: name, image, category, price including sale price, availability, required-options flag. Show the last sync time to the merchant.
- Availability buckets: Available, Low (5 or fewer in stock), Out of stock. The bucket is computed and stored by `catalog` only; clients never recompute it.
- Products page: shows category, price, linked-content count, attributed orders and availability. Supports filtering by category and searching by name (Arabic or English). Out-of-stock products read "Out of stock" and later disable CTAs.
- Freshness: Salla price or stock changes must reach Slips within 1 minute of webhook receipt (part of a 2-minute P95 storefront bound).
- Integrity: at least daily reconciliation back-fills missed products. Out-of-order webhooks never overwrite newer data. Duplicate deliveries are no-ops. A deleted product is tombstoned and flagged so linked content leaves the storefront.
- Lost access moves the store to Disconnected: sync pauses, a reconnect path is offered, and storefront content keeps serving last data. Reinstall within the 30-day grace restores data.
- Product count is never limited by plan, and catalog reads no billing entitlements (only `content` enforces limits).
- Failed sync jobs retry automatically, then surface as failed with a reason code and a retry action.
- Money is integer minor units plus currency code, with a `tax_inclusive` flag. Time is UTC `timestamptz`, displayed in the store time zone.

## Technical Decisions

- Ownership: `catalog` module owns `products` and `categories`. Only the owner writes. Other modules read via its service batch reads or domain events. No cascading FKs across modules; use soft delete (`deleted_at`) plus an event.
- Tenant isolation: non-null `store_id` on every table, `StoreScoped` repository, Postgres RLS on `app.store_id`, and a cross-tenant test per table.
- Platform access: domain code depends only on the `CommercePlatform` port. Rows carry `(platform, external_id)` and `source_updated_at`. The Salla adapter paces per store and honours `Retry-After`. Tokens come only from `integration.getAccessToken(storeId)`; catalog never refreshes tokens.
- Background work: runs in the worker via pg-boss. Full-sync and reconcile jobs use the batch queue, with the default retry policy of 5 attempts and 30 s to 15 min backoff. Manual sync is single-flight per store.
- Webhooks: verified and persisted by the Epic 1 `webhook_inbox` transport. Catalog handlers run per store, serialized, with guarded writes on `source_updated_at`. Dedup is on Salla event ID. Exhausted retries dead-letter the inbox row and alert, and reconciliation repairs.
- Events (transactional outbox, same tx, idempotent on event ID, named `<module>.<entity>.<past-verb>`): `catalog.sync.completed` (with created/updated counts), `catalog.product.updated` (only when a manifest-visible field changes: price, sale price, availability bucket, name, image, required-options flag; description-only changes emit nothing), `catalog.product.deleted`. Schemas and owner are catalogued in `packages/contracts`.
- API: `POST /v1/catalog/sync`, rate limited to one per 60 s. Errors use RFC 9457 problem+json with a stable `type` slug (for example `sync-rate-limited`). Localized text lives in the dashboard, not the API. Wire shapes are Zod v1 schemas in `packages/contracts`.
- Lifecycle: catalog implements `StoreDataLifecycle` (export products and categories, purge after grace, restore on reinstall keeping the same rows and triggering a full sync).
- Observability: structured logs with `store_id` and `trace_id`, plus metrics for skipped stale writes and reconcile counts (created, updated, deleted, unchanged). Alerts go through the telemetry module.

## UX & Interaction Patterns

- Products table: shadcn Table in Card, 56px rows with thumbnail. Sale price shown when set, via `Intl.NumberFormat` in store currency with Western digits, `tabular-nums`, wrapped in `<bdi>`. Becomes a card list on `sm` with no horizontal page scroll, in RTL and LTR.
- Availability uses status-chip tokens with a text label, never colour alone. Story 2.2 builds the reusable status-chip and data-table components in `packages/ui`, which Epic 3 reuses.
- Filters and search are debounced and held in the URL via nuqs; back restores them. A filtered-empty result shows a sentence plus "Show all". The syncing empty state links to Salla products. Loading uses a boneyard skeleton of 6 rows after 150 ms. Errors are inline with Retry while the shell keeps working.
- Linked-content count uses the batch shape `getLinkCountsByProductIds(storeId, ids)` (no N+1) and shows 0 until Epic 3. Attributed orders show "—" until Epic 6.
- Header shows "Last synced {relative time}" and a secondary "Sync products" button: spinner plus `aria-busy`, ignores extra clicks. Failure shows a never-auto-dismissing action toast with Retry, and the previous catalog stays visible.
- Disconnected: persistent in-flow danger banner on every page with last sync time and a "Reconnect" action; it clears on reconnect. Copy is Arabic first, friendly-coach tone, with one next step.
- All copy is in `ar` and `en` catalogs. Use logical CSS properties only, and `<bdi>` isolates for numbers and product names.

## Cross-Story Dependencies

- Depends on Epic 1: install lifecycle events (2.1), the `webhook_inbox` transport and the signature-verification fixture (2.4), the outbox and event transport, `integration.getAccessToken`, store lifecycle state and the Reconnect flow (2.7), and the app shell and tokens (2.2).
- Story 2.1 creates the tables and the sync-state and last-sync fields. Stories 2.2, 2.3, 2.6 and 2.7 build on them.
- Story 2.4 sets the guarded-write and event rules that Stories 2.5 and 2.6 reuse.
- Story 2.5 emits `catalog.product.deleted`, consumed later by `content` (Story 3.4) and `publishing` (Epic 4).
- Story 2.4's `catalog.product.updated` feeds manifest recompilation in Epic 4 (Story 4.6 refreshes the storefront on price and stock changes).
- Story 2.2 depends on later epics for linked-content counts (Epic 3) and attributed orders (Epic 6), and uses placeholders until then.
