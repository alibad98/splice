---
title: '4.1 Home placements and publish eligibility - controlled pilot slice'
type: 'feature'
created: '2026-11-11'
status: 'in-progress'
pilot_slice_status: 'done'
full_story_status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b6463b5768e3ea6cd036dc367be082ac8dc7dea0'
context: []
---

<frozen-after-approval reason="Approved controlled pilot and explicit implementation authorization on 2026-11-11">

## Intent

Persist Home placement for a content item and enforce publication eligibility throughout its lifecycle. Deliver the approved Home-only pilot slice, preserving all existing planning/review changes on `feat/4-1-placements-and-targets`. Full Story 4.1 remains incomplete.

## Boundaries & Constraints

**Always:** Content owns placement/status writes; non-null tenant scope, forced RLS and cross-tenant tests. Drafts autosave; Published edits require explicit Save changes and exactly one transactional edited event. Duplicates start Draft without placements. Every transition into Published/Scheduled, including auto-publish, Undo, reactivate and go-live, checks placement eligibility under the item lock. Retain QC/media safety. Preserve existing files and changes; never reset or discard them.

**Never:** Implement Category/Product targets, scheduling UI/jobs, layout defaults, manifests, storefront delivery, deployment, enrollment or communications. Keep unsupported pilot choices unavailable. Do not mark full 4.1 done.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Home | Merchant adds/removes Home | Tenant-scoped persisted selection survives reload; list reflects Home | Reject unsupported/duplicate placements |
| Missing placement | Publish, schedule, go-live, Undo/reactivate to live without Home | No status/timestamp/event mutation; inline actionable reason | Structured no-placement error |
| QC | Processing completes with auto-publish | Home and passing QC publishes; no Home returns Draft with reason; failure never publishes | Preserve failure/retry behavior |
| Published edit | Save combined fields and placements | One atomic edit/event; removal leaves Published with no eligible placement | Failed save rolls back entire edit |
| Isolation | Another tenant reads/writes item/placements | No exposure or mutation | RLS plus scoped queries |
| Copy/data rights | Duplicate, export or purge | Copy omits placement; export includes it; purge removes bounded batches | Existing lifecycle contract |

</frozen-after-approval>

## Original full Story 4.1 acceptance criteria (preserved)

**Given** a content item open in the editor
**When** I add a placement
**Then** I can choose Home, Category or Product page, and for Category/Product an optional target picked from synced categories/products (searchable, Western digits, names in `dir="auto"`)
**And** the `placements` table (owner `content`, non-null `store_id`, RLS, cross-tenant test) is created in this story's migration

**Given** an item with no placement
**When** I press Publish (or auto-publish passes QC)
**Then** publish is blocked with the inline reason "Add a placement to publish" (button `aria-disabled` with reason, focus kept) and an auto-published item stays Draft with that reason (FR22)

**Given** a target product or category is later deleted in Salla
**When** the placement is shown in the editor
**Then** it is flagged "Linked product deleted" and no longer counts as a valid placement

**Given** I add, change or remove a placement on a Published item
**When** I press "Save changes"
**Then** exactly one `content.item.edited` domain event is emitted in the same transaction (AD-17)

Category/Product selection, searchable targets and deleted-target invalidation remain full-MVP acceptance, explicitly unimplemented by this slice.

## Code Map

- `packages/db/src/schema/content.ts`, `migrations/0022_placements.sql`, `migrations/meta/_journal.json`: additive placement table/schema and migration; ownership already declares placements.
- `packages/db/src/schema/content.test.ts`, `src/tenant/tenant-isolation.test.ts`: real PostgreSQL RLS and registry conventions.
- `packages/contracts/src/v1/content.ts`: strict fields, item schemas, event changed-field contract; add Home-only placement input/output and eligibility errors.
- `apps/api/src/modules/content/content-lifecycle.ts`: only command writer; replace eligibility stub, reuse item row locks and edit transaction; processing completion currently always Draft.
- `content.repository.ts`, `content.controller.ts`, `content.lifecycle.ts` in that directory: batched scoped reads, merchant API/error mapping, export/purge.
- `apps/api/src/modules/media/media.service.ts`: owner service supports asset summaries inside current transaction and attachment locks; reuse for QC checks rather than foreign-table writes.
- `apps/dashboard/components/content/editor/form.ts`, `ContentEditor.tsx`, `lib/api/content.ts`: saved baseline, autosave, explicit Published saves and mutation hooks. Add placements to all serialization/dirty/reset paths. Publish must wait for latest save; autosave.save returning false during in-flight save does not guarantee completion.
- `packages/ui/src/button.tsx`: existing focusable `unavailableReason` semantics; reuse plus visible localized inline reason.
- `apps/dashboard/components/content/ContentTable.tsx`, `i18n/messages/{en,ar}.ts`: placement display and localized accessible controls. Read dashboard AGENTS and local Next docs before editing.

