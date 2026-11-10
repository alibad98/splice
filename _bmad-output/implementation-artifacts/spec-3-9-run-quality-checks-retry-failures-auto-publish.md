---
title: 'Story 3.9: run quality checks, retry failures and auto-publish'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: '2291c40c29d96e17a1e6c2b65af667b88ea2d5dc'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-8-process-videos-into-renditions-and-posters.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The server never enforces the quality limits. Videos below 720p, longer than 90 s or without a video track still get processed, and images below 1080 px pass too. `media.asset.failed` is ignored by `content`, so an item whose slide fails stays `processing` forever, and there's no Retry. `auto_publish` exists in the DB but merchants can't set it, nothing evaluates it, and no "Add a placement to publish" reason appears.

**Approach:** Have `MediaProcessor` probe the source (dimensions, duration, video track). `MediaProcessorRunner` checks the probe against `MEDIA_LIMITS` before rendering. A quality failure fails the asset straight away with a reason code; transient errors still use the 3-attempt queue policy. `content` listens to `media.asset.failed` and applies `fail_processing`. A new `POST /v1/content/:id/retry` re-queues the retryable failed slides through a `media` command. `auto_publish` becomes editable, and when processing finishes `content` runs a publish-eligibility stub that always returns `no_placement` until Epic 4. `ContentItem` gets a derived `status_reason` that the editor and list display.

## Boundaries & Constraints

**Always:**
- New `MEDIA_FAILURE_REASONS`: `below_min_resolution`, `over_duration`, `no_video_track`. `corrupt` is reused for unparseable video containers (drop the `1080x1920` fallback in `parseVideoDimensions`).
- Quality rules come from `MEDIA_LIMITS`: video short side ≥ 720, duration ≤ 90 s, video track present; image short side ≥ 1080. A quality failure is permanent. It gets no queue retry, writes no renditions or storage objects, sets the asset `failed` with the reason and emits `media.asset.failed`.
- `content` handles `media.asset.failed` in `syncSlideProcessing`. A `processing` (or `draft`) item with a failed live slide → `fail_processing` (`content.item.processing_failed`). Deleted items are ignored. All status writes stay in `content-lifecycle.ts`.
- `finish_processing` also allows `failed → draft`. An edit that removes or replaces every failed slide returns the item to `draft`, or to `processing` if any slide is still in flight.
- `ContentItem.status_reason: { code: <media failure reason> | 'no_placement', kind?: 'image'|'video' } | null`. It is derived, not stored (no migration). For `failed` items it comes from the first failed live slide; for `draft` + `auto_publish` it is `no_placement`; otherwise `null`. The dashboard renders it as localized text (en/ar) next to the status chip in the editor and in the list's `TitleCell`, e.g. "This video didn't finish processing: resolution is below 720p." / "Add a placement to publish".
- `auto_publish` is added to `ContentFields` (create/update) and appears as a switch in the editor. When `finish_processing` runs on an `auto_publish` item, `ContentLifecycle` calls `publishEligibility(tx, storeId, itemId)`, which returns `{ eligible: false, reason: 'no_placement' }` until Epic 4, and the item stays `draft`. Never call `publish` from 3.9.
- `POST /v1/content/:id/retry` requires a `failed` item (otherwise 409 `invalid-transition`). It calls `MediaService.requeueProcessing(tx, storeId, assetIds)` for the retryable failed slides; that command sets `failed → scanned`, clears the reason and emits `media.asset.scanned` (which re-queues `media.asset.process` with a fresh job id). The item then moves `failed → processing` via `start_processing`. A Retry button shows in the editor's failed banner and in the list row menu for `failed` items.

**Decisions (2026-11-10, Ali):**
- **Keep the full spec** (~2.4k tokens) as one story; auto-publish is not split out.
- **Retry only `processing_failed` slides.** Quality (`below_min_resolution`, `over_duration`, `no_video_track`), `corrupt`, `malware` and type failures are not retryable: the banner tells the merchant to replace the media, and Retry is disabled (editor) / hidden (row menu) when no failed live slide is retryable. `POST /v1/content/:id/retry` with no retryable slide returns 409 `invalid-transition`.

