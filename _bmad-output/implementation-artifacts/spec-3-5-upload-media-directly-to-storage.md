---
title: 'Story 3.5: upload media directly to storage safely'
type: 'feature'
created: '2026-11-05'
status: 'in-review'
baseline_commit: '965cb6e43a3f0c17e9d0de8e485c7c43590771a5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-4-link-product-picker.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Merchants cannot upload any media yet. Nothing issues upload URLs, records assets, or checks what was uploaded, so slides (3.6), external import (3.7) and processing (3.8) have nothing to build on.

**Approach:** Add a `media` module that owns `media_assets` (plus `media_upload_grants` for issued URLs). It issues throttled, store-scoped, size-limited, content-addressed pre-signed PUT URLs through an `ObjectStorage` port (S3 adapter; MinIO locally). A complete call records the asset as `uploaded` and emits `media.asset.uploaded`. A worker job on the `media` queue verifies the hash, sniffs the type, strips image metadata, scans through a `MalwareScanner` port, and moves the asset to `scanned` or `failed` with a reason.

## Boundaries & Constraints

**Always:**
- `POST /v1/media/uploads` `{ kind: image|video, content_type, size_bytes, sha256 }` → `{ upload_id, url, method: 'PUT', headers, expires_at }`. Allowed types: image `image/jpeg|png|webp` ≤ 10 MB, video `video/mp4|quicktime|webm` ≤ 200 MB, else 422 `media-type-not-allowed` / `media-too-large`. The URL expires in 15 min and signs `Content-Length`, `Content-Type` and `x-amz-checksum-sha256`. The key is `stores/{store_id}/uploads/{sha256}`: store-prefixed and content-addressed.
- Throttle: more than `MEDIA_UPLOAD_RATE_LIMIT` grants (default 60) per store in the last 10 min → 429 `media-upload-rate-limited` with `Retry-After`, counter `slips_media_upload_throttled_total`, and a warn log with `store_id`. Counting is serialized per store with an advisory transaction lock.
- `POST /v1/media/uploads/:upload_id/complete` → HEAD the object. Missing → 409 `media-upload-missing`. Grant expired with no object → 410 `media-upload-expired`. Size differs from the grant → 422 `media-too-large` (object deleted). Otherwise it inserts `media_assets` (`uploaded`), emits `media.asset.uploaded` in the same transaction, and returns `MediaAsset`. It is idempotent: a second call returns the same asset. `GET /v1/media/:id` returns `MediaAsset` `{ v, id, kind, content_type, size_bytes, status, failure_reason, created_at, updated_at }`.
- Worker `media.asset.inspect` job (media queue, 3 attempts, store-scoped): it reads the object with a byte cap of the kind's limit and verifies sha256 (`checksum_mismatch`). It sniffs magic bytes. SVG or unknown → `type_not_allowed`; sniffed type ≠ declared → `type_mismatch`; undecodable image → `corrupt`. Images are re-encoded with all metadata (EXIF/GPS) removed. Clean bytes go to `stores/{store_id}/assets/{asset_id}/{sha256_of_clean}/original.{ext}` (immutable). The upload object is always deleted after inspection. Then `MalwareScanner.scan`: infected → `failed` (`malware`), objects deleted; clean → `scanned`. Each outcome emits `media.asset.scanned` or `media.asset.failed`. Failures that are not about the file (storage down) throw so the job retries; after the last attempt the asset is set `failed` (`inspection_failed`).
- Statuses `uploaded → scanned → processed | failed`; `processed` is written only by 3.8. `MediaService.publishableAssetIds(storeId, ids)` returns only `processed` ids, and later stories gate publishing on it.
- Metering: `MediaService.storedBytes(storeId)` sums `size_bytes` of the store's non-failed assets. Counter `slips_media_stored_bytes_total` adds bytes when an asset is scanned.
- Tables: non-null `store_id`, RLS `FORCE` + `tenant_isolation`, grants as in 0017, cross-tenant seeds, and `OWNERSHIP.media` gets `media_upload_grants`. A `mediaStoreData` lifecycle exports both tables and purges the store's objects (prefix `stores/{store_id}/`), then its rows, in batches.
- Env: `S3_ENDPOINT`, `S3_REGION` (default `us-east-1`), `S3_BUCKET` (default `slips-media`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` (default true). All are required in production. In development the bucket is created at boot if missing.

**Never:** Hotlink or serve the upload object. Trust the declared type or the client hash without checking. Write `content_items` or slides. Build the uploader UI (3.6), external fetch (3.7), renditions or video duration/resolution checks (3.8/3.9). Pick a malware vendor: only a dev `EicarMalwareScanner` adapter ships (it flags the EICAR test string). Name a real scanner as a deferred item.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Issue | image/jpeg, 2 MB | 201 URL, key `stores/{sid}/uploads/{sha}`, expires +15 min | — |
| Too big | video 201 MB / image 11 MB | — | 422 `media-too-large` |
| SVG declared | `image/svg+xml` | — | 422 `media-type-not-allowed` |
| Throttled | 61st grant in 10 min | — | 429 + metric + Retry-After |
| Complete | object present, size matches | asset `uploaded`, event once; repeat → same asset | — |
| Clean JPEG with GPS | inspect | stored copy has no EXIF; `scanned`; upload object gone | — |
| PNG bytes declared as JPEG | inspect | `failed` `type_mismatch` | — |
| SVG bytes declared PNG | inspect | `failed` `type_not_allowed` | — |
| EICAR in file | inspect | `failed` `malware`, objects deleted | — |
| Hash differs | inspect | `failed` `checksum_mismatch` | — |
| Other store's id | complete / GET | — | 404 |

</frozen-after-approval>

## Code Map

- `packages/db/src/schema/media.ts` (new; export in `schema/index.ts`) + `migrations/0018_media_assets.sql` via `pnpm --filter @slips/db db:generate`, then hand-add RLS/grants as in 0017. `media_upload_grants`: id, store_id, kind, content_type, size_bytes, sha256, storage_key, expires_at, completed_asset_id, created_at; index (store_id, created_at). `media_assets`: id, store_id, kind, content_type, size_bytes, sha256, upload_key, storage_key (nullable until clean), status, failure_reason, created_at, updated_at; index (store_id, status). Seeds go in a new `schema/media.test.ts` (copy `content.test.ts` TENANT_TABLES). `ownership.ts` adds `media_upload_grants`.
- `packages/contracts/src/v1/media.ts` (new; export from `index.ts`): limits table, `MediaUploadRequest/Grant`, `MediaAsset`, statuses, failure reasons, problem slugs, `MEDIA_INSPECT_QUEUE`, `MediaInspectJob` (JobMeta + asset_id). `events.ts` adds `media.asset.uploaded|scanned|failed` (owner `media`).
- `apps/api/src/ports/object-storage.ts` (new): `presignPut`, `head`, `getStream`, `put`, `delete`, `deletePrefix(prefix, limit)`. Adapters: `adapters/storage/s3-storage.ts` (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `unhoistableHeaders` for the checksum) and `memory-storage.ts` (tests).
- `apps/api/src/ports/malware-scanner.ts` + `adapters/scanner/eicar-scanner.ts`.
- `apps/api/src/modules/media/`: `media.module.ts`, `media.controller.ts` (session-scoped like `content.controller.ts`), `media.service.ts` (issue, complete, get, `publishableAssetIds`, `storedBytes`), `media-inspect.ts` (worker logic; `file-type` for sniffing, `sharp` for re-encode), `media.lifecycle.ts`. Register in `app.module.ts`; add tokens to `infra.module.ts` and `buildInfra`; add the lifecycle to the lifecycles list.
- `apps/api/src/worker/media-jobs.ts`: handler for `media.asset.uploaded` → `boss.send(MEDIA_INSPECT_QUEUE, …, singletonKey asset_id)`; log handlers for scanned/failed; job handler wrapped in `storeScopedJob`; `isFinalAttempt` → `inspection_failed`. Add the queue to `queues.ts` (`media` group) and wire it in `worker.ts`.
- `ports/telemetry.ts`: `MediaUploadThrottled`, `MediaStoredBytes`. `config/env.ts`: S3 + rate-limit vars. `.env.example`: bucket/region.
- OpenAPI docs for the 3 routes (follow content's pattern in `apps/api/src/docs`).
- Tests: `composition/media.test.ts` (live DB on 5436; memory storage; matrix rows, throttle, idempotent complete, cross-store 404, inspect outcomes with real sharp/file-type fixtures generated in-test, lifecycle purge). `s3-storage.test.ts`: presigned URL contains the expiry and signed headers (offline), plus an optional live MinIO round-trip skipped when port 9000 is down. Contract tests in `media.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] deps: add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `file-type`, `sharp` to `apps/api`.
- [x] db: schema, migration, RLS, ownership, cross-tenant seeds.
- [x] contracts: media types, events, problem slugs (+ tests).
- [x] API: ports and adapters, env, media module (issue/complete/get/throttle), lifecycle, OpenAPI (+ tests).
- [x] worker: queue, event handler, inspect job (+ tests).

