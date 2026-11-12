---
title: '4.2 Fixed Story Ring layout with integration-owned default - controlled pilot slice'
type: 'feature'
created: '2026-11-11'
status: 'done'
pilot_slice_status: 'done'
full_story_status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '718296568b02b656a9423b288fef1df81697e612'
context: []
---

<frozen-after-approval reason="Approved by Ali on 2026-11-11 (keep full spec, approve and continue)">

## Intent

**Problem:** Home placements (4.1 pilot slice) carry no layout, no store-level display default exists, and the editor still offers storefront choices the pilot cannot deliver. The pilot journey promises one fixed Story Ring on Home.

**Approach:** Create the `integration`-owned `store_settings` table with a Story display default (pilot: Ring only). Persist a `layout` on every placement, defaulted from settings with a Ring fallback, and reject other layouts with a `problem+json` slug. Make unsupported choices visibly unavailable in the editor. Full Story 4.2 stays in progress.

## Boundaries & Constraints

**Always:**
- `integration` owns `store_settings` (one row per store, non-null `store_id`, forced RLS, cross-tenant test, export/purge).
- `content` reads the default only through an exported `IntegrationService` method. It never reads the table directly.
- A missing settings row means Ring. No backfill job is needed, and existing Home placements migrate to `ring`.
- Layout changes on Published items follow the 4.1 explicit-save and single-edited-event rules.
- Unavailable controls stay focusable and show a localized inline reason (Button `unavailableReason`). Copy is in English and Arabic, and works RTL and LTR.
- Preserve 4.1 behavior and its tests.