**Never:** Add placements or a real publish. Add a DB migration. Retry in the queue on quality failures. Hotlink, or change the upload/inspect pipeline from 3.5/3.7, beyond the new reason codes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Low-res video | `scanned` 540x960 MP4 | asset `failed`/`below_min_resolution` on attempt 1, no renditions; item `processing → failed`, reason shown | — |
| Long video | 95 s MP4 | `failed`/`over_duration` | — |
| Audio-only MP4 | no `vide` track | `failed`/`no_video_track` | — |
| Garbage container | unparseable video bytes | `failed`/`corrupt` | — |
| Low-res image | 800x1200 JPEG | `failed`/`below_min_resolution` | — |
| Transient error ×3 | processor throws on all attempts | `processing_failed` after attempt 3; item `failed` | — |
| Retry | `failed` item, `processing_failed` slide | asset → `scanned`, job re-queued, item → `processing`, later `draft` | non-`failed` item → 409 |
| Auto-publish on | all slides pass | item `draft`, `status_reason.code = no_placement` | — |
| Auto-publish off | all slides pass | item `draft`, `status_reason = null` | — |
| Fix by edit | `failed` item, failed slide removed, rest `processed` | item → `draft` | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/media.ts` -- `MEDIA_LIMITS` L15-18 (reuse), `MEDIA_FAILURE_REASONS` L58-70 (add 3 codes).
- `packages/contracts/src/v1/content.ts` -- `CONTENT_TRANSITIONS` L91-106 (`finish_processing` from `processing|failed`), `ContentFields` L149-178 (+`auto_publish` optional bool), `ContentItem` L254-274 (+`status_reason`), new `CONTENT_STATUS_REASONS`.
- `apps/api/src/ports/media-processor.ts` + `adapters/media/dev-media-processor.ts` -- add `probe(bytes, contentType) → { width, height, durationSeconds: number|null, hasVideoTrack }`. MP4/MOV: `mvhd` timescale/duration and a `hdlr` `vide` / `tkhd` with nonzero dims. WebM: EBML `Duration` × `TimecodeScale`, and a video `TrackEntry`. Throws `UnparseableMediaError` → `corrupt`. Extend `buildMp4Buffer` (L19) with optional duration / no-video-track flags for tests.
- `apps/api/src/modules/media/media-process.ts` -- in `process` (L75-171) run probe + `qualityCheck` before rendering. On a quality failure call `this.fail(...)` (L173) regardless of `finalAttempt`.
- `apps/api/src/modules/media/media.service.ts` + `media.repository.ts` -- `requeueProcessing(tx, storeId, assetIds)`: only `failed` assets with retryable reasons; `finishProcessing`-style update to `scanned`, emit `media.asset.scanned`.
- `apps/api/src/worker/media-jobs.ts` -- the `MEDIA_PROCESS_QUEUE` send uses `{ id: assetId, singletonKey: assetId }`. Switch to a unique id (keep `singletonKey`) so a re-queue isn't swallowed.
- `apps/api/src/modules/content/content-lifecycle.ts` -- `syncSlideProcessing` L264-300 (+failed branch), `edit` L166/L226-233 (failed recovery), `create` L138 (use input `auto_publish`), new `retry(storeId, id)` and `publishEligibility`. `apply` L393 stays the only writer.
- `apps/api/src/modules/content/content.controller.ts` -- `POST :id/retry` beside archive (L273), mapper L98 (+`status_reason` derived from slides), 409 mapping L311. Also `docs/openapi.ts`.
- `apps/api/src/worker/content-jobs.ts` -- subscribe `syncSlideProcessing` to `media.asset.failed`.
- Dashboard:
  - `lib/api/content.ts` (retry mutation);
  - `components/content/ContentTable.tsx` (`TitleCell` L39-52 reason chip, row menu Retry);
  - `editor/ContentEditor.tsx` (failed banner + Retry near chip L247, auto-publish switch, reason line);
  - `i18n/messages/{en,ar}.ts` (`content.statusReasons.*`, `content.editor.autoPublish.*`, `content.actions.retry`, and slide `failures` for the 3 new codes at en L293-310).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts` (+tests) -- reasons, transition, `auto_publish` input, `status_reason`.
- [x] `dev-media-processor.ts`, `media-processor.ts`, `media-process.ts` (+`dev-media-processor.test.ts`, `composition/media.test.ts`) -- probe + quality check; covers the matrix's media rows.
- [x] `media.service.ts`, `media.repository.ts`, `media-jobs.ts` -- `requeueProcessing` + unique job ids.
- [x] `content-lifecycle.ts`, `content.controller.ts`, `content-jobs.ts`, `docs/openapi.ts` (+`composition/content.test.ts`) -- fail/recover/retry/auto-publish eligibility; covers the matrix's item rows.
- [x] Dashboard files above (+`content.test.tsx`, `editor.test.tsx`, `slides.test.tsx`, i18n tests) -- reason display, Retry, auto-publish switch.

**Acceptance Criteria:**
- Given any media job failure, when `content` receives `media.asset.failed`, then the item status is written only by `ContentLifecycle` (`status-guard.test.ts` passes).
- Given `pnpm turbo run lint typecheck test build`, then everything passes except the known Windows-only `@slips/player#build`.

## Implementation Notes

