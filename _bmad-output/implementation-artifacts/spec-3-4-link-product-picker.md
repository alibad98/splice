---
title: 'Story 3.4: link a product with the product picker'
type: 'feature'
created: '2026-11-05'
status: 'in-review'
route: 'dispatch'
baseline_commit: '7a937a505d513d8cd8dd1ffe85c0c8a3b98a5560'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-create-story-reel-title-format-cta.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Content cannot be tied to a synced product, so the CTA cannot sell anything, and the Products page shows a stubbed linked-content count of 0.

**Approach:** Add a `content_product_links` table owned by `content`. A `product_id` editable field goes through `PATCH /v1/content/:id`, and `ContentItem` gets a `product` summary read through `CatalogService`. The editor gets a product picker built on a new kit `Combobox`. `getLinkCountsByProductIds` returns real counts. A `catalog.product.deleted` handler emits `content.item.edited` for each linked item.

## Boundaries & Constraints

**Always:**
- Picker: kit `Combobox` (Radix Popover from the installed `radix-ui`, ARIA combobox + listbox, arrows/Enter/Escape, `aria-activedescendant`). It searches `GET /v1/products?q=&page_size=10`, debounced 250 ms. Each option shows a 40px thumb (or a placeholder), name `dir="auto"`, price (`formatMoney`, tabular) and an availability chip. It shows "No products match" when empty, an inline Retry on error, and a Remove action to unlink. Deleted and hidden products never appear (the catalog list already excludes them).
- Linked out of stock: a warning alert says the CTA will show "Out of stock" until stock returns, and linking is still allowed. Required options: the preview's CTA reads "View options", and a note explains why.
- Linking or unlinking autosaves like other Draft fields and uses "Save changes" otherwise. The API checks the product through `CatalogService.getProductsByIds` and answers 422 `product-not-linkable` when it is unknown or deleted. The edit emits `content.item.edited` with `changed` containing `product_id`.
- `ContentItem.product`: `null` or `{ id, name, image_url, price_minor, sale_price_minor, currency, availability, has_required_options, deleted }`. `deleted` is read from the catalog tombstone, so a product re-created with the same id clears it automatically. One batched catalog read per list page and per item.
- Deleted linked product: the content list shows a warning chip "Linked product deleted" under the title, and the editor shows a warning alert with "Pick another product". The link row is kept so the flag shows. The `catalog.product.deleted` handler (idempotent through the dispatcher's `event_deliveries`) emits `content.item.edited` (`changed: ['product_id']`) for each linked, non-deleted item, and it writes `content_items` only through `content-lifecycle.ts`.
- `getLinkCountsByProductIds` counts links whose content item is not deleted.
- New table: non-null `store_id`, RLS `FORCE` + `tenant_isolation` policy, grants as in 0016, no FK to `products`, a cross-tenant test seed, and `ownership.ts` (already listed).
- All copy in `ar`/`en`; logical CSS only.
- Decision (2026-11-05, Ali): **one product per content item.** One picker in the editor; the link table is unique on (store_id, content_id), with a nullable `slide_id` column reserved for later per-slide links.

**Never:** Hard-delete links or products. Add an FK across modules. Read `products` with SQL from `content`. Build slides, placements or publishing (3.6+, Epic 4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Link | Draft, pick "Oud oil" | PATCH `{product_id}` → item.product set; "Saved"; Products page count 1 | — |
| Unlink | Remove | PATCH `{product_id: null}`; count 0 | — |
| Out of stock | availability `out_of_stock` | linked + warning shown | — |
| Required options | `has_required_options` true | preview CTA "View options" + note | — |
| Bad product | id of deleted / other store / unknown | — | 422 `product-not-linkable`, nothing written |
| Product deleted | event for a linked product | `content.item.edited` once per linked item; list chip + editor alert | redelivered event → no second emit |
| Re-created | tombstone cleared | `product.deleted` false, flag gone | — |
| Counts | 2 items link P, 1 of them deleted | count(P) = 1 | — |
| Keyboard | type, ArrowDown ×2, Enter | second option linked, focus back on input | Escape closes, keeps value |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/content.ts` + `migrations/0017_content_product_links.sql` (+ meta journal via `pnpm --filter @slips/db db:generate`). Columns: id, store_id, content_id, product_id, slide_id (nullable uuid, unused until slides), created_at; unique (store_id, content_id); index (store_id, product_id). RLS pattern from 0016. Add the seed to `TENANT_TABLES` in `packages/db/src/schema/content.test.ts`.
- `packages/contracts/src/v1/catalog.ts` -- `ProductRow` (l.33) gains `has_required_options`; the API maps it.
- `packages/contracts/src/v1/content.ts` -- `ContentFields.product_id` (uuid, nullable, optional; create and update), `ContentProductSummary`, `ContentItem.product`, `CONTENT_PRODUCT_NOT_LINKABLE`. `content.item.edited.changed` follows `ContentFields.keyof()`, so it accepts `product_id` automatically.
- `apps/api/src/modules/catalog/catalog.service.ts` -- add `getProductsByIds(storeId, ids)`, which includes tombstones and returns `deleted`. The catalog module already imports content, so use `forwardRef` on both sides.
- `apps/api/src/modules/content/content-lifecycle.ts` -- `create`/`edit` upsert or delete the link row when `product_id` is sent; extend `status-guard.test.ts` so `content_product_links` writes stay in this file. Add `content.repository.ts` reads for links and counts.
- `content.service.ts:9` -- replace the stub `getLinkCountsByProductIds` with one grouped query that joins non-deleted items.
- `content.controller.ts` -- validate `product_id` through the catalog before the write (422). `toContentItem` takes a product summary map; list/get/create/edit attach `product`. Update the OpenAPI docs and test.
- `apps/api/src/worker/content-jobs.ts` -- `registry.on('catalog.product.deleted', 'content.flag-linked-product-deleted', …)`: find linked live items and emit `content.item.edited` through a new lifecycle method `notifyLinkedProductDeleted(tx, storeId, productId)`. The worker dispatcher already sets the store context.
- `packages/ui/src/combobox.tsx` (new) + test + gallery entry; set the registry row (Combobox, Popover) to `built (Story 3.4)`.
- `apps/dashboard/components/content/editor/ProductCard.tsx` (new) -- picker, linked product row (thumb, name, price, chip, Change/Remove), and out-of-stock/deleted alerts; `form.ts` adds `product_id`; `PreviewPlaceholder.tsx` shows "View options". Reuse `formatMoney` and the availability chip from `components/products/*`.
- `lib/api/catalog.ts` -- `useProductSearch(q)` (enabled when the picker is open, `keepPreviousData`).
- `components/content/ContentTable.tsx` -- warning chip under the title when `product?.deleted`.
- `i18n/messages/{en,ar}.ts` -- `content.editor.product` and `content.flags`.
- Tests: `composition/content.test.ts` (matrix API rows, the event handler with redelivery, counts on `GET /v1/products`), `editor.test.tsx` (picker keyboard, link/unlink autosave, warnings, View options, deleted alert), `content.test.tsx` (list chip).

## Tasks & Acceptance

**Execution:**
- [x] db: schema, migration, RLS, cross-tenant seed.
- [x] contracts: ProductRow flag, product_id, product summary, problem slug (+ tests).
- [x] API: catalog `getProductsByIds`, lifecycle link writes, controller validation and `product`, real counts, event handler, guard, OpenAPI (+ tests).
- [x] `packages/ui` Combobox (+ test, gallery, registry).
- [x] dashboard: product search hook, ProductCard, form/preview, list chip, i18n (+ tests).

**Acceptance Criteria:**
- Given the Products page, when a product has linked live content, then its linked-content count is the real number.
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- **Unlink keeps the row.** The Code Map said "upsert or delete the link row", but the frozen Never forbids hard-deleting links, so `content_product_links.product_id` is nullable and unlinking sets it to `null` (one row per item, upserted on `(store_id, content_id)`). Only the uninstall purge (`content.lifecycle.ts`) deletes link rows; it purges links before items, and the export now includes `content_product_links`. The guard test (`status-guard.test.ts`) enforces this: writes only in `content-lifecycle.ts`, deletes only in the purge, no references outside `modules/content`.
- No FK from `content_product_links.content_id` to `content_items` (keeps the batched purge simple); no FK to `products` (cross-module).
- `ContentLifecycle.notifyLinkedProductDeleted` only emits `content.item.edited` (`changed: ['product_id']`) per linked live item; it writes no `content_items` row, so `updated_at` does not move. The handler id is `content.flag-linked-product-deleted`; the catalog's logging handler for the same event stays.
- The API accepts linking a hidden (`visible = false`) product that is not deleted: the spec's 422 covers unknown and deleted only. The picker never shows hidden products. A link whose product the catalog no longer returns at all reads `product: null`.
- Catalog and content modules import each other through `forwardRef` (module imports and the two controller injections).
- "View options" shows in the preview only when the action is Add to cart and the product is not deleted.
- The picker input stays on screen when a product is linked, so focus can return to it after Enter (I/O matrix); the linked row below it has Change (focuses and opens the picker) and Remove (focuses the picker). A 422 `product-not-linkable` on save shows a toast and refetches the item.
- `POST /v1/content` from the editor now always sends `product_id` (`null` when none). Saves that send `product_id` also invalidate the catalog product queries, so the Products page count refreshes.
- Registry: Combobox is `built (Story 3.4)`. Popover is only built inside Combobox (no standalone `Popover` export yet); its row says so.
- Known gap: the catalog check runs before the write transaction, so a product deleted between the check and the write can still be linked. The item then reads `deleted: true` and the list chip shows, but no `content.item.edited` is emitted for that link unless the deletion event is processed after the write.

## Spec Change Log

## Review Triage Log

## Verification

Ran 2026-11-05: contracts 68, ui 95, dashboard 282, db 51 (on 5436), API 483 (full suite on 5436, migration applied by the tests) -- all pass. `pnpm turbo run lint typecheck build --continue`: 18/19, only `@slips/player#build` fails (known Windows path bug).


**Commands:**
- `pnpm -C packages/contracts test`, `pnpm -C packages/ui test`, `pnpm -C apps/dashboard test`, `pnpm -C packages/db test` -- pass.
- API suite on the Docker DB at 5436 (swap `127.0.0.1:5433` → `5436` in test files, run `pnpm -C apps/api exec vitest run`, swap back) -- pass. Apply the migration to that DB first.
- `pnpm turbo run lint typecheck build` -- pass except `@slips/player#build`.