**Acceptance Criteria:**
- Given an asset in `scanned` or `failed`, when `publishableAssetIds` is asked, then it is not returned; only `processed` is.
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- **Hash format.** `sha256` is 64 lower-case hex characters (used in the key); the API converts it to base64 for the signed `x-amz-checksum-sha256` header. The grant's `headers` are `content-type` and `x-amz-checksum-sha256`; `Content-Length` is signed but set by the client from the body (browsers cannot set it). The grant response also carries `v: 1` like every v1 response.
- **Inspection order.** The spec lists store-clean, delete-upload, then scan. The worker scans first (on the original bytes) and only then writes the clean copy and deletes the upload, so a scanner outage throws before anything is deleted and the retry still finds the upload. Same outcomes: infected leaves no objects; every verdict deletes the upload object.
- **`size_bytes` after scan** is the stored (clean) size, so `storedBytes` and `slips_media_stored_bytes_total` meter what is kept. `sha256` stays the upload hash; the clean hash is in `storage_key`.
- **Byte cap.** A body larger than the kind's limit, or whose hash differs, fails `checksum_mismatch` (it is not the declared file).
- **Type rules.** Sniffed type unknown or outside the six allowed types (SVG, GIF, ...) -> `type_not_allowed`; allowed but not the declared type -> `type_mismatch`. Images are re-encoded by sharp in their own format after applying the EXIF orientation (all metadata dropped); videos are stored as uploaded (3.8 handles them).
- **Final attempt.** The inspect job runs inside `storeScopedJob` (one transaction). On the last attempt the inspector records `failed` / `inspection_failed` and returns instead of throwing (a throw would roll the write back), best-effort deleting the upload object.
- **Inspect job dedupe.** pg-boss `singletonKey` alone does nothing on a standard-policy queue, so the job is sent with `id = asset_id` (and `singletonKey = asset_id`): a redelivered or repeated `media.asset.uploaded` never queues a second inspection.
- **Retry-After** is the time until the `limit`-th most recent grant in the window leaves it (at least 1 s).
- **Complete flow.** The grant is read and the object HEADed outside the write transaction; the write transaction re-locks the grant (`FOR UPDATE`) so two concurrent completes create one asset. An unknown or other-store upload id answers 404 `media_upload_not_found`.
- **Env.** `S3_REGION`, `S3_BUCKET` and `S3_FORCE_PATH_STYLE` have defaults, so production validation requires `S3_ENDPOINT`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`. Without them outside production the API boots with a storage that fails on use. In development the http and worker roles create the bucket at boot (a storage that is down only logs a warning). New: `MEDIA_UPLOAD_RATE_LIMIT` (default 60).
- **Migration** `0018_media_assets.sql` is hand-written with its journal entry (the repo keeps no drizzle snapshots, so `db:generate` would emit the whole schema), matching 0016/0017. It adds CHECKs on kind, size, sha256 format, status, and `failure_reason` iff `failed`.
- **Deferred.** A real malware scanner adapter (vendor not chosen; only `EicarMalwareScanner` ships and is wired in every environment, production included). Video metadata is not stripped (3.8).
- **Known risks.** Inspection buffers the whole file in memory (up to 200 MB per job, media concurrency 2) and holds the asset row lock and a DB transaction across storage I/O. Upload keys are content-addressed per store, so two uploads of the same bytes in one store share an upload object. Fixed in verification: the object is deleted only when no other `uploaded` asset or open grant uses the key (`MediaRepository.uploadKeyInUse`, used by the inspector and by the size-mismatch path of complete; test "Same bytes uploaded twice"). Remaining race: two inspections of the same key that commit at the same moment can each see the other and leave the upload object behind (it holds no published data and the store purge removes it).
- **Malware scanner.** Only `EicarMalwareScanner` ships and it is wired in every environment, production included, until a vendor is chosen (Q-05).

## Spec Change Log

## Review Triage Log

## Verification

Ran 2026-11-05: contracts 78, db 57 (on 5436), API 510 (full suite on 5436, incl. the live MinIO round-trip), ui 95, dashboard 282, player 20 -- all pass. `pnpm turbo run lint typecheck build --continue`: 18/19, only `@slips/player#build` fails (known Windows path bug).

**Commands:**
- `pnpm -C packages/contracts test`, `pnpm -C packages/db test` -- pass.
- API suite on the Docker DB at 5436 (swap `127.0.0.1:5433` → `5436` in test files, run `pnpm -C apps/api exec vitest run`, swap back) -- pass.
- `pnpm turbo run lint typecheck build --continue` -- pass except `@slips/player#build`.
