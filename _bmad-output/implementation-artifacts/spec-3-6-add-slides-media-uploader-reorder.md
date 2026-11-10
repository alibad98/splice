---
title: 'Story 3.6: add slides with the media uploader and reorder them'
type: 'feature'
created: '2026-11-05'
status: 'in-review'
baseline_commit: 'a7141a31ffcee986e1bac5bafb5a5c2dbf54e7ff'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5-upload-media-directly-to-storage.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.5 can store media, but an item has no slides. The editor has no uploader, so merchants cannot add, caption or order images and videos.

**Approach:** `content` gets a `slides` table. Each slide references a `media_assets` id and has a position and alt text. Slides join the editable fields as an ordered list: `slides: [{ media_asset_id, alt_text }]` on POST/PATCH replaces the whole list, and `ContentItem.slides` returns them with the asset's kind and status. The editor gets a Slides card: a multi-file drop zone that pre-checks each file in the browser, then hashes it, gets a grant, PUTs with progress and completes it (3.5 API). Each slide shows Move earlier/later, drag, remove and alt text.

## Boundaries & Constraints

**Always:**
- `slides`: id, store_id, content_id, media_asset_id, kind (copied from the asset), position, alt_text, deleted_at, created_at, updated_at. RLS `FORCE`, grants as in 0017, cross-tenant seed, owner `content`. Only `content-lifecycle.ts` writes it. Only the store purge hard-deletes. A removed slide is soft-deleted. Re-adding the same asset revives that slide. One live slide per asset per item.
- At most `SLIDES_MAX` slides per item. `media_asset_id`s are unique within the list. Each id must be a store asset of the right status, read through a new batch `MediaService.getAssetsByIds`. Otherwise → 422 `media-not-attachable`.
- Alt text: optional for videos. Image slides need 1–`SLIDE_ALT_MAX` (250) chars, else 422 `slide-alt-text-required`. The editor enforces the same rule.
- A slides change emits `content.item.edited` with `changed` including `slides`. The item's status never changes (3.8/3.9 drive Processing).
- Browser pre-check, from shared contract limits: video ≤ 200 MB, ≤ 90 s, shorter side ≥ 720; image ≤ 10 MB, shorter side ≥ 1080; type in the allowed list. A rejection names the file and the limit. Resolution rejections also show the detected width × height in pixels, explain that both sides must meet the minimum, and ask for a higher-resolution original. The rejection alert offers “Replace files” to open the existing picker when editing is allowed and slide capacity remains; cancelling keeps the warning and existing slides. New selections go through the same pre-check and append only accepted files. No rejected file is hashed or requests an upload grant. Video metadata the browser cannot read (e.g. MOV in Firefox) skips duration and resolution (the server checks in 3.9). An unreadable image is rejected.
- Per-file states: Uploading n% → Processing (asset `uploaded`/`scanned`) → Failed with friendly reason. Retry re-uploads from the local file when it is still held. Upload errors (network, 429 with the wait) also show Retry. At most 3 uploads run at once. The leave guard is active while uploads run.
- Reorder in logical order. The live region announces "Slide 2 of 3". Focus stays on the moved slide's same button, or on the other one at an end. Drag uses native HTML5 drag-and-drop (desktop). Buttons work everywhere.
- Drafts autosave slides changes. Other statuses save them with "Save changes". Archived items are read-only.
- Copy in `ar`/`en`, logical CSS, AA. Build `DropZone` in `packages/ui` (dashed `input-border`, `rounded.base`, keyboard-openable picker, `accept`, `multiple`), plus a gallery entry and a registry row.

**Decisions (2026-11-05):**
- Thumbnails: the local file is the thumb during the upload session. After a reload, show a kind icon (image/video) with the slide number until 3.8 posters arrive. No serving endpoint is added.
- `SLIDES_MAX` = 10. The drop zone refuses files past the cap and says why.
- Attachable assets: any non-failed store asset. A failed asset is rejected (422), so the editor keeps it as a local Failed row and does not save it. A saved slide whose asset fails later shows Failed after a reload.
- Image alt text blocks every save, Drafts included. When an image upload finishes, its alt field gets focus if focus is not in another field, and an inline error shows once touched or on submit.