- 2026-11-10: User requested implementation of the existing full spec. Existing scope and retry decisions retained. Investigation confirms the mapped media runner and lifecycle are the integration points. No unresolved intent gaps or irreversible operations; footprint spans contracts, API/worker, dashboard and tests with no migration.
- Implemented source probes, pre-render quality checks, failure synchronization, transactional retry, fresh queue IDs, edit recovery, derived reasons and auto-publish eligibility stub. Added editor/list controls and English/Arabic copy; corrected Arabic encoding during diff audit.
- Matrix audit: quality-failure composition test covers all five permanent media rows; exhausted-attempt/retained-job test covers transient failure and requeue; content lifecycle composition test covers retry conflicts, failure events, auto-publish on/off and edit recovery. Dashboard tests cover reason rendering and retry restrictions. All covering tests ran and passed.
- Review patches complete: shared assets recover across items; created editors observe content updates; retry refreshes held media/cache state and polling deadlines while preserving edits; unattached transient failures retain recovery; indeterminate duration is rejected. Independent nested MP4, extended header, WebM scale, replacement/retained-slide and complete editor retry regressions pass.

## Spec Change Log

## Review Triage Log

| ID | Layer | Verdict | Evidence / disposition |
| --- | --- | --- | --- |
| B1 | Blind | high | `syncSlideProcessing` only starts draft items and finishes processing items; a second failed item sharing the retried asset cannot recover. Patch the existing conditions and test shared assets. |
| B2 | Blind | medium | An unattached transient processing failure loses its form asset ID and cannot use item Retry. Preserve the existing local file/link recovery for this demonstrated state. |
| B3 | Blind | high | Held upload data and disabled media queries can override the scanned slide returned after retry. Patch cache/local synchronization and verify completion. |
| B4 | Blind | medium | Slide polling uses the first upload/mount time, so a retry after its deadline does not keep polling. Reset the attempt deadline. |
| B5 | Blind | high | The new editor replaces its URL without acquiring an item prop; invalidating its unobserved item query does not display the failure banner. Observe the created item and test the flow. |
| B6 | Blind | medium | Attachment validation reads assets before the lifecycle transaction, a race already present in Story 3.8's scanned/processed flow. Defer transaction-level attachment reconciliation with a concurrency regression. |
| B7 | Blind | medium | The development probe rejects WebM without Duration. Timestamp-derived duration support belongs with the production processor already deferred in Story 3.8; retain conservative rejection when duration cannot be established and record the compatibility limit. |
| B8 | Blind | high | The probe accepts zero `mvhd` duration, including fragmented containers whose actual duration is unknown. Patch conservative rejection so the duration limit cannot be bypassed. |
| B9 | Blind | maybe-false | The dev probe uses presentation dimensions, as the established adapter does; encoded-versus-presentation mismatch needs a representative merchant fixture/production stream probe to establish the impact. Defer unverified medium compatibility concern to production adapter validation. |
| B10 | Blind | medium | Ordinary nested handlers and version/size/scale branches lack independent fixture coverage. Patch representative parser tests and standardize the test builder layout. |
| E1 | Edge | high | Same demonstrated shared-asset state as B1. Group with B1 for the existing-condition patch. |
| E2 | Edge | high | Same held-upload/cache override as B3. Group with B3 for the cache/local synchronization patch. |
| E3 | Edge | high | Same unobserved new-editor content query as B5. Group with B5 for the item observation patch. |
| E4 | Edge | high | Same indeterminate fragmented-MP4 duration bypass as B8. Group with B8 for conservative duration validation. |
| V1 | Verification | medium | Nested `mdia/hdlr` is not exercised by direct-handler synthetic fixtures; the filed mutation demonstrates missing consumer verification. Add nested fixture/runner coverage with B10. |
| V2 | Verification | medium | Failed-item edit recovery is asserted only with an empty slide list; removing the failed→processing condition leaves tests green. Add actual PATCH replacement and retained-slide cases. |

All review fixes preserve the approved behavior and public surface. Corrections extend existing state handling and tests; no intent changes or destructive re-derivation are needed.

## Verification

**Commands:**
- Final verification after review patches: API 32 files / 643 tests, contracts 9 / 89, dashboard 25 / 326 passed. `pnpm turbo run lint typecheck build --continue`: 18 of 19 tasks passed; only the established `@slips/player#build` Windows doubled-drive path failure remains. `git diff --check` passed. No temporary `:5436/` test-source edits remain.
- Full final command output is recorded in system temp under `splice-story-3-9-verification/root-{api,contracts,dashboard,turbo}-final.log`. API tests used the existing test database on port 5436 with byte-for-byte restoration of test source afterward.
- Initial verification: API 640 tests, dashboard 323, contracts 89, DB 62, shared UI 101, player 20 passed. Arabic correction: 9 focused i18n tests plus dashboard lint/typecheck passed. Full lint/typecheck/build: 18/19 tasks passed; known player Windows path failure only.
- `pnpm -C packages/contracts test`, `pnpm -C apps/api exec vitest run` (DB on 5436), `pnpm -C apps/dashboard test` -- all pass.
- `pnpm turbo run lint typecheck build --continue` -- pass except `@slips/player#build`.
