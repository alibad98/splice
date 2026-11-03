---
title: 'Story 2.2: Browse products on the Products page'
type: 'feature'
created: '2026-11-01'
status: 'done'
route: 'dispatch'
baseline_commit: 'd90fabf9b63f8834e301251a9d32f65acb2e8f7f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.1 imports the catalog, but the merchant cannot see it: `/products` is a "Coming soon" placeholder.

**Approach:** A store-scoped `GET /v1/products` (search, category filter, sort, page) plus `GET /v1/catalog/sync` and `GET /v1/products/categories`, all read through `CatalogService`. The dashboard renders them on `/products` with TanStack Query, nuqs URL state and new reusable `DataTable` and `StatusChip` components in `packages/ui`.

## Boundaries & Constraints

**Always:** Read only through `CatalogService` + `withStoreContext` (RLS). Linked-content counts come from one batch call `ContentService.getLinkCountsByProductIds(storeId, ids)` (stub returning 0 for every id; no N+1). Attributed orders render "—". Response shapes are Zod `v1` schemas in `contracts`; money stays integer minor units + currency on the wire and the dashboard formats it with `formatCurrency` (sale price when set). Availability chip label comes from the stored bucket. Prices in `<bdi>` with `tabular-nums`; product names `dir="auto"`; logical CSS only; all copy in `ar` and `en` (Arabic first). Search is debounced (300 ms) and matches `name` case-insensitively with LIKE wildcards escaped. `q`, `category`, `sort`, `page` live in the URL via nuqs.

**Never:** Recompute availability in the client; read `content`/`attribution` tables from `catalog`; fetch per-row; add a migration; build manual sync or "Last synced" (Story 2.3); show products hidden in Salla (`visible = false`) — decided: excluded, the list matches what shoppers can buy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Products listed | 120 products | page 1 of 50 rows sorted by name; total 120 | — |
| Sale price | price 15000, sale 12000 SAR | shows 120 ر.س / SAR 120 | — |
| Availability | bucket available / low / out_of_stock | chip "Available" / "Low stock" / "Out of stock" (ar "متوفر" / "كمية قليلة" / "نفد المخزون") | — |
| Search | `q=عباية` or `q=abaya` | only matching names; URL has `q` | `%` and `_` treated literally |
| Category filter | `category=<external id>` | only products in that category | unknown id → empty result |
| Filtered empty | filters match nothing | sentence + "Show all" clears `q` and `category` | — |
| First sync running | 0 products, sync `running` or `never` | "Syncing your products..." empty state | — |
| Synced, none | 0 products, sync `succeeded` | empty state with link to Salla products | — |
| Slow load | request > 150 ms | 6-row boneyard skeleton | — |
| API failure | 5xx / network | inline error + Retry; shell still works | — |
| Other store | session of store B | never sees store A rows | RLS |
| Bad query | `page=0`, `sort=x`, `q` > 100 chars | 400 problem+json | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/catalog/catalog.service.ts`, `catalog.repository.ts` -- add `listProducts`, `listCategories`; reuse `getSyncState`. Filter `visible = true`, `category_external_ids @> {id}`, `name ILIKE`; count + page in one store-context transaction.
- `apps/api/src/modules/catalog/catalog.controller.ts` (new), `catalog.module.ts` -- routes; storeId from `req.merchantSession` (see `auth.controller.ts:44`); validate query with the contract schema.
- `apps/api/src/modules/content/content.service.ts`, `content.module.ts` (new) -- stub `getLinkCountsByProductIds`; register in `app.module.ts`. Note: when Story 3.4 makes `content` call `catalog`, use events or `forwardRef` to avoid a module cycle.
- `packages/contracts/src/v1/catalog.ts` (new) + `index.ts` -- `ProductListQuery`, `ProductListResponse`, `ProductRow`, `CategoryListResponse`, `CatalogSyncStatus`.
- `apps/api/src/composition/catalog.test.ts` -- add HTTP-level tests (pattern from `session.test.ts`).
- `packages/ui/src/` -- `cn.ts`, `card.tsx`, `table.tsx` (shadcn-style), `status-chip.tsx` (tones neutral/info/success/warning/danger, dot, text label), `data-table.tsx` (TanStack Table v9 wrapper: columns, sortable headers, row 56px, `sm` card-list render prop). Add react peer + tsx build, `clsx`, `tailwind-merge`, `@tanstack/react-table`. Tokens already in `styles/globals.css`.
- `apps/dashboard/app/(merchant)/layout.tsx` -- wrap with `QueryClientProvider` + `NuqsAdapter` (`nuqs/adapters/next/app`).
- `apps/dashboard/lib/api/` (new) -- `query-keys.ts` factory; `catalog.ts` hooks using `useSession().client.apiFetch` + contract parse.
- `apps/dashboard/app/(merchant)/products/page.tsx` + `components/products/` -- page, filters, table, empty/error states. Reuse `formatCurrency` (`i18n/format.ts`), `useI18n`.
- `apps/dashboard/i18n/messages/{ar,en}.ts` -- `products.*` strings.
- Do not change: catalog sync job, schema, shell nav.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/v1/catalog.ts` -- schemas + tests -- one wire shape for API and dashboard.
- [x] `apps/api/src/modules/content/*` -- stub batch link counts -- satisfies the no-N+1 call shape before Epic 3.
- [x] `apps/api/src/modules/catalog/*` -- repository queries, service, controller -- the read API.
- [x] `apps/api/src/composition/catalog.test.ts` -- matrix rows for API (paging, search incl. Arabic and wildcards, category, hidden excluded, sale price, cross-store, 400s, one link-count call).
- [x] `packages/ui/src/*` -- Card, Table, StatusChip, DataTable + unit tests -- reusable by Epic 3.
- [x] `apps/dashboard` deps + providers + `lib/api` -- data layer.
- [x] `apps/dashboard/app/(merchant)/products/*` + messages -- page with all states; component tests for chip labels, price formatting, empty/filtered/error states, URL state.