**Never:**
- Bar, Strip or Carousel layouts, Category/Product placements, a Settings UI, settings history, attribution or language columns, or a settings-changed event.
- Manifest/layout delivery (that's 4.4), player layouts (Epic 5), schedule endpoints, schedule jobs or a schedules table.
- Removing completed Reel or media code.
- Marking full 4.2 done.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| New Home | Add Home, no layout sent, no settings row | Placement persisted with `layout: 'ring'` and returned in detail/list | N/A |
| Stored default | Settings row `story_layout='ring'` | New placement inherits it | N/A |
| Invalid layout | Create/update with `layout: 'bar'` or unknown | No mutation | 422 `problem+json` slug `content-invalid-layout`; localized field error |
| Existing data | 4.1 Home rows before migration | Read back as `ring` | Migration default + CHECK |
| Isolation | Other tenant reads/writes settings | No exposure or mutation | RLS + scoped queries |
| Data rights | Export / purge store | Settings exported; purge removes the row | Existing lifecycle contract |
| Reel admission | Existing Reel item: publish, auto-publish after QC, Undo/reactivate to live | No status/timestamp/event mutation; stays Draft with `unsupported_format` reason | Same atomic admission path as `no_placement`, under the item lock |
| Reel create | New item in editor | Reel format choice visible but unavailable with pilot reason; existing Reel drafts still editable | API create of a new Reel still accepted (drafts only) |

**Decisions (Ali, 2026-11-11):**
1. Reels: disable the Reel format choice for new items with a pilot reason. Every transition into Published/Scheduled refuses Reel items with an `unsupported_format` reason. Reel drafts stay editable, and no Reel/media code is removed.
2. Layout UI: a layout control under Home with Ring selected and Bar visible but unavailable, with a pilot reason.
3. Scheduling: an unavailable "Schedule" button next to "Publish now" with a pilot reason. The Scheduled list tab stays. No schedule API is added.

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/integration.ts`: add `storeSettings` (id, storeId unique, storyLayout text default `'ring'` with CHECK `'ring'`, timestamps). `ownership.ts` already lists `store_settings` under integration.
- `packages/db/src/schema/content.ts:69-75`: `placements` gets `layout` text not null, default `'ring'`, CHECK `'ring'`.
- `packages/db/migrations/0023_store_settings_layout.sql` and `meta/_journal.json`: additive table with FORCE RLS and `tenant_isolation`, plus the placement column. Mirror `0022_placements.sql`.
- `packages/db/src/schema/integration.test.ts`, `content.test.ts`, `src/testing/cross-tenant.ts` (`registerTenantTable`), `src/tenant/tenant-isolation.test.ts`: RLS, cross-tenant and constraint tests.
- `packages/contracts/src/v1/content.ts:116-122`: `Placement` gets optional input / required output `layout: z.enum(STORY_LAYOUTS_PILOT)` and a new invalid-layout slug. Unknown values must still reach the API as a 422 slug, so validate the slug path rather than letting zod strip it.
- `apps/api/src/modules/integration/integration.service.ts`: add `getDisplayDefaults(storeId)` (`withStoreContext`; returns Ring when there's no row). Wire it through `integration.repository.ts`. `integration.lifecycle.ts` `integrationStoreData` handles export/purge of the settings row.
- `apps/api/src/modules/content/content-lifecycle.ts:382` `writePlacements`: resolve the default when a layout is omitted; `:217-243` diffing includes layout. Edit `content.repository.ts:31` reads, `content.controller.ts:89` `toContentItem` and the OpenAPI 422 docs, and `content.lifecycle.ts:20-26` export.
- `apps/dashboard/components/content/editor/ContentEditor.tsx:289-318`: placement section and Publish button. Edit `FormatTitleCard.tsx:31-35` (format tabs), `editor/form.ts` serialization/dirty/reset and `i18n/messages/{en,ar}.ts` (`placements` :223).
- Tests: `apps/api/src/composition/*.test.ts` (isolated PG via `TEST_DATABASE_PORT`), `editor.test.tsx`, `e2e/placements.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] DB: settings table, placement layout column, migration 0023, RLS/cross-tenant/constraint tests.
- [x] Contracts: layout enum, slug, placement input/output.
- [x] Integration: `getDisplayDefaults`, export/purge, tests.
- [x] Content API: default resolution, invalid-layout 422, diff/edited-event, export, OpenAPI docs; `unsupported_format` admission in `publishEligibility` (`content-lifecycle.ts:370`) plus status reason/contract; tests for every live transition.
- [x] Dashboard: Reel tab unavailable for new items (`FormatTitleCard`), Ring/Bar layout control under Home, unavailable Schedule button, `unsupported_format` publish reason, form serialization, localized copy, unit + browser tests (EN/AR, desktop/mobile).
- [x] Tracking: record evidence here and in `pilot-readiness.md`; full 4.2 stays in progress.

**Acceptance Criteria:**
- Given any Home placement, when the item is read, then its layout is `ring`.
- Given an unsupported pilot choice, when editing, then it is unavailable with a focusable localized reason.

## Original full Story 4.2 acceptance criteria (preserved)

Story items choose Ring or Bar. Reels choose Strip or Carousel (boxed or full width on Home/Category; strip below images or at a custom position on Product), and each opens the full-screen viewer. New placements default to the `store_settings` display default, falling back to Ring for Stories and Strip/Carousel for Reels. Layouts that are invalid for the page type are rejected with a `problem+json` slug and a localized field error. Only Ring on Home is delivered by this slice.

## Implementation Notes

Implemented 2026-11-11 (pilot slice only; full 4.2 stays in progress).

- **DB (migration 0023):** `store_settings` (integration-owned; unique non-null `store_id`, `story_layout` default `'ring'` CHECK `= 'ring'`, forced RLS, `tenant_isolation`, app/admin_ro grants; no FK to `stores`, mirroring 0022). `placements.layout` text not null default `'ring'` with CHECK `= 'ring'`; existing Home rows take the default.
- **Contracts:** `STORY_LAYOUTS_PILOT = ['ring']`, `StoryLayout`; output `Placement` requires `layout`, input `PlacementInput` makes it optional (`PlacementList` is the input list). New slugs `content-invalid-layout` and `content-unsupported-format`; status reason `unsupported_format`. `hasInvalidLayoutIssue(issues)` detects a zod issue on `placements.<n>.layout` so the API answers 422 rather than 400 for unknown layouts (zod never strips it: `Placement` is strict).
- **Integration:** `IntegrationService.getDisplayDefaults(storeId)` via `withStoreContext` (joins the caller's same-store transaction), Ring when no row. `integrationStoreData.export` returns `store_settings`; purge deletes the row.
- **Content:** `ContentLifecycle` takes the integration service as an optional 4th dependency (also wired in the worker). Layout resolution: sent layout, else the saved layout of the same placement, else the store default (read at most once per call), else Ring. `writePlacements` upserts layout on the `(store_id, content_id, type)` index, so a layout change is a `placements` change in the single edited event; re-sending the saved Home (with or without layout) is a no-op. `publishEligibility` refuses `format === 'reel'` first (`unsupported_format`) under the same `apply` item lock, covering publish, schedule, go_live, reactivate, undo-archive and QC auto-publish (which stays Draft). Draft + auto-publish Reels report `status_reason: unsupported_format`. Export includes `layout`. OpenAPI create/patch/publish/undo-archive descriptions document the new 422s.
- **Dashboard:** Reel tab is focusable, `aria-disabled`, described by a visible localized hint, and ignored on selection unless the saved item is already a Reel (new items and saved Stories cannot become Reels; existing Reel drafts stay editable). Under Home, a radiogroup shows "Story ring" selected and "Story bar" as `Button unavailableReason` with a visible reason. An unavailable "Schedule" button sits next to "Publish now" with an inline reason. Publish reason order: unsupported_format, no_placement, media. 422 `content-invalid-layout` sets a localized field error on the layout group; 422 `content-unsupported-format` on publish shows the localized reason. EN/AR copy added.
- **Behavior change to an existing 4.1-era test (intentional, Decision 1):** the new-item editor test no longer switches to Reel, and the Published combined-edit test now starts from a Reel and switches to Story so a format change is still covered.

## Spec Change Log

## Review Triage Log

Independent review on 2026-11-11 with three layers: blind (B), edge case (E) and verification gap (V). No layer was skipped. Each finding was checked against the code.

| ID | Verdict | Evidence and disposition |
| --- | --- | --- |
| B1 | high | `edit` accepts `format: 'reel'` on Published/Scheduled items and keeps the status; only `apply` is gated. Existing tests at `content.test.ts` (~679, ~1096) and the new reactivate test rely on it. Decision 1 has one reading (no live Reels in the pilot). **Patch**: refuse a format change to Reel on live items with the existing `PublishEligibilityError('unsupported_format')` → 422; adapt the tests. |
| E1 | high | Same as B1. Patch with B1. |
| E5 | high | Same as B1: the claim that every live entry is gated is false while `edit` is open. Patch with B1. |
| V3 | high | Same as B1 (other findings). Patch with B1. |
| B2 | low | Reels that went live before this slice stay live. No deployment or enrollment exists yet, so only local data is affected, and a fix needs a data migration. Rejected. |
| B3 | medium | `hasInvalidLayoutIssue` uses `some`, so `{title:'', placements:[{type:'home',layout:'bar'}]}` gets 422 `invalid_layout` and hides the title error, and category+bar gets 422 instead of 400. **Patch**: answer 422 only when every issue is a layout issue; test the mixed cases. |
| E4 | medium | Same as B3. Patch with B3. |
| B4 | low | Reel drafts store `layout: 'ring'`. This is intentional: the CHECK allows only Ring and the spec keeps Reel layouts out. Full 4.2 will migrate. Rejected. |
| B5 | low | The auto-publish switch stays available on Reels, but the visible publish reason already says Reels can't be published. The fix would add a branch for a rare case. Rejected. |
| B6 | low | The layout radiogroup has no roving tabindex or arrow keys. Only one option is selectable in the pilot. A full radio pattern adds complexity; revisit when Bar is available. Rejected. |
| B7 | low | `STORY_LAYOUTS_PILOT` is defined in both db and contracts, plus the SQL CHECK. db does not depend on contracts, so sharing it needs a package dependency change. Rejected; Bar work must update all three. |
| B8 | low | `pilot-readiness.md` was ticked before review. **Patch**: update the entry after the review result. |
| B9 | low | A saved Reel draft switched to Story can't switch back in the editor. This follows Decision 1 (saved Stories can't become Reels). Rejected. |
| B10 | false | The always-visible pilot reasons are required by the spec (focusable control with a localized inline reason). This is intended, not a defect. |
| B11 | medium | The server-set `placements` error is never cleared by unchecking Home, choosing Ring or a later successful save, so a stale alert stays and the summary link can target an unmounted node. **Patch**: `clearErrors('placements')` on Home toggle and Ring; add a test. |
| E2 | medium | Same as B11. Patch with B11. |
| E3 | medium | Same as B11 (unmounted anchor). Patch with B11. |
| E6 | medium | Same as B11 (claim). Patch with B11. |
| B12 | false | `fromItem` maps through `homePlacement`, but the output contract only allows `type: 'home'`, so no type is lost today. |
| B13 | medium | The worker and DI-built `ContentLifecycle` are not proven to read the stored default. Merged with V1. |
| V1 | medium | Pre-verified: no test can tell the stored default from the Ring fallback because only Ring exists. **Defer** until a second layout exists. |
| V2 | medium | Pre-verified: no list test renders the `unsupported_format` status reason. **Patch**: an EN/AR desktop row and mobile card test in `content.test.tsx`. |

## Verification

Executed 2026-11-11 with Node 24.21.0 and an isolated PostgreSQL 18 container (`splice-4-2-testdb`, `TEST_DATABASE_PORT=15433`); migration 0023 was applied only there. No development or production database was touched.

- `pnpm turbo run lint typecheck build --continue --concurrency=2`: **19/19 successful**.
- vitest (`--maxWorkers=2`): contracts **94**, DB **67**, API **699 passed / 1 skipped** (pre-existing MinIO-only S3 test, skipped because MinIO is not running), dashboard **379**: all passed.
- `pnpm --filter @slips/dashboard exec playwright test --workers=2`: **24 passed**, including the new Ring/Reel/Bar/Schedule case in EN/AR at 1280/390 and the existing Home cases. Screenshots `apps/dashboard/test-results/placements-*/ring-layout.png` inspected (EN desktop, AR mobile): RTL correct, no horizontal overflow.
- `git diff --check`: clean.

| Matrix row | Covering evidence |
| --- | --- |
| New Home | API: created Home reads `ring` in detail, list and DB; editor autosave sends `{type:'home',layout:'ring'}`; browser save/reload |
| Stored default | API settings-row test; lifecycle spy proves the default is read once only when layout is omitted and no saved layout exists |
| Invalid layout | Contracts layout-path detection; API create/patch with `bar`/`strip`/`carousel`/`unknown`/number answer 422 problem+json `content-invalid-layout`, rows/events/placements unchanged; editor localized field error |
| Existing data | DB default/CHECK test; API legacy row inserted without layout reads `ring` in list/detail |
| Isolation | `store_settings` forced RLS + cross-tenant harness; integration test: other store's row invisible/unchangeable, nested other-store read refused |
| Data rights | Integration export/purge test; lifecycle purge asserts `store_settings` removed; content export carries `layout` |
| Reel admission | Lifecycle matrix (publish, schedule, go_live, reactivate, undo-archive) refuses with unchanged row/events; Undo/reactivate from Scheduled/Published; QC auto-publish stays Draft with `unsupported_format`, no published event; HTTP 422 `content-unsupported-format` |
| Reel create | API Reel create and edit accepted; editor Reel tab unavailable for new items, existing Reel draft editable with focusable Publish reason |

### Post-review verification - 2026-11-11 (parent run)

The review patches were applied: B1 (live Story → Reel edit refused with 422 `content-unsupported-format`, nothing written; older 3.13 live-edit tests now start from an admin-seeded Reel), B3 (422 `invalid_layout` only when every issue is a layout issue; mixed bodies answer 400), B11 (`clearErrors('placements')` on Home toggle and Ring) and V2 (EN/AR list reason test). B8 is resolved by updating the readiness entry after this run. V1 is deferred in `deferred-work.md`.

- `pnpm turbo run lint typecheck build --continue --concurrency=2`: **19/19 successful**.
- vitest (`--maxWorkers=2`, `TEST_DATABASE_PORT=15433`): contracts **94**, DB **67**, API **701 passed / 1 skipped** (same pre-existing MinIO-only test), dashboard **381**: all passed.
- Playwright (`--workers=2`): **24 passed**. The first attempt failed before launching any test because the Chromium headless shell was missing from `~/.cache/ms-playwright`; `playwright install chromium` fixed it and the rerun passed. No test failure is claimed as evidence.
- `git diff --check`: clean.

**Commands:**
- `pnpm turbo run lint typecheck build --continue --concurrency=2` -- expected: all tasks pass.
- `pnpm --filter <contracts|db|api|dashboard> exec vitest run --maxWorkers=2` with isolated `TEST_DATABASE_PORT` -- expected: all pass. Never use the development database.
- `pnpm --filter @slips/dashboard exec playwright test --workers=2` -- expected: placement/editor browser tests pass.
- `git diff --check` -- expected: clean.