**Never:** Change item status, publish or gate publishing. Serve or hotlink media bytes. Add renditions or posters (3.8). Import from external links (3.7). Hard-delete slides or media. Add a drag library.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Drop 3 valid files | 2 JPG 1200px, 1 MP4 30 s 1080p | 3 slides upload in parallel with progress; saved in drop order | — |
| Pre-check fails | 12 MB PNG / 95 s video / 800px image | not uploaded; message names the file + limit | others in the batch continue |
| Low-resolution video | MOV with readable 480 × 854 metadata | warning shows dimensions, 720 px minimum for both sides, and higher-resolution-original guidance; no upload grant | valid files in the batch continue |
| Replace rejected files | click “Replace files”, then select a valid file | existing picker opens; accepted file is appended through the normal upload queue; warning is refreshed | cancelling preserves warning and valid slides; action disabled for read-only/full items |
| Image without alt | save | blocked; field error; summary on submit | API 422 `slide-alt-text-required` |
| Move later | slide 2 of 3 | becomes 3; "Slide 3 of 3" announced; focus kept | Move later disabled on last |
| Remove + re-add asset | PATCH lists | slide soft-deleted, then revived | — |
| Other store's / failed asset | PATCH | — | 422 `media-not-attachable` |
| Inspection fails | asset → `failed` `type_mismatch` | slide shows Failed + friendly reason | Retry only if local file held |
| Throttled | 429 on grant | slide Failed "try again in n min" + Retry | — |
| New item | files dropped before title | uploads run; slides saved with first create | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/media.ts` -- add `max_duration_seconds` (90, video) and `min_short_side` (720 video / 1080 image) to `MEDIA_LIMITS`; problem `MEDIA_NOT_ATTACHABLE`.
- `packages/contracts/src/v1/content.ts` -- `SLIDES_MAX`, `SLIDE_ALT_MAX`, `SlideInput {media_asset_id, alt_text: string|null}`, `slides` (optional) in `ContentFields`, `ContentSlide {id, media_asset_id, kind, alt_text, status: MediaAssetStatus, failure_reason}`, `slides: ContentSlide[]` on `ContentItem`, problem `CONTENT_SLIDE_ALT_REQUIRED`. Contract tests.
- `packages/db/src/schema/content.ts` + hand-written `migrations/0019_slides.sql` + journal entry (copy 0017's RLS/grants). Index (store_id, content_id, position). Partial unique (store_id, content_id, media_asset_id) where deleted_at is null. Add a seed to `schema/content.test.ts` TENANT_TABLES (`slides` is already in `OWNERSHIP.content`).
- `apps/api/src/modules/media/media.service.ts` + `media.repository.ts` -- `getAssetsByIds(storeId, ids)` → Map id → `{kind, status, failure_reason}` (one read).
- `apps/api/src/modules/content/content-lifecycle.ts` -- `create`/`edit` accept `slides`. A private `writeSlides(storeId, contentId, list, now)` soft-deletes the missing slides, revives or inserts the rest, and sets `position` = index. The edit diff compares slide lists by JSON. `fieldsOf` needs the current slides (`repo.liveSlides(contentId)`).
- `content.repository.ts` -- `liveSlides(contentIds[])` ordered by position. `content.controller.ts` -- `assertAttachable` (asset map, kind for alt rule) before the write; `withProducts` also attaches slides, with status from `MediaService` in one call. Import `MediaModule` in `content.module.ts`. `content.lifecycle.ts` -- export and purge `slides` (before items). `status-guard.test.ts` -- add a `slides` guard like `checkLinkWriteViolations`. OpenAPI in `apps/api/src/docs`.
- `apps/api/src/adapters/storage/s3-storage.ts` `ensureBucket` -- best-effort `PutBucketCors` for `CORS_ORIGINS` (PUT, `content-type`, `x-amz-checksum-sha256`). On failure, log and continue (MinIO allows any origin by default).
- `apps/dashboard/lib/api/media.ts` (new) -- `uploadMedia(client, file, kind, {onProgress, signal})`: sha256 via `crypto.subtle`, grant (`sendJson`), XHR PUT with grant headers, complete. `useMediaAssetStatus(id)` polls `GET /v1/media/:id` every 3 s while `uploaded` (max 2 min). Query keys in `query-keys.ts`.
- `apps/dashboard/components/content/editor/` -- `media-precheck.ts` (pure limits check plus a metadata reader via `<video>`/`Image`), `use-uploads.ts` (queue, concurrency 3, local object URLs revoked on unmount), `SlidesCard.tsx` (DropZone, slide list, alt `Field`s, move/drag/remove, live region). `form.ts` gets `slides` in `EditorValues`/schema/`toInput`/`fromItem`/`EDITOR_FIELDS` (alt ids `slide-alt-{asset}`). `ContentEditor.tsx` renders `SlidesCard` after `FormatTitleCard`, and the leave guard covers active uploads.
- `packages/ui/src/drop-zone.tsx` (new, export in `index.ts`), tests, gallery `apps/dashboard/app/(dev)/ui/Gallery.tsx`, registry row in `spec-ui-kit-global-components.md`.
- `i18n/messages/{en,ar}.ts` -- `content.editor.slides` group (limits, states, failure reasons, announcements). The parity test.
- Tests: `composition/content.test.ts` (live DB on 5436: matrix API rows, revive, cross-store, purge); dashboard `slides.test.tsx` (pre-check, reorder and announcement, focus, alt validation, upload flow with mocked XHR/fetch); `media-precheck.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] contracts: limits, slide schemas, problems (+ tests).
- [x] db: schema, migration 0019, RLS, seed.
- [x] API: media batch read, lifecycle slides write, controller checks + response, purge/export, guard test, OpenAPI, bucket CORS (+ composition tests).
- [x] ui: DropZone + tests + gallery + registry row.
- [x] dashboard: media API client, pre-check, uploads hook, SlidesCard, form wiring, i18n (+ tests).