**Acceptance Criteria:**
- Given a store with synced products, when the merchant opens Products, then a Card-wrapped table shows thumbnail, name, category, price, linked content (0), attributed orders ("—") and availability, in RTL and LTR.
- Given the viewport is `sm`, when the page renders, then rows become cards with no horizontal page scroll.
- Given filters are set, when the merchant presses Back, then the previous filters and results return.
- Given `pnpm turbo run lint typecheck test build`, then all new code passes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

### 2026-11-01 -- blind-hunter, edge-case-hunter, verification-gap (3 subagents)

- `[medium]` `[patch]` Products stay empty after the first import finishes: when sync turns `succeeded`, ProductsView re-renders, the products `refetchInterval` turns off and nothing refetches the stale total-0 page (BH1, EC7) -- invalidate products and categories when sync leaves running/never.
- `[medium]` `[patch]` A failed `GET /v1/catalog/sync` shows "Syncing your products..." with no Retry (BH3, EC6) -- show the inline error with Retry.
- `[medium]` `[patch]` 3-decimal currencies (KWD, BHD, OMR) rounded to 2 decimals: `formatCurrency` caps fraction digits at 2 (EC4) -- format with the currency exponent.
- `[low]` `[patch]` "Show all" after filtered-empty briefly shows the store-empty/syncing state from the placeholder total 0 (EC5) -- ignore placeholder data when deciding "nothing yet".
- `[low]` `[patch]` Each debounced search pause pushes a history entry, so Back steps through partial terms (BH11) -- search writes with `replace`; category, sort, page keep `push`.
- `[medium]` `[patch]` Untested: search box follows an outside URL change (Show all/Back), first-import polling and the hook API paths, header click to descending, `failed` empty state, category change and Previous dropping `page` (VG1-5, BH10) -- add tests.
- `[medium]` `[defer]` Stores installed before 2.1 have sync `never` and show "Syncing" forever while polling every 5 s (BH2, EC8) -- matches the approved matrix; Story 2.3's manual sync gives them a way out.
- `[medium]` `[defer]` Arabic search does not fold letter variants or tashkeel (BH5) -- meets the spec's case-insensitive name match; normalization is a follow-up.
- `[low]` `[reject]` Page past the end says "No products match these filters" (BH4, EC12) -- only via a hand-edited URL or a shrinking catalog; "Show all" recovers.
- `[low]` `[reject]` count and page can disagree under a concurrent write (BH12, EC1) -- rare; the next fetch corrects it.
- `[low]` `[reject]` Categories with no visible products listed, 1000 cap, missing first category hides +N, URL category absent from the list, categories error silent (BH13, EC2, EC3, EC10, EC11) -- unlikely in practice; categories come from the products' own embedded categories.
- `[false]` `[reject]` Skeleton forever without a session (BH14, EC9) -- `SessionGate` renders children only when signed in (or with no provider).
- `[false]` `[reject]` Cards switch at `md`, not `sm` (BH6) -- the AC is about `sm`, which is covered.
- `[false]` `[reject]` proxy.ts change out of scope (BH7, VG other) -- separate redirect-loop fix, committed on its own.
- `[false]` `[reject]` 400 test lacks `type` (BH8) -- every problem response uses `about:blank` (pre-existing filter); `code` is the stable slug.
- `[false]` `[reject]` Leaked spy / unused `storeId` (BH9) -- the spy passes through to the stub; lint passes.
- `[false]` `[reject]` Spec bookkeeping out of sync (BH15) -- statuses advance per workflow step.
- `[false]` `[reject]` Tests hard-coded to 5433; RLS not tested separately by the reads (VG other) -- existing pattern; RLS on these tables is covered by the 2.1 cross-tenant test.

## Design Notes

- Category column: first category name joined from `categories` by external id (`+N` if more). Sort options: `name` (default), `price` (effective price), asc/desc via headers. Page size 50 with previous/next.
- Thumbnails: product images are square; use a 40×40 rounded-md `img` with `loading="lazy"` and an empty muted box when null (the 9:16 thumb is for content rows).

## Verification

**Commands:**
- `pnpm turbo run lint typecheck test build --continue` -- expected: all pass (live DB tests on the Docker DB at 5436 locally).

**Manual checks:**
- Run the dashboard with seeded products; check AR and EN, `sm` width, empty, filtered-empty and error states.
