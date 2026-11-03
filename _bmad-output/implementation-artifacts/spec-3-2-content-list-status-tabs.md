---
title: 'Story 3.2: list and filter content with status tabs'
type: 'feature'
created: '2026-11-04'
status: 'done'
route: 'dispatch'
baseline_commit: 'b24bf2238426e9bea1e7e77a6a176a7b6c0bfe66'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/content` ("Videos & Stories") is a placeholder. Merchants cannot see or find their Stories and Reels, and there is no API to list them.

**Approach:** Add `GET /v1/content` (tab, search, sort, page, plus per-tab counts in one response) and replace the placeholder with a `ContentView` that copies the Products page (DataTable, nuqs, boneyard skeleton, inline Retry), with one StatusChip per status.

## Boundaries & Constraints

**Always:**
- Tabs (contracts `CONTENT_TABS`): `all` = every non-deleted status; `published`; `scheduled`; `drafts` = draft, processing, failed. Archived, deactivated and ended appear only under `all`. Deleted (`deleted_at`) never appear.
- Counts for all four tabs come back with every list response and ignore the search and the page, so tab badges stay stable while searching.
- URL state via nuqs: `?tab=&q=&sort=&page=&size=`, defaults cleared (`tab=all`, `sort=-updated`, `page=1`, `size=10`). Search debounced, `history: 'replace'`; tab, sort and page push. Changing tab or search resets page.
- Columns: thumb (9:16), title (`dir="auto"`), format, placement, status chip, views, clicks, row menu. Views and clicks render "—" (Epic 6).
- Chips per DESIGN.md: draft neutral; processing info + pulsing dot (static under `prefers-reduced-motion`); failed danger + 6% destructive row tint; scheduled info; published success; ended outline, no dot; archived outline + archive icon, no dot; deactivated warning. Text label always.
- States: no content at all → friendly-coach sentence ("Nothing here yet. Start with a short Story for your best seller.") with one amber "Create your first story" action; an empty tab → "No {Tab} items" + "Show all"; empty search → same filtered-empty; loading → 6-row boneyard skeleton after 150 ms; API failure → inline `role="alert"` with Retry.
- All copy in `ar` and `en` (Arabic first, friendly-coach voice); logical CSS only.
- Sort keys (contracts `CONTENT_SORTS`): `-updated` (default), `updated`, `title`, `-title`. Page sizes reuse 10/25/50. Search matches title, case-insensitive, max 100 chars.
- Session required; RLS scopes rows to the store. Bad query → 400 `invalid_query`.

- Decisions (2026-11-04, Ali):
  - **Row menu = Archive + Delete now.** Archive calls `POST /v1/content/:id/archive` and shows the toast "Archived. Undo available" whose Undo (never auto-dismisses) calls `/undo-archive`. Delete opens a confirm dialog naming the item, then `DELETE /v1/content/:id`. Both invalidate the list and counts; a 409/404 shows an error toast and refetches. Edit/Duplicate come in 3.3/3.13. Archived rows show no Archive item.
  - **Editor placeholders.** Add `/content/new` and `/content/[id]` as placeholder pages ("The editor is coming soon"); rows link to `/content/{id}`, "Create your first story" links to `/content/new`. Story 3.3 replaces them.
  - **Placeholders for missing data.** Thumb = format icon in a 9:16 muted box; placement "—"; failed chip without reason; scheduled chip without date. Later stories fill them.

**Never:** Build the editor form, duplicate, or slide/product/placement data (3.3–3.13, Epic 4). Add schedule or failure-reason columns. Write `content_items` outside `content-lifecycle.ts` (guard test). Recompute status client-side.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tab filter | 1 each of 8 statuses + 1 deleted; `tab=drafts` | items = draft, processing, failed; counts all 8, published 1, scheduled 1, drafts 3 | — |
| Search | `q=SALE` with titles "Summer sale", "Reel" | only "Summer sale"; counts unchanged | `q` > 100 chars → 400 `invalid_query` |
| Sort + page | 12 items, `sort=title&page=2&page_size=10` | items 11–12 by title, `total` 12 | page past end → empty items, same total |
| Cross-store | store B session | never sees store A rows or counts | — |
| Bad tab | `tab=archived` | — | 400 `invalid_query` |
| UI empty | counts.all = 0 | coach sentence + one "Create your first story" | — |
| UI filtered empty | tab scheduled, 0 items, all > 0 | "No Scheduled items" + "Show all" (→ tab all, q cleared) | — |
| UI error | list query fails | inline alert + Retry refetches; stale table kept if present | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/content.ts` -- add `CONTENT_TABS`, `TAB_STATUSES` map, `CONTENT_SORTS`, `ContentListQuery` (model: `ProductListQuery`, catalog.ts:18), `ContentListResponse` `{ v:1, total, page, page_size, counts:{all,published,scheduled,drafts}, items: ContentItem[] }` (model: `ProductListResponse`, catalog.ts:53). Reuse `PRODUCT_PAGE_SIZES`/`isProductPageSize` logic (copy constants as `CONTENT_PAGE_SIZES`). Export from `v1/index.ts`, `src/index.ts`.
- `apps/api/src/modules/content/content.repository.ts` -- add `list(storeId, {statuses, search, sort, limit, offset})` and `countByTab(storeId)` (one `count(*) filter (where status in …)` query). Model: catalog.repository.ts:368-393 (count, early return past end, order by primary then id). Reads only; guard allows reads inside the module.
- `apps/api/src/modules/content/content.controller.ts` -- `@Get('content')` before `@Get('content/:id')`; `ContentListQuery.safeParse`, `withStoreContext`, map rows with `toContentItem`. Model: catalog.controller.ts:18-48.
- `apps/api/src/docs/openapi.ts` (~line 79 registry, ~235 routes) -- `ContentPage` schema + GET entry; openapi.test.ts enumerates routes.
- `apps/dashboard/lib/api/content.ts` (new) -- `useContentList(query)` with `keepPreviousData`, session-gated; `contentPath(query)` omits defaults. Model: `lib/api/catalog.ts`. Add `queryKeys.content.*` in `lib/api/query-keys.ts`.
- `apps/dashboard/components/content/` (new) -- `url-state.ts`, `ContentView.tsx`, `ContentTabs.tsx`, `ContentTable.tsx`, `ContentStates.tsx`, `ContentStatusChip.tsx`, `content.test.tsx`. Copy `components/products/*` (ProductsView, ProductFilters debounce 22-38, ProductStates `useDelayed`/skeleton/error). Tabs from `@slips/ui` `Tabs`; counts in the trigger.
- `packages/ui/src/data-table.tsx` -- add optional `onRowActivate(row)` (click + `Enter` on a focusable row, `tabIndex=0`) and `rowClassName(row)` (failed tint). Update gallery `apps/dashboard/app/(dev)/ui/Gallery.tsx` and registry `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md` (line ~62).
- `packages/ui/src/status-chip.tsx` -- add `variant?: 'soft' | 'outline'` and `icon?: ReactNode` for ended/archived; respect reduced motion on `pulse` (check badge.tsx).
- `apps/dashboard/app/(merchant)/content/new/page.tsx`, `content/[id]/page.tsx` (new) -- placeholder pages via `components/Placeholder.tsx`.
- Row menu: `DropdownMenu`, `AlertDialog` and toast from `@slips/ui` (`toast.tsx`; usage example `components/products/SyncHeader.tsx`). Mutations `useArchiveContent`/`useUndoArchiveContent`/`useDeleteContent` in `lib/api/content.ts` via `postJson` plus a delete helper in `lib/api/fetch.ts` if missing; invalidate `queryKeys.content`.
- `apps/dashboard/app/(merchant)/content/page.tsx` -- replace `<Placeholder/>` with `<Suspense><ContentView/></Suspense>` like products/page.tsx.
- `apps/dashboard/i18n/messages/{en,ar}.ts` -- new `content` group (title, tabs, columns, statuses, formats, empty, filteredEmpty, error, loading); parity test `lib/i18n-guards.test.ts`.
- `apps/api/src/composition/content.test.ts` -- list matrix rows (live DB).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/v1/content.ts` + test -- tabs, sorts, list query/response -- shared shape.
- [x] `content.repository.ts`, `content.controller.ts`, `openapi.ts` (+ tests) -- list route with counts.
- [x] `composition/content.test.ts` -- API matrix rows.
- [x] `packages/ui` data-table + status-chip (+ `components.test.tsx`, gallery, registry) -- row activation, outline/icon chip.
- [x] `apps/dashboard` api hook, query keys, `components/content/*`, page, i18n -- the page.
- [x] `components/content/content.test.tsx` -- UI matrix rows, URL state, chips, skeleton delay, Enter opens row.

**Acceptance Criteria:**
- Given the page loads with content, then each row shows thumb, title, format, placement, chip, "—" views/clicks, and the tab triggers show counts.
- Given a row, when clicked or focused and `Enter` pressed, then `/content/{id}` opens.
- Given a row menu, when Archive is chosen, then the item moves to `archived`, counts update, and the Undo toast restores the prior status; when Delete is confirmed, then the row disappears.
- Given reduced motion, then the processing dot does not animate.
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- Sort: a "Sort by" Select offers all four `CONTENT_SORTS`; the Title header also sorts (`title`/`-title`). `-updated`/`updated` break ties by `id` in the same direction.
- Row menu hides Archive for any status outside contracts `ARCHIVABLE_STATUSES` (archived and processing), so the menu never offers a move the API would 409.
- `Placeholder` gained `variant="contentEditor"` for `/content/new` and `/content/[id]`.
- Filtered-empty copy: "No {Tab} items" on Published/Scheduled/Drafts; on All (only a search can empty it) "Nothing matches your search."
- Pagination labels reuse `messages.products.pagination` (generic copy).
- DataTable row activation ignores clicks on controls inside the row and events from portals (DOM containment check), so the row menu never opens the editor.

## Spec Change Log

## Review Triage Log

### 2026-11-04 — Review pass 1 (blind, edge, verification-gap)

- verdicts: 25 findings — medium 3, low 13, false 2, gap 6 (pre-verified), defer 1
- findings:
  - `[medium]` `[patch]` (blind, edge) A page past the end (hand-edited URL, archiving/deleting the last row of the last page) showed a false filtered-empty sentence. Fix: clamp to the last page.
  - `[medium]` `[patch]` (edge) Archive/undo used mutate-level callbacks on a shared `useMutation`; TanStack v5 runs them only for the latest call, so a quick second archive drops the first Undo toast. Fix: `mutateAsync` per call.
  - `[medium]` `[patch]` (verification-gap ×5) Untested: menu items must not open the editor; Delete 404 toast; Sort-by Select, Next and page-size URL writes; guard fixtures for in-module SQL delete and `MERGE INTO`. Fix: tests added.
  - `[low]` `[patch]` (blind, edge) Failed tint missing on the `sm` card list. Fix: tint the card.
  - `[low]` `[patch]` (edge) Search box could drop characters typed while the URL caught up to the debounced value. Fix: skip the reset when the URL equals the last committed term.
  - `[low]` `[patch]` (blind) Archive toast did not name the item; two Undo toasts were indistinguishable. Fix: title in the toast.
  - `[low]` `[patch]` (blind, verification-gap) `columnToSort` comment claimed a default-sort return. Fix: comment.
  - `[low]` `[patch]` (blind) Three Arabic strings in `content` were formal MSA. Fix: Gulf friendly-coach wording.
  - `[low]` `[patch]` (edge) Unformatted export line in contracts `v1/index.ts`. Fix: formatted.
  - `[maybe-false]` `[defer]` (verification-gap) The `placeholderEmpty` skeleton fallback after "Show all" is untested; needs a delayed fake fetch.
  - `[low]` `[reject]` (blind) Old tab's rows stay visible while the new tab loads (`keepPreviousData`); same as Products, `aria-busy` set, fetch is fast.
  - `[low]` `[reject]` (blind, edge) Focusable `<tr>` adds a tab stop; no Space, no modifier/middle click, text-selection drag navigates. The title `Link` covers new-tab and AT; guards add surface in the shared kit.
  - `[low]` `[reject]` (edge) Whitespace-only search writes `?q=%20`; the contract trims it, so no wrong results.
  - `[low]` `[reject]` (blind, edge) No sort/search index; `total`, rows and counts in three READ COMMITTED statements. Pilot scale; counts self-correct on the next fetch.
  - `[low]` `[reject]` (blind) No OpenAPI response example for `GET /v1/content`. Docs-only.
  - `[low]` `[reject]` (blind) Delete menu item has no icon. Cosmetic.
  - `[low]` `[reject]` (verification-gap) Case-insensitive title sort not pinned; not a spec rule.
  - `[false]` `[reject]` (blind) Spec `in-review` vs sprint `in-progress`: workflow states; sprint moves at the end of review.
  - `[false]` `[reject]` (blind) Empty triage/change logs despite 3.1 fixes in the diff: those are logged in the 3.1 spec (review pass 2).

## Verification

**Commands:**
- `pnpm -C packages/contracts test` -- pass.
- `pnpm -C packages/ui test` and `pnpm -C apps/dashboard test` -- pass.
- `pnpm -C apps/api exec vitest run src/composition/content.test.ts src/modules/content src/docs` (live DB on 5436, swap and revert) -- pass.
- `pnpm turbo run lint typecheck` -- pass.
