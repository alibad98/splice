---
title: 'Story 3.1: model content items and their status lifecycle'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
baseline_revision: 'f2abc997a78aaf9ef97c4847a0f39a43d236b9d8'
baseline_commit: 'f2abc997a78aaf9ef97c4847a0f39a43d236b9d8'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Content has no model yet. Before anything can be created, listed, processed, published or billed, there must be one place that owns a content item and decides which status changes are legal. Without it, the dashboard, the media pipeline and the storefront would drift apart.

**Approach:** Add `content_items` (owned by `content`, tenant-isolated) and a status transition table in `packages/contracts`. A single `ContentLifecycle` command service in the `content` module applies every status change: it checks the table, writes, and emits `content.item.<verb>` in the same transaction. Other modules (media, billing) call it, and a test proves nobody else writes the status. A thin merchant API exposes create, read, archive, undo-archive, restore and delete. Disallowed moves answer RFC 9457 `invalid-transition`.

## Boundaries & Constraints

**Always:**
- Statuses (contracts `CONTENT_STATUSES`): `draft`, `processing`, `failed`, `scheduled`, `published`, `ended`, `archived`, `deactivated`. No `ready`.
- Transition table (contracts `CONTENT_TRANSITIONS`: action, allowed from, to, event verb). `*` = any non-deleted status not listed as excluded:

  | action | from | to | event |
  |---|---|---|---|
  | create | — | draft | `content.item.created` |
  | start_processing | draft, failed | processing | `content.item.processing_started` |
  | finish_processing | processing | draft | `content.item.processed` |
  | fail_processing | processing | failed | `content.item.processing_failed` |
  | publish | draft | published | `content.item.published` |
  | schedule | draft | scheduled | `content.item.scheduled` |
  | go_live | scheduled | published | `content.item.published` |
  | end | published, scheduled | ended | `content.item.ended` |
  | deactivate | published, scheduled | deactivated | `content.item.deactivated` |
  | reactivate | deactivated | the status it was deactivated from (`reactivate_to`) | `content.item.reactivated` |
  | archive | * except processing, archived | archived | `content.item.archived` |
  | undo_archive | archived | the status it was archived from | `content.item.unarchived` |
  | restore | archived | draft | `content.item.restored` |
  | delete | * (any non-deleted) | tombstone (`deleted_at`) | `content.item.deleted` |

- Decisions (2026-11-03, Ali): **no Unpublish**. A merchant takes content off the storefront with Archive; Undo returns it to its previous status and Restore returns it to Draft. **Reactivate returns an item to the status it was deactivated from** (`published` or `scheduled`, stored in `reactivate_to`), so content comes back by itself after an upgrade.

