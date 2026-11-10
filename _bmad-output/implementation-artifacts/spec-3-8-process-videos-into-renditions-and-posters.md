---
title: 'Story 3.8: process videos into renditions and posters'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'e770cac23a2405bb0318a585521e0a2a40cd3181'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5-upload-media-directly-to-storage.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-6-add-slides-media-uploader-reorder.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-7-import-media-from-external-link.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Scanned media assets stop at `scanned`. No video renditions, posters, or web-optimized images are produced, `renditions` does not exist, `publishableAssetIds` always returns empty (`processed` is never written), content items never show `Processing` while their slide media is being processed, and the dashboard still shows icon placeholders after reload.

**Approach:** Add the `renditions` table (owned by `media`) and a `MediaProcessor` port (`ports/media-processor.ts`) with `DevMediaProcessor`. When an asset becomes `scanned`, `media.asset.scanned` queues a `media.asset.process` job on the `media` worker queue (3 attempts) that produces progressive MP4 renditions at `480p`, `720p` and `1080p` (where source resolution allows, never upscaling) plus a poster for videos, and a web-optimized WebP rendition for images, all at immutable store-prefixed, content-addressed paths. It inserts `renditions`, marks the asset `processed`, records `slips_media_processing_duration_seconds`, and emits `media.asset.processed`. Content items with in-flight slides move `draft -> processing` and return `processing -> draft` when all slides are `processed` via `ContentLifecycle` commands, and `GET /v1/media/:id/poster` serves the poster/thumb for `SlidesCard` and `ContentTable`.

## Boundaries & Constraints

