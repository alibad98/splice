---
title: 'Story 3.13: edit, duplicate, archive, restore and delete content'
type: 'feature'
created: '2026-11-11'
status: 'done'
baseline_commit: '18fdfddcaa6a6012f36a6e66d948a96d41c51ce7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Merchants cannot duplicate content or restore archived items from the list.

**Approach:** Reuse PATCH/lifecycle commands; add transactional duplication and Edit/Duplicate/Restore menu actions. Verify atomic live edits and shared media.

## Boundaries & Constraints

**Always:**
- Published edits stay local until Save changes; one PATCH commits title/format/CTA/product/slides together, emits exactly one `content.item.edited`, and shows Changes saved. Rejected saves preserve user input and commit nothing.
- Duplicate returns a fresh Draft with title ending in literal ` (copy)` within the 80-character limit, the same CTA, product link and ordered live slides/alt text. Use fresh content/slide IDs and existing media asset IDs. Reset auto-publish, first publication and archive/reactivation metadata; copy no placements or schedule. Source stays unchanged.
- Duplicate is available for every non-deleted source, including Archived and items with pending/failed slides or a now-hidden/deleted product. These references remain visible with existing warnings; copying is not publication. Invalid/foreign/deleted IDs return the existing 404 shape.
- Archive keeps its persistent named Undo toast; Undo returns the prior status. Archived rows offer Restore to Draft. Delete retains the named confirmation, tombstone/event and exclusion from every tab.
- All writes/events use `ContentLifecycle` within store-scoped transactions. Preserve RLS and module boundaries. Deleting an original must not remove media referenced by its copy. Conservatively retaining unreferenced media is allowed by this story.
- Reuse UI-kit components, current row/card navigation, language query behavior, Arabic/English messages, logical CSS and error toasts. Mutations refresh content/counts and affected catalog linked counts. Disable repeat actions while pending and navigate to the new copy only on success.

**Never:** Add placements/schedules, billing, a new compiler/player, media duplication/reprocessing, asset garbage collection, schema migrations, deployment, or pilot scope reductions. The pilot proposal is separate from this story's original acceptance criteria.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Expected behavior | Error handling |
| --- | --- | --- | --- |
| Explicit live edit | Published title/CTA/link/slide changes | No autosave; one atomic PATCH/event; success toast | Invalid request writes no changes; values remain editable |
| Duplicate | POST `/v1/content/:id/duplicate` | 201 ContentItem, Draft, shared assets, copied link/order, fresh IDs, source unchanged | Foreign/deleted/malformed source 404; no writes |
| Long title | Source title at 80-char limit | Truncate safely to fit ` (copy)`; no broken surrogate | No title-length failure |
| Incomplete media | Pending/failed or empty slides | Copy stays Draft initially; same references/warnings | No publish or implicit retry |
| Restore | Archived row menu | POST restore; Draft and refreshed counts | 404/409 shows localized error and refetches |
| Archive/Undo | Published or other archivable row | Existing status/event; persistent Undo returns prior status | Existing localized failure recovery |
| Delete shared original | Original and copy share media | Original absent from all tabs; copy/media remain readable | Cancel changes nothing |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/content/content-lifecycle.ts`: `edit` already merges all fields under row lock and one edited event; `apply` handles archive/undo/restore/delete. Add `duplicate` using locked source, `fieldsOf`, live slides and existing create/write helpers with stored kinds only so initial copy remains Draft. Keep all writes here.
- `apps/api/src/modules/content/content.controller.ts`: add authenticated bodyless duplicate route, existing `withStoreContext`, `withProducts`, error mapping. `content.repository.ts` already supplies live row locks/link/ordered slides.
- `apps/api/src/docs/openapi.ts`, `openapi.test.ts`: register duplicate operation with 201 and merchant authentication.
- `apps/dashboard/components/content/editor/{ContentEditor.tsx,form.ts}`: explicit Published save and `patchOf` already exist.
- `apps/dashboard/lib/api/content.ts`: add typed duplicate/restore hooks; reuse `ContentItem`, cache keys and API helpers; invalidate catalog link counts after duplicate/delete.
- `apps/dashboard/components/content/ContentTable.tsx`, `ContentView.tsx`: existing row/card menu and named archive/delete flows; add Edit, Duplicate, Restore and pending guards, preserving activation behavior and language query.
- `apps/dashboard/i18n/messages/{ar,en}.ts`: add menu/success/error copy with parity; use current friendly-coach voice.
- `apps/api/src/composition/content.test.ts`: product/asset/status/outbox helpers; test DB convention 5433, prior local runs 5436. Verify isolated service before running.
- `apps/dashboard/components/content/content.test.tsx`, `editor/editor.test.tsx`: existing mocked session/API and real QueryClient/UI-kit harness; extend meaningful regression cases. Existing browser harness under `apps/dashboard/e2e` supports visual/keyboard validation.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/content/content-lifecycle.ts`, `content.controller.ts` — implement duplicate with atomic copied references and one created event.
- [x] `apps/api/src/docs/openapi.ts`, `openapi.test.ts` — document route and verify controller coverage.
- [x] `apps/api/src/composition/content.test.ts` — cover matrix, exactly one edited event across combined fields, transaction rollback, cross-store duplicate and media safety.
- [x] `apps/dashboard/lib/api/content.ts` — add mutations and correct content/catalog cache invalidation.
- [x] `apps/dashboard/components/content/{ContentTable,ContentView}.tsx`, `i18n/messages/{ar,en}.ts` — connect menu actions, navigation and localized success/failure states.
- [x] `apps/dashboard/components/content/content.test.tsx`, `editor/editor.test.tsx` — verify new actions, failures, pending guards and combined Published save; reuse existing archive/delete coverage.
- [x] `_bmad-output/implementation-artifacts/{spec-3-13-edit-duplicate-archive-restore-delete-content.md,sprint-status.yaml}` — record verification/review evidence and accurate story status.