- Every event payload is `{ v:1, store_id, content_id, from, to }` (`deleted` carries `from` only). Events are catalogued in contracts with owner `content`.
- `first_published_at` is set on the first transition into `published` and never changes after that. `archived` stores `archived_from` so that `undo_archive` can return to it.
- The status changes only through `ContentLifecycle.apply(tx, storeId, contentId, action)`. It locks the row (`for update`), validates the move against the table, writes, and publishes in the caller's transaction. A disallowed move throws `InvalidTransitionError`, the HTTP layer maps it to 409 problem `invalid-transition`, and nothing changes. A deleted or unknown item is a 404.
- A guard test fails if any file outside `apps/api/src/modules/content/` updates or inserts `content_items` (SQL text or the drizzle `contentItems` table).
- Merchant API (session required; another store's item is a 404): `POST /v1/content` creates a draft (`title`, `format`, `cta`); `GET /v1/content/:id`; `POST /v1/content/:id/archive`, `/undo-archive`, `/restore`; `DELETE /v1/content/:id`. Publish, schedule, processing and billing actions have no HTTP route in this story.
- CTA fields: `cta_label` (1–40 chars), `cta_action` (`add_to_cart` | `open_product` | `open_link`), `cta_url` (only and required for `open_link`; checking it against the store's domain is Story 3.3), `cta_style` (nullable text). Title is 1–80 chars, stored as given. Format is `story` | `reel`.

**Never:** Add list or editor UI (Stories 3.2 and 3.3). Add slides, product links, placements or schedule jobs. Check publish eligibility (Epic 4 and 3.9). Hard-delete rows. Let any module other than `content` write `content_items`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create | `POST /v1/content` valid body | 201 item `draft`, UUIDv7 id; `content.item.created` | invalid body → 400 `invalid_body` |
| Allowed move | `archive` on a `published` item | `archived`, `archived_from=published`; `content.item.archived` same tx | — |
| Undo archive | `undo-archive` on an item archived from `published` | back to `published`; `content.item.unarchived` | — |
| Restore | `restore` on `archived` | `draft` | — |
| Disallowed | `restore` on `draft`; `archive` on `processing` | 409 problem `type: invalid-transition`; row and outbox unchanged | — |
| First publish | `publish` then `end`, `reactivate`, `publish` again | `first_published_at` set once, never moved | — |
| Delete | `DELETE` on any non-deleted item | `deleted_at` set, row kept; `content.item.deleted`; later GET → 404 | delete twice → 404 |
| Cross-store | store B session, store A item id | 404 | — |
| Rollback | transition whose tx rolls back | neither status nor event persisted | — |
| Guard | a file outside `modules/content` writes `content_items` | guard test fails | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/content.ts` (new; export from `v1/index.ts` and `src/index.ts`) -- `CONTENT_STATUSES`, `CONTENT_FORMATS`, `CTA_ACTIONS`, `CONTENT_ACTIONS`, `CONTENT_TRANSITIONS` plus `canTransition(from, action)`, `CONTENT_INVALID_TRANSITION = 'invalid-transition'` (like `CATALOG_SYNC_RATE_LIMITED`, catalog.ts:73), `ContentCreateInput` (strict) and the `ContentItem` response schema. Test file `content.test.ts`.
- `packages/contracts/src/v1/events.ts` (+ test) -- the content events above via `defineEvent('content', ...)`. Pattern check: `EVENT_NAME_PATTERN` line 9.
- `packages/db/src/schema/content.ts` (new; add to `schema/index.ts`) -- `contentItems`, modelled on `schema/catalog.ts` (`ts()` helper, text plus `$type` enums, `deletedAt`). Columns: `id`, `store_id`, `title`, `format`, `cta_label`, `cta_action`, `cta_url`, `cta_style`, `status`, `archived_from`, `reactivate_to`, `auto_publish` (bool, default false), `first_published_at`, `deleted_at`, `created_at`, `updated_at`. CHECK constraints for format, status and CTA action, and `cta_url` required iff `open_link`. Index on `(store_id, status) where deleted_at is null`. The owner is already declared in `src/ownership.ts:9`.
- `packages/db/migrations/0016_content_items.sql` + `meta/_journal.json` (idx 16, when 1761523200000) -- same order as `0012_catalog.sql`: table, ENABLE and FORCE RLS, grants to `slips_app`/`slips_admin_ro`, `tenant_isolation` policy.
- `packages/db/src/schema/content.test.ts` (new) -- copy `catalog.test.ts`: owner assertion, `findUnownedTables`, `findTenantViolations`, `registerTenantTable` plus `assertCrossTenantIsolation`.
- `apps/api/src/modules/content/` -- `content.repository.ts` (`StoreScoped`), `content-lifecycle.ts` (the only status writer; `InvalidTransitionError`, `ContentNotFoundError`), `content.controller.ts` (`@Controller('v1')`, `AuthenticatedRequest` from `../session/access.guard.js`; problem via `HttpException({ message, code: 'invalid_transition', type: CONTENT_INVALID_TRANSITION }, 409)` like catalog.controller.ts:72), and `content.lifecycle.ts` (`StoreDataLifecycle`: batch purge, export, no-op restore). Update `content.module.ts` (controllers, providers, `DB_POOL`/`EVENT_SENDER`/`TELEMETRY`). Ids come from `uuidv7()` in `apps/api/src/events/outbox.ts`. Keep `ContentService.getLinkCountsByProductIds` unchanged.
- `apps/api/src/http.ts:125` -- add `contentStoreData` to the lifecycles list.
- `apps/api/src/worker/content-jobs.ts` (new) plus `worker.ts` ~line 118 -- `registerContentEventHandlers` logs every content event (the dispatcher requires a handler), in the style of `integration-jobs.ts:45`.
- `apps/api/src/docs/openapi.ts` (~lines 40, 65, 263) -- the new routes and the `invalid-transition` problem.
- `apps/api/src/composition/content.test.ts` (new, live DB; copy setup from `composition/catalog.test.ts`) -- one test per matrix row. Also a table-driven test of every (status, action) pair against `CONTENT_TRANSITIONS` through `ContentLifecycle`.
- `apps/api/src/modules/content/status-guard.test.ts` (new) -- glob `apps/api/src/**/*.ts` outside `modules/content/` and fail on `/(update|insert\s+into)\s+"?content_items/i` or an import of `contentItems`. Include a fixture proving the regex catches a violation.

## Tasks & Acceptance

**Execution:**
- [x] contracts `content.ts`, `events.ts` (+ tests) -- statuses, transition table, events, schemas.
- [x] db `schema/content.ts`, `0016_content_items.sql`, journal, `schema/content.test.ts` -- table, RLS, cross-tenant.
- [x] api `modules/content/*`, `http.ts`, `worker/content-jobs.ts`, `worker.ts` -- lifecycle, repository, controller, store data, handlers.
- [x] `docs/openapi.ts` -- routes and problem.
- [x] `composition/content.test.ts`, `status-guard.test.ts` -- matrix rows, exhaustive transitions, guard.

**Acceptance Criteria:**
- Given every (status, action) pair, when `ContentLifecycle.apply` runs, then the outcome matches `CONTENT_TRANSITIONS` exactly (moved and evented, or `InvalidTransitionError` with no change).
- Given `pnpm turbo run lint typecheck test build`, then everything passes (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- `content.item.created` carries `from: null` and `to: 'draft'` (matching `{ v: 1, store_id, content_id, from, to }`); `content.item.deleted` uses `z.strictObject` with `from` only.
- `DELETE /v1/content/:id` answers `204 No Content`; `POST /v1/content/:id/archive`, `/undo-archive`, and `/restore` answer `200 OK` with the updated `ContentItem`.
- `reactivate_to` is preserved when a `deactivated` item is archived and restored on `undo_archive`, and cleared only on `reactivate` or `restore` (to `draft`).
- Updated three existing tests that enumerate schema exports (`packages/db/src/index.test.ts`), registered HTTP controllers (`apps/api/src/docs/openapi.test.ts`), and registered default `StoreDataLifecycle` modules (`apps/api/src/composition/integration.test.ts`) to include `content`.

## Spec Change Log

## Review Triage Log

### 2026-11-03 — Review pass (implementation by an external agent; Claude review)

- verdicts: 33 findings — high 0, medium 3, low 21, false 6, maybe-false 3
- findings:
  - `[medium]` `[patch]` (blind, edge) `cta_url` accepted any string (`javascript:`, `data:`, junk) and stores it for the player. Fixed: absolute http(s) URL, at most 2048 chars. The store-domain check stays in Story 3.3.
  - `[medium]` `[patch]` (verification-gap, blind) `reactivate_to` surviving archive → undo_archive, and being cleared on restore, was untested; a regression would leave deactivated items stuck. Fixed: tests added.
  - `[low]` `[patch]` (verification-gap) `first_published_at` on the `go_live` path was untested. Fixed: test added.
  - `[low]` `[patch]` (verification-gap) A malformed id answering 404 was untested. Fixed: test added.
  - `[low]` `[patch]` (blind, edge) `cta_style` had no length cap. Fixed: at most 40 in the contract. The DB CHECK is left as is, because migration 0016 is already applied to the dev DB.
  - `[low]` `[patch]` (blind, edge) The guard regex missed schema-qualified `public.content_items`. Fixed, with fixtures.
  - `[low]` `[patch]` (blind) The `pool` constructor parameter in `ContentLifecycle` was unused. Removed.
  - `[medium]` `[defer]` (blind) `undo_archive` (and later `reactivate`) can put an item back into `published`/`scheduled` with no publish-eligibility or plan-limit check, so archive-then-undo could get around Epic 7 limits or Epic 4 placement rules. No gate exists yet; deferred to the stories that add it.
  - `[maybe-false]` `[defer]` (verification-gap) The worker's `registerContentEventHandlers` call is untested; integration and catalog follow the same untested pattern. Deferred with a cheap fix (an "every catalogued event has a handler" test).
  - `[maybe-false]` `[reject]` (blind, edge) Deleting an item while it is `processing` makes the later media `finish/fail_processing` hit `ContentNotFoundError`. There is no media pipeline yet; Story 3.8/3.9 must treat not-found as terminal. Noted for 3.8.
  - `[maybe-false]` `[reject]` (edge) A `storeId` argument that differs from the store context leads to an update of 0 rows plus an event. `publishEvent` throws when the payload store conflicts with the ambient store, and callers pass the context store.
  - `[low]` `[reject]` (blind) Title or label made only of spaces. The spec says "stored as given"; blank-title rules belong to the Story 3.3 editor.
  - `[low]` `[reject]` (edge) A NUL character in text gives 500 instead of 400. Deliberate input only, and harmless.
  - `[low]` `[reject]` (edge) Zod counts UTF-16 units while the DB counts code points, so long emoji titles are rejected early. Stricter, never looser.
  - `[low]` `[reject]` (edge) OpenAPI omits 403 on the content routes. The catalog routes document the same set; consistent.
  - `[low]` `[reject]` (blind) The guard is stricter than the spec (only `content-lifecycle.ts` may write inside the module) and skips other packages. A single writer is intended; Story 3.3 can widen it for non-status edits. No other package touches the API DB layer.
  - `[low]` `[reject]` (blind) Event schemas accept any `from`/`to` pair. The producer is the table-checked lifecycle; per-event literals add surface with no consumer.
  - `[low]` `[reject]` (blind) No DB constraint ties `archived_from`/`reactivate_to` to `status`. The single writer maintains them, and the run-time fallbacks fail closed.
  - `[low]` `[reject]` (blind) No plain `store_id` index for purge/export. These are rare batch paths at pilot scale.
  - `[low]` `[reject]` (blind) The DB `id` default is v4. The app always supplies UUIDv7; same as the catalog tables.
  - `[low]` `[reject]` (blind) The `FOR UPDATE` lock is not tested under concurrency. Same as the catalog precedent.
  - `[low]` `[reject]` (blind) The 409 `detail` is English and carries internal ids. `detail` is developer text like the other problems; the dashboard keys on `type`/`code`.
  - `[low]` `[reject]` (blind) The worker handler test is weak and `isEventName` is dead code. Cosmetic.
  - `[low]` `[reject]` (blind) Status lists are copied in contracts, db and SQL. Each layer tests its own list; a drift test would need db to depend on contracts.
  - `[low]` `[reject]` (verification-gap) The matrix reads `expectedTo` for undo/reactivate from rows the code wrote. The independent HTTP and new tests pin those values.
  - `[false]` `[reject]` (blind) The composition test hardcodes the port. Every composition test does; this is the CI convention.
  - `[false]` `[reject]` (edge) Grouped claim duplicates of the guard and `cta_url` rows above.

## Verification

**Commands:**
- `pnpm db:migrate` against the dev DB -- expected: migration 0016 applied.
- `pnpm -C packages/contracts test` and `pnpm -C packages/db test` -- expected: pass (live DB tests on the Docker DB at 5436, swapped and reverted).
- `pnpm -C apps/api exec vitest run src/composition/content.test.ts src/modules/content src/worker src/docs` -- expected: pass.
- `pnpm turbo run lint typecheck test build` -- expected: pass except `@slips/player#build` on Windows.