**Always:**
- `renditions` table (migration `0021_renditions.sql`, owner `media`, already in `OWNERSHIP.media`): `id`, `store_id`, `asset_id` (no cross-table FK, facilitates batched purge), `profile` (`480p | 720p | 1080p | poster | web`), `content_type` (`video/mp4` for video renditions, `image/webp` or `image/jpeg` for `poster` and `web`), `width`, `height`, `size_bytes`, `sha256`, `storage_key`, `created_at`. Unique `(store_id, asset_id, profile)`, index `(store_id, asset_id)`. RLS `FORCE` + `tenant_isolation`, grants as in `0018`, cross-tenant seed in `packages/db/src/schema/media.test.ts`. `mediaStoreData` exports `renditions` and purges `renditions` before `media_assets`.
- Storage keys: `stores/{store_id}/assets/{asset_id}/{sha256}/renditions/{profile}.{ext}` (immutable, store-prefixed, content-addressed). No HLS (`m3u8` / `.ts`) is produced.
- Video renditions: target short-side tiers `480`, `720`, `1080` (`480p`, `720p`, `1080p`). A tier is produced iff `sourceShortSide >= tier` (or the source's own dimensions as the lowest tier when `< 480`, until 3.9 rejects `< 720p`); never upscale. Plus one `poster` (`image/webp`, 9:16 `720x1280`).
- Image processing: produces a `web` rendition (`image/webp`, quality 82, longer side capped at 1920 px without upscaling, metadata stripped via `sharp`) and marks the asset `processed`.
- Worker job `media.asset.process` (`MEDIA_PROCESS_QUEUE`, `media` group, 3 attempts, store-scoped, `id = asset_id`, `singletonKey = asset_id`, triggered by `media.asset.scanned`): runs only while the asset is `scanned`. Transient errors throw so pg-boss retries; on the final attempt (`isFinalAttempt`) the asset is set `failed` (`processing_failed`) and emits `media.asset.failed`. Success inserts the rendition rows, updates `media_assets.status = 'processed'`, emits `media.asset.processed`, adds the renditions' bytes to `slips_media_stored_bytes_total` (`MediaService.storedBytes` sums non-failed `media_assets.size_bytes` + their `renditions.size_bytes`), and observes `slips_media_processing_duration_seconds` (`kind` label) with histogram buckets up to `600` s (covering the 300 s NFR13 bound).
- Content status commands: only `ContentLifecycle` writes `content_items.status` (`status-guard.test.ts`). When a `draft` item is created/edited with any live slide whose asset is `importing | uploaded | scanned`, or when an attached slide's asset is in processing, `ContentLifecycle` applies `start_processing` (`draft -> processing`, emitting `content.item.processing_started`). When `media.asset.processed` fires (or slides are edited so all remaining live slides are `processed`) and all live slides of a `processing` item are `processed`, `ContentLifecycle` applies `finish_processing` (`processing -> draft`, emitting `content.item.processed`). Deleted items (`ContentNotFoundError`) are ignored.
- Poster endpoint & dashboard: `GET /v1/media/:id/poster` (merchant session required; 404 for unknown, other-store, or unready asset) streams the `poster` rendition for videos or `web` rendition for images with `Cache-Control: private, max-age=31536000, immutable`. `MediaAsset` and `ContentSlide` include `poster_url: string | null` (`/v1/media/{id}/poster` when `status === 'processed'`, else `null`). `SlidesCard` uses `poster_url` when no local `previewUrl` is held; `ContentTable` uses the first slide's `poster_url` when present, falling back to the format icon. `useMediaAssetStatus` polls while `importing | uploaded | scanned`, and `ContentEditor` keeps autosaving while `status` is `draft` or `processing`.

**Decisions (2026-11-10, Ali):**
- **Adapter (`DevMediaProcessor` + `sharp`).** Mirrors `EicarMalwareScanner` from 3.5: uses `sharp` for `web` image renditions and 9:16 `poster` images, parses video dimensions from MP4/MOV/WebM container headers in pure TypeScript, and writes progressive MP4 renditions per eligible tier without requiring `ffmpeg` in `node:24-alpine` or CI. Record a production managed-video/ffmpeg adapter in `deferred-work.md` under Q-05.
- **Full `draft -> processing -> draft` cycle in 3.8.** Items with in-flight slides move `draft -> processing` (`start_processing`) and return `processing -> draft` (`finish_processing`) when all live slides are `processed`; `processing` items still autosave edits in the editor. Story 3.9 adds quality-check failures (`fail_processing`), retry, and `auto_publish`.
- **Serve posters now (`GET /v1/media/:id/poster`).** Session-scoped endpoint + `poster_url` on `MediaAsset` and `ContentSlide`, wired into `SlidesCard` and `ContentTable`.

**Never:** Produce HLS playlists/segments. Upscale a video above its source resolution. Write `content_items.status` outside `content-lifecycle.ts`. Run `MediaProcessor` in the `http` role. Implement Story 3.9 quality-check rejection rules (`< 720p` video, `> 90 s` duration, no video track, auto-publish eligibility, or editor retry of failed processing).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1080p video scanned | `1080x1920` MP4 in `scanned` | `480p`, `720p`, `1080p` MP4 + `poster` stored & in `renditions`; asset `processed`; `media.asset.processed` emitted; duration metric observed | — |
| 720p video scanned | `720x1280` MP4 in `scanned` | `480p`, `720p` MP4 + `poster` produced (`1080p` skipped — no upscale); asset `processed` | — |
| Image scanned | `1200x2000` JPEG in `scanned` | `web` WebP rendition stored & in `renditions`; asset `processed`; `publishableAssetIds` includes it | — |
| Processor transient failure | processor throws on attempts 1 & 2, succeeds on 3 | retries via `media` queue policy; attempt 3 writes `renditions` and marks `processed` | — |
| Processor fails all 3 attempts | processor throws on attempt 3 (`finalAttempt`) | asset marked `failed` (`processing_failed`), `media.asset.failed` emitted, no partial rendition rows kept | — |
| Item processing cycle | `draft` item saved with `uploaded`/`scanned` slide, then asset finishes processing | item moves `draft -> processing` (`content.item.processing_started`), then `processing -> draft` (`content.item.processed`) once all live slides are `processed` | Deleted item ignored |
| Poster endpoint | `GET /v1/media/:id/poster` for `processed` video/image | 200 image bytes (`image/webp`), `Cache-Control: private, max-age=31536000, immutable` | Other store / unknown / not `processed` → 404 |
| Redelivered job | `media.asset.process` runs on an already `processed` asset | no-op; no duplicate renditions or events | — |
| Store purge | uninstalled store purged | storage objects deleted, then `renditions`, `media_upload_grants`, `media_assets` | — |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/media.ts` + `packages/db/migrations/0021_renditions.sql` + `migrations/meta/_journal.json` -- add `RENDITION_PROFILES = ['480p', '720p', '1080p', 'poster', 'web']`, `renditions` table; RLS/grants/checks matching `0018_media_assets.sql`; add `renditions` seed in `packages/db/src/schema/media.test.ts` (`TENANT_TABLES`).
- `packages/contracts/src/v1/media.ts`, `content.ts`, `events.ts` -- add `RENDITION_PROFILES`, `VIDEO_RENDITION_TIERS = [480, 720, 1080]`, `processing_failed` to `MEDIA_FAILURE_REASONS`, `poster_url: z.string().nullable()` to `MediaAsset` and `ContentSlide`, `MEDIA_PROCESS_QUEUE = 'media.asset.process'`, `MediaProcessJob`, and `'media.asset.processed'` in `EVENT_CATALOG` (owner `media`).
- `apps/api/src/ports/media-processor.ts` (new) & `apps/api/src/adapters/media/dev-media-processor.ts` (new) -- `MediaProcessor` port (`processVideo`, `processImage`) and `DevMediaProcessor` (`sharp` for `web` WebP and 9:16 `poster`, pure-TS MP4/MOV/WebM dimension parser + progressive MP4 tier generator); wire into `InfraDeps` (`infra.module.ts`, `http.ts`, worker-only like `fetcher`). Append Q-05 real video processor entry to `_bmad-output/implementation-artifacts/deferred-work.md`.
- `apps/api/src/ports/telemetry.ts` & `apps/api/src/adapters/telemetry/registry.ts` -- add `Metric.MediaProcessingDuration = 'slips_media_processing_duration_seconds'`; extend histogram `BUCKETS` in `registry.ts:7` with `30, 60, 120, 300, 600`.
- `apps/api/src/modules/media/media-process.ts` (new), `media.repository.ts`, `media.service.ts`, `media.controller.ts`, `media.lifecycle.ts`, `docs/openapi.ts` -- `MediaProcessorRunner.process(storeId, assetId, { finalAttempt })` reads the clean `storage_key` outside the row-lock transaction, runs `MediaProcessor`, uploads rendition objects to `stores/{store_id}/assets/{asset_id}/{sha256}/renditions/{profile}.{ext}`, then in the store transaction locks the asset (`FOR UPDATE`), inserts `renditions`, sets `status = 'processed'` (or `failed` / `processing_failed` on final attempt), and publishes `media.asset.processed` / `media.asset.failed`. Add `GET /v1/media/:id/poster` in `media.controller.ts`, `poster_url` on `MediaAsset` and `MediaService.getAssetsByIds`, and update `storedBytes` + `mediaStoreData` (`media.lifecycle.ts:17-36`) for `renditions`.
- `apps/api/src/modules/content/content-lifecycle.ts`, `content.repository.ts`, `content.controller.ts` -- pass slide asset statuses into `create`/`edit` so a `draft` item with in-flight slides (`importing | uploaded | scanned`) transitions to `processing` (`start_processing`), or a `processing` item whose edited slides are all `processed` transitions to `draft` (`finish_processing`). Add `syncSlideProcessing(tx, storeId, assetId)` called on `media.asset.scanned` and `media.asset.processed` to transition attached items (`draft -> processing` or `processing -> draft` when all live slides are `processed`), ignoring deleted items. Pass `poster_url` in `toContentSlide`.
- `apps/api/src/worker/media-jobs.ts`, `content-jobs.ts`, `queues.ts`, `worker.ts` -- add `MEDIA_PROCESS_QUEUE` to `QUEUES` (`media` group), queue it on `media.asset.scanned`, register `media.asset.processed` handlers, and wire `ContentLifecycle.syncSlideProcessing`.
- `apps/dashboard/lib/api/media.ts`, `components/content/editor/SlidesCard.tsx`, `components/content/editor/ContentEditor.tsx`, `components/content/ContentTable.tsx`, `i18n/messages/{en,ar}.ts` -- add `'scanned'` to `PENDING_STATUSES` in `media.ts:82`, enable autosave for `draft` and `processing` in `ContentEditor.tsx:101` and refetch item when slide assets finish processing, render `poster_url` in `SlidesCard` and `ContentTable` (using `apiUrl` from `lib/api/fetch.ts` with credentials), and add `processing_failed` failure copy in `en`/`ar`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/db/src/schema/media.ts` + `migrations/0021_renditions.sql` + `media.test.ts` -- add `renditions` table, RLS, checks, and cross-tenant seed -- stores per-asset renditions and posters under `media` ownership.
- [x] `packages/contracts/src/v1/media.ts` + `events.ts` + `content.ts` (+ tests) -- add rendition profiles, `processing_failed`, `poster_url`, `MEDIA_PROCESS_QUEUE`, and `media.asset.processed` -- shared wire and event contracts.
- [x] `apps/api/src/ports/media-processor.ts`, `adapters/media/dev-media-processor.ts`, `ports/telemetry.ts`, `adapters/telemetry/registry.ts` (+ unit tests) -- define `MediaProcessor` port/adapter and NFR13 duration histogram -- isolates media transcoding behind AD-15 port and tracks P95 duration up to 600 s.
- [x] `apps/api/src/modules/media/media-process.ts`, `media.repository.ts`, `media.service.ts`, `media.controller.ts`, `media.lifecycle.ts`, `docs/openapi.ts` (+ tests) -- implement worker processing, `GET /v1/media/:id/poster`, rendition storage/persistence, byte metering, and purge/export -- produces 480p/720p/1080p MP4s, posters, and web images.
- [x] `apps/api/src/modules/content/content-lifecycle.ts`, `content.repository.ts`, `content.controller.ts`, `worker/media-jobs.ts`, `worker/content-jobs.ts`, `worker/queues.ts`, `worker/worker.ts` (+ `composition/media.test.ts` & `composition/content.test.ts`) -- wire `media.asset.scanned` -> `media.asset.process` and `ContentLifecycle` processing status transitions -- drives item `Processing` -> `Draft` status via `content` commands.
- [x] `apps/dashboard/lib/api/media.ts`, `components/content/editor/*`, `components/content/ContentTable.tsx`, `i18n/messages/{en,ar}.ts` (+ dashboard tests) -- poll through `scanned -> processed`, render poster thumbnails in editor and list, autosave while `processing`, and add `processing_failed` copy -- keeps UI state and thumbnails synchronized with processing.

**Acceptance Criteria:**
- Given a `scanned` 1080p video asset, when `media.asset.process` runs, then progressive MP4 renditions at `480p`, `720p`, `1080p` and a `poster` exist at immutable paths in storage and `renditions`, the asset is `processed`, and `slips_media_processing_duration_seconds` records the sample.
- Given a `scanned` 720p video asset, when `media.asset.process` runs, then only `480p`, `720p` and `poster` are produced (no `1080p` upscale).
- Given a `scanned` image asset, when `media.asset.process` runs, then a web-optimized `web` rendition is stored and the asset is `processed`.
- Given an item with an in-flight slide, when viewed while processing runs, then its status is `processing`, and when all its slides reach `processed`, then its status returns to `draft` (written only by `ContentLifecycle`).
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- Added `renditions` table in `packages/db/src/schema/media.ts` and `packages/db/migrations/0021_renditions.sql` with forced RLS, `tenant_isolation` policy, and CHECK constraints on `profile`, `content_type`, positive `width`/`height`/`size_bytes`, and 64-hex `sha256`.
- Added `RENDITION_PROFILES`, `VIDEO_RENDITION_TIERS`, `processing_failed`, `poster_url` (`MediaAsset` and `ContentSlide`), `MEDIA_PROCESS_QUEUE`, `MediaProcessJob`, and `media.asset.processed` (`EVENT_CATALOG`, owner `media`) in `@slips/contracts`.
- Created `MediaProcessor` port (`apps/api/src/ports/media-processor.ts`) and `DevMediaProcessor` (`apps/api/src/adapters/media/dev-media-processor.ts`), wired into worker `InfraDeps` only, and logged the production transcoder adapter under Q-05 in `_bmad-output/implementation-artifacts/deferred-work.md`.
- Implemented `MediaProcessorRunner` (`apps/api/src/modules/media/media-process.ts`), `GET /v1/media/:id/poster` (`Cache-Control: private, max-age=31536000, immutable`), `renditions` export/purge in `mediaStoreData`, and rendition byte accounting in `MediaRepository.storedBytes()`.
- Extended `ContentLifecycle` (`apps/api/src/modules/content/content-lifecycle.ts`) so `create`/`edit` and `syncSlideProcessing` transition `draft -> processing` (`start_processing`) when in-flight slides (`importing | uploaded | scanned`) are attached and `processing -> draft` (`finish_processing`) when all live slides reach `processed`.
- Updated dashboard media polling (`PENDING_STATUSES` includes `'scanned'`), `SlidesCard` and `ContentTable` poster thumbnails, `ContentEditor` autosave + status refresh while `processing`, and EN/AR `processing_failed` failure copy.

## Spec Change Log

## Review Triage Log

| # | Reviewer | Severity | File:Line | Finding | Disposition | Notes |
|---|----------|----------|-----------|---------|-------------|-------|
| 1 | blind-hunter, edge-case-hunter, verification-gap | high | `apps/dashboard/lib/api/fetch.ts:78`, `ContentTable.tsx:27`, `SlidesCard.tsx:561` | `apiUrl()` only reads `NEXT_PUBLIC_API_URL` (unconfigured) instead of `SessionClient`'s `apiBase`, and embedded bearer mode requires authenticated `apiFetch` for `/v1/media/:id/poster`. | patch | Expose `apiBase` on `SessionClient`, accept `apiBase` in `apiUrl()`, and add `usePosterSrc` in `lib/api/media.ts` that resolves against `session.client.apiBase` (and fetches a blob URL via `client.apiFetch` in embedded bearer mode). |
| 2 | blind-hunter, edge-case-hunter, verification-gap | high | `apps/dashboard/components/content/editor/ContentEditor.tsx:73-82,123` | Refetch triggered by `onAssetProcessed` invalidation sees a newer `updated_at` and calls `reset(...)`, wiping out unsaved merchant edits; test mounted `ContentEditor` instead of `ContentEditorPage`. | patch | In `ContentEditor.tsx` refetch effect, skip `reset(...)` when the item remains editable (`status !== 'archived'`) and editable fields (`saveKey(fromItem(item)) === saveKey(fromItem(prev))`) have not changed; update `editor.test.tsx` to mount `ContentEditorPage` and verify refetch + preservation of unsaved edits. |
| 3 | edge-case-hunter | medium | `apps/dashboard/components/content/editor/SlidesCard.tsx:470-473` | If a polled asset reaches `processed` before initial create/save populates `saved`, `onAssetProcessed` fires once before `savedRef` has the slide. | patch | Re-run the `onAssetProcessed` effect when `saved?.status` changes (`if (processedId && polled.data && saved?.status !== 'processed')`). |
| 4 | blind-hunter, verification-gap, edge-case-hunter | medium | `apps/api/src/adapters/media/dev-media-processor.ts:8,38-39` | `MAX_IMAGE_PIXELS` is `40_000_000` in `DevMediaProcessor` vs `50_000_000` in `media-inspect.ts`; `buildMp4Buffer` left-shift can go signed negative for widths `>= 32768`; `< 480p` no-upscale fallback lacks unit test. | patch | Reuse `MAX_IMAGE_PIXELS` from `media-inspect.ts`, use `>>> 0` in `buildMp4Buffer`, and add a `360x640` test case in `dev-media-processor.test.ts`. |
| 5 | blind-hunter, edge-case-hunter | medium | `apps/api/src/modules/media/media-process.ts:145-166` | Final DB transaction runs outside `try/catch` after uploading rendition objects; if asset is no longer `scanned` or DB write fails, uploaded rendition objects remain orphaned in storage. | patch | Move final `inStore` persistence inside `try` and clean up `uploadedKeys` if `!locked \|\| locked.status !== 'scanned'` or if DB persistence throws. |
| 6 | edge-case-hunter | medium | `apps/api/src/modules/content/content-lifecycle.ts:264-305` | `syncSlideProcessing` reads `liveSlides` before acquiring row locks in `apply`. | patch | Lock each candidate item (`lockById`) before reading its live slides and computing `anyInFlight` / `allProcessed`. |
| 7 | verification-gap | medium | `apps/api/src/composition/content.test.ts:955` | Missing test coverage for `PATCH /v1/content/:id` editing a `processing` item's slides to all-`processed` (`finish_processing` in `edit`) and for `media.asset.scanned` event handler (`draft -> processing` in `syncSlideProcessing`). | patch | Add both assertions to the Story 3.8 processing cycle test in `apps/api/src/composition/content.test.ts`. |
| 8 | blind-hunter, edge-case-hunter | low | `apps/api/src/composition/content.test.ts:946` | Predicate accidentally changed from `i.id === item.id` to `i.id`. | patch | Restore `listed.items.find((i) => i.id === item.id)`. |
| 9 | blind-hunter | low | `apps/api/src/modules/media/media.repository.ts:199` | `MediaRepository.findRenditions` is unused in Story 3.8 (only `findRendition(assetId, profile)` is called). | patch | Remove unused `findRenditions` until preview manifest story (3.12). |
| 10 | blind-hunter | medium | `apps/api/src/worker/content-jobs.ts:33` | `media.asset.failed` does not transition `processing` items (`fail_processing`). | reject | Explicitly out of scope per frozen spec (`Never: Implement Story 3.9 quality-check rejection rules` and Decision 2: Story 3.9 owns `fail_processing`, retry, and `auto_publish`). |

## Verification

**Commands:**
- `pnpm -C packages/contracts test` -- 9 files, 88 tests passed.
- `pnpm -C packages/db test` (on 5436) -- 6 files, 62 tests passed.
- `pnpm -C apps/api exec vitest run` (on 5436) -- 32 files, 636 tests passed.
- `pnpm -C apps/dashboard test` -- 25 files, 312 tests passed.
- `pnpm turbo run lint typecheck build --continue` -- all passed except the known Windows-only `@slips/player#build` (`D:\D:\...` path bug in `check-size.mjs`).