## Tasks & Acceptance

**Execution:**
- [x] DB schema/migration and tenant tests: persist Home, enforce uniqueness/tenant boundaries, include lifecycle export/purge.
- [x] Contracts/API: add strict Home-only placement fields and publish endpoint; batched placement reads, genuine status reasons, atomic create/edit, copy omission.
- [x] Lifecycle admission: gate all resolved live destinations, preserve failed checks without events, auto-publish only after passing QC and valid placement, maintain first-publication timestamp and transactional events.
- [x] Dashboard: localized Home checkbox, actual publish-now action, inline focusable blocked reason, current-save sequencing, explicit Published save and list display.
- [x] Tests: execute matrix coverage, transition regressions, API error/isolation/QC, editor autosave/Published/focus behavior and browser check.
- [x] Tracking: record exact executed evidence in this spec and pilot-readiness; full 4.1 in-progress with deferred criteria explicit.

**Slice acceptance:** Given a saved Home placement and passing QC, when publication is requested, then status becomes Published; given any live destination without placement, when entered through any transition, then admission is refused atomically. Given unsupported target choices, when editing this pilot, then they are unavailable.

## Implementation Notes

Plan facts: no unresolved intent gaps; additive migration applied only to isolated test database, no production effects; footprint spans content DB/contracts/API/editor/tests/tracking. Existing authorization covers this implementation and dirty tree. No previous Epic 4 spec exists. Cached Epic 4 context matches current planning timestamp.

## Spec Change Log

## Review Triage Log

Independent review on 2026-11-11 used the full HEAD-to-worktree diff, including authorized pre-existing changes. Each finding was checked against current callers and tests; repeated findings retain separate rows.

| ID | Verdict | Evidence and disposition |
| --- | --- | --- |
| B1 | low | Zero-slide items can be Published, as before; this story specifies placement admission and processed attached media, with no minimum-slide criterion. No storefront is delivered here. Retain existing lifecycle behavior; record empty-media exclusion with 4.4 delivery rather than add an unapproved content requirement. |
| B2 | medium | Explicit Published saves already accept pending replacement media while preserving status. This slice does not change that behavior. Defer processed-only storefront selection to the explicitly ordered 4.4 compiler gate; preview may show pending media. |
| B3 | medium | Undo now reaches PublishEligibilityError/422 but its OpenAPI responses omit it. Patch response documentation and pin 422 in the docs test. |
| B4 | medium | A never-settling background metadata request holds the pre-existing refresh single-flight indefinitely. Defer bounded refresh timeout/cancellation; independent of Home writes. |
| B5 | medium | request() applies stale cookie 401 side effects before doRefreshConnection checks state/generation. Defer this pre-existing review-gap behavior with a concrete late-401 regression requirement. |
| B6 | low | Auto-publication runs eligibility twice under the same item/media locks. Both reads are consistent and bounded (at most ten slides); no incorrect admission or end-user failure. Reject optimization requiring extra cached-result branching. |
| B7 | medium | New browser test checks saved echo but never reopens. Patch it to reload and hydrate the saved Home selection before publishing. |
| B8 | low | Existing resolution browser test replaces one invalid image with another. Valid upload/replacement unit coverage exists; additional real-browser valid replacement is pre-existing verification debt outside this slice. Defer. |
| B9 | low | Mounted cleanup test lacks pending completion; client test already checks stop invalidates late successful refresh. Additional mounted unresolved-response verification is pre-existing coverage debt. Defer with refresh lifecycle work. |
| B10 | low | Startup smoke test proves every catalogued event has a handler and checks both schedules, but does not pin identities or exact counts. Additional wiring assertions are pre-existing coverage debt; no duplicate/wrong registration was demonstrated. Defer. |
| E1 | medium | Same verified late-401 side effect as B5; defer together with pre-existing refresh lifecycle work. |
| E2 | medium | Same verified hanging single-flight as B4; defer together with pre-existing refresh lifecycle work. |
| V1 | medium | List response assembly and desktop/mobile Home display lack positive assertions. Patch actual list integration plus table/card tests with Home and unplaced items. |
| V2 | medium | Publish catch/finally and retry are not exercised. Patch no-placement and generic rejection followed by successful retry; assert values/status/pending and localized feedback. |

## Verification

Implementation evidence executed on 2026-11-11 with Node 24.15.0 and isolated PostgreSQL at `TEST_DATABASE_PORT=15433`:

- Shared contracts and DB builds passed; API and dashboard TypeScript checks passed.
- DB content schema suite: 11 passed, including placement forced RLS, cross-tenant read/write isolation, Home-only constraint, uniqueness and non-null tenant scope. Migration 0022 was applied only to the isolated test database.
- Contracts content suite: 18 passed, including strict Home-only input and duplicate/target rejection.
- Dashboard editor suite: 35 passed, including Home autosave, focusable blocked publication and publication waiting for an in-flight save then saving the latest values. Further verification and browser evidence are recorded after final review below.
- `git diff --check` passed. Existing dirty-tree planning and review changes were preserved.

Full Story 4.1 remains in progress: Category/Product placements, searchable targets and deleted-target invalidation are deferred. No deployment, enrollment, storefront delivery or scheduling work was performed.

- Build shared contracts/DB before dependent checks; run affected contracts, DB, API content/media and dashboard suites with isolated PostgreSQL (`TEST_DATABASE_PORT`, never development DB).
- Run lint/typecheck/build for affected workspaces, and browser placement/editor coverage. Record actual results, distinguishing historical evidence.
- `git diff --check`; review all current changes without discarding pre-existing changes.

### Parent verification notes

The first full Turbo attempt exposed an outdated DB schema export assertion (fixed), unsupported Testing Library `exact` role options in new tests (fixing), a missing baseline ResizeObserver stub in the pre-existing content list fixture (fixed), and resource-related test/hook timeouts. Dashboard rerun with two workers passed all 29 files / 369 tests before review coverage additions. No failed run is claimed as acceptance evidence. Final results follow after patches.

### Final pilot slice acceptance - 2026-11-11

Home slice complete; full Story 4.1 remains **in progress**. This frontmatter deliberately records partial completion separately instead of marking the full story done. Original acceptance criteria above and in `epics.md` remain intact. Category/Product pages, searchable targets, mixed-direction target names and deleted-target invalidation remain unimplemented for full MVP.

| Matrix row | Executed covering evidence |
| --- | --- |
| Home | Home API scoped persistence/detail/list tests; strict contract tests; editor Home autosave and EN/AR table/card cases; browser reload hydration in four locale/width combinations |
| Missing placement | Five direct admission cases plus Scheduled/Published Undo/reactivate variants compare unchanged rows/events after refusal; focusable editor/browser Publish refusal |
| QC | Real media-summary auto-publish test emits Published exactly once; pending/failed media refusal retains rows/events; missing-placement QC completion stays Draft; full media regressions |
| Published edit | Combined title/placement edit emits exactly one edited event, explicit rollback retains both values; combined rejected editor save retains Home for retry |
| Isolation | Placement forced RLS/cross-tenant harness, non-null/unique/Home-only DB constraints, other-tenant API edit rejection |
| Copy/data rights | Home API duplicate omits placement; content lifecycle export includes placements and bounded purge removes them |

Review patches B3/B7/V1/V2 are verified. All three requested review layers completed; no layers were skipped. B4/B5/E1/E2 and related inherited verification debt are recorded in `deferred-work.md`; no blocker remains in the Home slice. Parent also corrected the browser mock so it intercepts actual API paths rather than Vite source modules, and hid the old add-placement hint once Home is selected. Screenshot inspection covered English desktop and Arabic mobile, with no overflow.

Final verification used Node 24.15.0, isolated PostgreSQL 18 at localhost:15433 and real FFmpeg 9.0.2. No development/production database was migrated.

- `pnpm turbo run lint typecheck build --continue --concurrency=2`: **19/19 successful**, 10 reused successful task results.
- Final affected suites ran sequentially with `pnpm --filter <workspace> exec vitest run --maxWorkers=2`: contracts **93**, DB **64**, API **687**, dashboard **373** passed, with no skipped tests. The initial full run also passed unchanged UI **102** and player **62** tests and the player build/budget checks.
- `pnpm --filter @slips/dashboard exec playwright test --workers=2`: **20 passed**, including Home save/reload/publication in English/Arabic at 1280/390 widths and all existing dashboard browser regressions. Deliberate 503 responses belong to existing preview recovery scenarios.
- After the final hint correction, dashboard lint/typecheck/build passed (6/6 tasks including dependency builds), the editor suite passed 37 tests, and all four Home browser cases passed again.
- `git diff --check`: passed. The final diff includes all authorized pre-existing planning/review-gap changes; no files or acceptance criteria were discarded.

Logs: system temp `splice-home-pilot/{verification,final-checks,final-tests,dashboard-browser-final,dashboard-final-checks,editor-final,placements-final}.log`. The first full attempt's failures and corrections are retained above; its partial result is not treated as a passing full run. Browser captures: dashboard `test-results/placements-*/home-placement.png`.

Next ordered pilot work remains the Ring/default slice of 4.2, then manifest work 4.4-4.6. Deployment, enrollment, merchant permission and all production launch gates remain open.