**Acceptance Criteria:**
- Given a saved item with slides, when it is reloaded, then the slides come back in order with alt text and current asset status.
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- **Kinds into the lifecycle.** `ContentLifecycle.create/edit` take an optional `assetKinds` map (asset id -> kind) after `now`; the controller builds it from `MediaService.getAssetsByIds`. The lifecycle re-checks every slide (kind known from the map or the live slide, image alt text via the shared `slideAltTextOk`) before writing, so `SlideAssetUnknownError` -> 422 `media-not-attachable` and `SlideAltTextRequiredError` -> 422 `slide-alt-text-required`.
- **Saved failed slides.** On PATCH, an asset that is already a live slide of the item stays attachable even if it failed since (the editor re-sends the whole list), like the hidden-product exemption of 3.4. New failed, unknown or other-store assets answer 422.
- **Alt text** is stored trimmed, blank as null (API and editor agree, so the editor never reads as dirty after a save).
- **Editor model.** The form's `slides` holds every row (uploads in progress included) with a stable `key`; `toInput` sends only rows with an asset id. A new upload whose asset fails inspection gets its `media_asset_id` cleared, so it stays a local Failed row and is never sent. `patchOf` now compares fields by JSON (arrays).
- **Pre-check seam.** `mediaMetaReader.read` is replaceable (jsdom decodes no media). A video whose metadata does not load within 10 s, or errors, skips the duration/resolution checks. Files with an empty MIME type are classified by extension.
- **Bucket CORS** is set in `ensureBucket` (development boot) from `CORS_ORIGINS`; a refusal only logs `media bucket CORS not set`. Production buckets are not created at boot, so their CORS must be configured with the bucket (deployment step).
- **Rejected files** (pre-check or past the cap) are listed in one dismissible warning Alert above the list rather than as rows.
- **Resolution feedback (2026-11-11).** Reuse browser metadata to show actual dimensions in English and Arabic. “Replace files” opens the drop zone's picker; rejected files never become slide rows, so replacement adds accepted selections without removing existing slides. Keep the existing 720 px video / 1080 px image minimums and worker validation. Cropping does not fix insufficient source resolution; no crop modal, upscaling, browser encoder, extra upload or backend processing is introduced by this feedback change. Framing controls are a separate feature.
- **Refetch keeps pending uploads** (added in verification). When a newer item version resets the form (changed elsewhere, after a 409), rows whose upload is still held and not in the item are kept after its slides; before, they vanished while their uploads ran on. Tests: "a newer item version from a refetch..." and "a new item: files dropped before the title..." (matrix row "New item").
- **Not tried by hand:** the real browser PUT to MinIO (CORS, XHR progress); tests mock fetch, XHR and media metadata.

## Spec Change Log

- 2026-11-11: User authorized clearer resolution feedback, a replacement picker action, and corresponding spec updates. Added detected dimensions, actionable bilingual copy and replacement/cancellation behavior; media limits and processing policy are unchanged.

## Review Triage Log

## Verification

2026-11-11 resolution-feedback amendment: dashboard lint and typecheck pass. Targeted `media-precheck.test.ts`, `slides.test.tsx` and `i18n/i18n.test.ts`: 39 tests pass. Covers detected portrait/landscape dimensions, exact minimum acceptance, mixed-batch rejection without hashing/upload grants, replacement picker opening, accepted-slide preservation and warning refresh after valid replacement. Existing browser-unreadable MOV fallback is retained. The upload test fixture now stubs hashing so concurrent native hash completion cannot reorder its assumed asset IDs. No manual browser validation was performed for this amendment.

Ran 2026-11-05: contracts 81, db 59 (on 5436), API 523 (full suite on 5436), ui 101, dashboard 297 (299 after the verification fix) -- all pass. `pnpm turbo run lint typecheck build --continue`: 18/19, only `@slips/player#build` fails (known Windows path bug).

**Commands:**
- `pnpm -C packages/contracts test`, `pnpm -C packages/ui test`, `pnpm -C apps/dashboard test`, `pnpm -C packages/db test` (on 5436) -- pass.
- API suite on the Docker DB at 5436 (swap `127.0.0.1:5433` → `5436` in test files, run `pnpm -C apps/api exec vitest run`, swap back) -- pass.
- `pnpm turbo run lint typecheck build --continue` -- pass except `@slips/player#build`.