**Acceptance Criteria:**
- Given an Arabic or English merchant using desktop rows or mobile cards, when managing content with keyboard or pointer, then Edit/Duplicate and applicable Restore actions work without accidental row activation.
- Given one failed mutation or stale item, when the action completes, then localized recovery appears and current list/counts are refetched.
- Given the implementation, when reviewed and verified, then original Story 3.13 acceptance criteria pass without implementing later epics.

## Implementation Notes

- Duplication locks the source and reuses lifecycle creation with stored slide kinds only: fresh item/slide IDs, shared assets, copied saved fields/link/live order, one created event, and an initial Draft even with incomplete media. Title truncation follows code-point boundaries within the contract's UTF-16 limit.
- Shared desktop/mobile menus expose Edit/Duplicate and Archived Restore; per-item mutation guards cover repeat actions and archive Undo. Navigation carries an existing valid language query. Duplicate/delete invalidate catalog linked-content counts, and all list mutations refetch content/counts on success or failure.
- Rejected Published product saves retain all local form inputs; same-status refreshes preserve unsaved live edits, while a remote archive still switches to read-only. Existing lifecycle delete retains shared media.
- The content composition suite accepts optional `CONTENT_TEST_ADMIN_URL`, keeping its original 5433 default. Verification used the inspected isolated `splice-testdb` PostgreSQL 18.6 service on 5436; no development database was used.

## Spec Change Log

## Review Triage Log

- Implementation handoff: ready for final independent diff review. Parent review caught the initial refresh-preservation guard also ignoring remote archives; narrowed to Published-to-Published refreshes and covered remote archive by regression test.

### Independent review — 2026-11-11

| Finding | Verdict / route | Evidence and disposition |
| --- | --- | --- |
| B1: copied failed upload has no content Retry while Draft | low / reject | True for exhausted uploaded media; source Retry can recover the shared asset, or merchant can replace the visible failed slide. Supporting Draft retry would extend existing lifecycle eligibility; rare copy-of-failed-content case does not justify that extra branch here. |
| B2: dirty Published guard drops fresh non-form metadata | medium / patch | Guard returns before updating saved snapshot, suppressing current product warnings and saved preview metadata. Accept incoming snapshot while retaining local form values. |
| B3: skipped Published snapshot not reconsidered after manual revert | medium / patch | Same early-return root cause as B2; accepting the snapshot removes the deferred stale baseline rather than requiring a second effect trigger. |
| B4: Retry uses per-menu pending state | low / patch | Desktop and mobile menus are both mounted; shared action guards do not include Retry. Move Retry through existing parent per-item guard. |
| B5: browser harness navigation checks URL only | low / reject | True harness limitation, explicitly documented; destination editor loading already has component/API tests. Building real session/router integration is disproportionate for fixed existing editor routes. |
| B6: no media byte read after deleting source | low / reject | Integration proves retained asset rows and copy references; lifecycle deletion only updates content tombstone and has no storage call. A seeded byte-stream test adds infrastructure without exercising a changed storage path. |
| B7: hidden-only product not tested separately | low / reject | Combined hidden/deleted fixture covers preserving links without new-link validation. Hidden-only adds no branch to duplicate; existing summary exposes deleted warnings, not a separate visibility flag. |
| B8: no concurrent duplicate/edit/delete test | low / reject | All three paths lock the same source row in one transaction; link/slide reads and created event remain inside that lock. Rollback/source-immutability tests pass. Additional interleaving infrastructure is unnecessary absent a demonstrated race. |
| B9: refreshed context omits throttling/metering | low / defer | Confirmed documentation regression in agent context, not runtime; track restoration of authoritative constraints. |
| B10: refreshed context weakens expiry/performance wording | low / defer | Confirmed same context regression; track explicit 15-minute expiry and processing metric requirement with B9. |
| E1: clicking Undo during pending Duplicate closes skipped action toast | low / reject | Real competing-action edge: per-item guard skips Undo while Radix closes the action. Occurs only when deliberately undoing the source during navigation to its copy; adding queued-action/toast API state is disproportionate. Archived source remains recoverable via Restore; API Undo exists. |
| E2: Retry pending differs across responsive menus | low / patch | Same root cause as B4; use the shared parent guard. |
| V1: Published refetch-retention test uses fixed item prop | medium / patch | Pre-verified gap: invalidation cannot reach the incoming-effect guard through fixed props. Use ContentEditorPage and deliver a newer Published response after rejection; assert retained input, refreshed metadata and retry payload. |

