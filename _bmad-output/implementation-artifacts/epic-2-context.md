# Epic 2 Context: Product Catalog Sync

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The merchant's Salla products, prices and stock appear in Slips and stay current through a first-install import, near-real-time webhooks, manual sync, daily reconciliation and clear handling of lost access. The Products page lets the merchant see what they can promote and what is out of stock. Every later epic (product picker, storefront manifest, player product card, attribution) reads this local, store-scoped catalog, so its correctness and freshness are foundational.

## Stories

- Story 2.1: Import the full product catalog on first install
- Story 2.2: Browse products on the Products page
- Story 2.3: Sync products manually and see last sync time
- Story 2.4: Apply product webhooks in near real time
- Story 2.5: Handle products deleted in Salla
- Story 2.6: Reconcile the catalog daily
- Story 2.7: Pause sync when disconnected and resume on reconnect

## Requirements & Constraints

- Synced fields: name, image, category, price incl. sale price, availability, required-options flag. Availability buckets: Available (>5), Low (1-5), Out of stock (0). The bucket is computed and stored only by `catalog`; no client recomputes it.
- Products page shows category, price, linked-content count, attributed orders and availability, with category filter and name search (Arabic or English). Out-of-stock products read "Out of stock" / "نفد المخزون".
- Freshness: Salla price/stock changes reach the storefront within 2 min P95 (1 min sync + 1 min cache). Out-of-order webhooks never overwrite newer data. Reconciliation runs at least daily and back-fills missed changes.
- Lost access moves the store to `disconnected`: sync pauses, storefront keeps last data, a persistent banner offers Reconnect; reconnect triggers an immediate full sync.
- Deleted products are soft-deleted (tombstone + event), excluded from Products page and picker by default.
- Product count is never limited by plan; catalog reads no billing data.
- Dashboard: interactive within 3 s on broadband; WCAG 2.1 AA; all copy in `ar`/`en`, Arabic first, friendly-coach voice.

## Technical Decisions

- Module ownership: `catalog` owns `products`, `categories`, `catalog_sync_state`. Only the owner writes; other modules read through `catalog`'s service batch reads or domain events; no cross-module FKs or joins (except analytics rollups).
- Tenant isolation: non-null `store_id`, Postgres RLS via the single store-context helper, `StoreScoped` repositories, a cross-tenant test per table.
- Platform access only through the `CommercePlatform` port; Salla field names live only in `adapters/salla`. Tokens only via `integration.getAccessToken(storeId)`.
- Background work in the worker via pg-boss (`<module>.<job>` queue names, AD-1 retry policy: 5 attempts, 30 s-15 min). HTTP handlers never do long work inline.
- Domain events through the transactional outbox, named `<module>.<entity>.<past-verb>`, schemas and owners catalogued in `packages/contracts`; handlers idempotent on event ID. Catalog emits product-change events only for manifest-visible fields (price, sale price, availability bucket, name, image, required-options flag).
- Webhooks: per-store serialized handling with guarded writes on `source_updated_at`.
- Wire shapes are hand-written Zod `v1` schemas in `packages/contracts`; API paths `/v1/<resource>`; errors are RFC 9457 problem+json with a stable `type` slug, localized only in the dashboard.
- Money: integer minor units + ISO 4217 code via the contracts exponent table; prices carry `tax_inclusive`.
- Dashboard data only via the API (Next.js never touches the DB), with per-module TanStack Query hooks and a query-key factory; URL state via nuqs; TanStack Table v9; boneyard skeletons; reusable components in `packages/ui`.

## UX & Interaction Patterns

- Products page lives at `/products` in the side nav. Data table: shadcn Table inside a Card, 56px rows with thumbnail, row hover muted, sortable headers, debounced search, filters in the URL (back button restores them); becomes a card list on `sm` with no horizontal page scroll.
- Status chips: pill, always with a text label, never colour alone; use status-chip tokens. Built once in `packages/ui` and reused by Epic 3's content table.
- Prices: `Intl.NumberFormat` in store currency, Western digits, `tabular-nums`, isolated in `<bdi>`; two decimals only when non-zero ("340 ر.س" in Arabic, "SAR 340" in English). Product names and numbers are bidi-isolated; merchant text `dir="auto"`; logical CSS properties only.
- States: boneyard skeleton (6 table rows) after 150 ms, no page spinners; inline per-block error with Retry while the shell keeps working; empty states "Syncing your products..." during first sync, and a link to Salla products when sync finished with none; filtered-empty shows a sentence and "Show all".
- Manual sync: header shows "Last synced {relative time}" in the store time zone and a secondary "Sync products" button with spinner + `aria-busy` and double-click prevention; failures show an action toast with Retry that never auto-dismisses.
- Disconnected: full-width in-flow danger banner on every page with last sync time and "Reconnect".

## Cross-Story Dependencies

- 2.2 depends on 2.1's tables and `CatalogService`; it reads linked-content counts through a batch call `getLinkCountsByProductIds(storeId, ids)` that returns 0 until Epic 3, and shows "—" for attributed orders until Epic 6.
- 2.3 adds the manual sync endpoint and surfaces 2.1's sync state and failures in the UI (also covers stores installed before 2.1 shipped).
- 2.4, 2.5, 2.6 share the guarded-write and event rules; 2.5's deletion is reused by 2.6's reconciliation.
- 2.7 depends on Epic 1's `integration` lifecycle states and the banner component.
- Epic 3 reuses the data-table and status-chip components and the product picker reads the catalog; Epic 4's manifest compiler consumes `catalog.product.*` events.