## Verification

- API composition/content integration tests against isolated local test Postgres, plus lifecycle guards and OpenAPI tests.
- Dashboard content/editor tests, i18n guards, lint/typecheck and production build; browser/visual check of changed menus in Arabic/English and desktop/mobile.
- API lint/typecheck/build and `git diff --check`. Record actual results and any environment limitations.

### Actual results — 2026-11-11

- API: `CONTENT_TEST_ADMIN_URL=postgres://slips:slips@127.0.0.1:5436/slips pnpm --filter @slips/api exec vitest run src/composition/content.test.ts src/docs/openapi.test.ts src/modules/content/status-guard.test.ts` — **180 passed**. Includes every source status, empty/pending/failed slides, hidden/deleted product reference, live-slide filtering, fresh IDs, surrogate-safe titles, source immutability, copied reference/event rollback, foreign/malformed/deleted 404s, shared media after delete, and one atomic combined Published edited event with rejection rollback.
- Dashboard: focused content/editor and i18n/navigation suites — **88 passed**. Includes action navigation, Restore counts, stale recovery, pending guards, duplicate/delete catalog invalidation, cancel delete, combined Published PATCH/retry/input retention, and remote archive read-only recovery.
- Browser: `pnpm --filter @slips/dashboard exec playwright test` with installed Chromium 1248 — **12 passed**, including new Arabic/English × 1280/390 menu checks and existing editor/player preview checks. Verified keyboard Edit, pointer Restore/Duplicate, preserved language, 409 recovery, pending disables, successful-copy-only navigation, no page errors and no horizontal overflow. Inspected all four menu screenshots.
- API and dashboard lint/typecheck/build passed; `git diff --check` passed. Portable Node 24.15.0 was used. Check logs: `C:/Users/Ali/AppData/Local/Temp/splice-3-13-final/`; screenshots: its `screenshots/menu-{ar,en}-{1280,390}.png` files and dashboard `test-results`.
- Initial test-fixture/typing and browser interception/build-order failures were corrected; the recorded final runs pass. Browser verification uses the existing real-component harness with mocked API responses; API transaction/RLS behavior is verified separately against isolated PostgreSQL. No deployment or new schema migration was added. Final review remains pending.

### Final parent verification after review patches — 2026-11-11

- Independent blind, edge-case and verification-gap reviews completed; every finding is triaged above. Snapshot/metadata preservation, page-level refetch coverage and responsive Retry guards were fixed. Agent-context documentation follow-up is recorded in deferred work; no blocking finding remains.
- Parent inspected the staged/untracked-inclusive baseline diff, patched diff, actual verification logs and Arabic desktop/English mobile captures. Matrix audit covers all seven rows through executed content API tests, editor/list tests and browser checks.
- Full dashboard suite: **28 files / 363 tests passed**. Dashboard ESLint, route generation/typecheck and production build passed after final patches. Full dashboard browser suite: **12 passed**, covering new menus and existing real-player preview integration. API remains **180 passed**, with API lint/typecheck/build passed and no subsequent API code change.
- Logs: system temp `splice-3-13-final/parent-dashboard-{all,lint,typecheck,build,browser}.log`; prior API logs in the same directory. `git diff --check` passed.
- Story implementation is complete. Sprint tracker retains `review` as prescribed by BMAD Build's completion sync; other review stories are unchanged. Pilot scope remains proposed; no deployment or enrollment occurred.


### Pilot review closeout — 2026-11-11

Existing final review confirmed by shared content/editor/list/browser regression. Restored quantified upload/processing/abuse constraints and approved-pilot state in Epic 3 context; no original acceptance criteria changed.

Actual shared verification: API 677, dashboard 367, contracts 92, DB 62, UI 102 and player 62 unit tests passed; dashboard 16 and player 33 browser tests passed. All 26 repository lint/typecheck/test/build tasks succeeded. See [review-gap closeout](review-gap-closeout-2026-11-11.md) for commands, environment, initial failures, cache use and remaining acceptance/launch gates. These are executed results; older expected-only commands above remain historical.
