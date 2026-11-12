---
title: 'Story 3.7: import media from an external link'
type: 'feature'
created: '2026-11-06'
status: 'in-review'
baseline_commit: 'cad065edffecfaeccf01750f22cf55f1cf5fb0c0'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-5-upload-media-directly-to-storage.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-6-add-slides-media-uploader-reorder.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Merchants can only add slides by uploading files. Media they already host elsewhere must be downloaded and uploaded again by hand.

**Approach:** `POST /v1/media/imports` `{ kind, url }` records an asset in a new `importing` status with its `source_url` and emits `media.asset.import_requested`. A worker job on the media queue fetches the URL through one SSRF-safe fetcher and stores the bytes at the normal upload key. It then fills in the hash, size and type, moves the asset to `uploaded` and emits `media.asset.uploaded`. From there the existing 3.5 inspection runs unchanged. The Slides card gets an "Add from link" field. The import becomes a slide right away and shows Importing → Processing → Failed with Retry.

## Boundaries & Constraints

**Always:**
- URL: `http`/`https` only, ports 80/443 only, no user info, at most 2048 chars. The API answers 422 `media-url-not-allowed` for a bad URL or a host that is a blocked IP literal. An import counts toward the per-store upload throttle (429 as for grants).
- Fetcher (`ports/external-fetcher.ts`, adapter `adapters/fetch/ssrf-safe-fetcher.ts`, node `http`/`https` with no new dependency): the IP is checked at connect time through a custom `lookup` on every resolved address, so DNS rebinding cannot get past it. IP-literal hosts are checked before connecting. Blocked: loopback, private, CGNAT, link-local (including 169.254.169.254), unique-local, multicast, reserved, unspecified, documentation, NAT64, and IPv4-mapped forms of all of these (`net.BlockList`). At most 3 redirects, each re-validated. Byte cap = the kind's `max_bytes` (from `Content-Length` and while streaming). Timeouts: 10 s to connect, 120 s in total. No cookies, `Accept-Encoding: identity`, a generic `User-Agent`.
- Job `media.asset.import` (media group, 3 attempts, store-scoped, `id = asset_id`). It runs only while the asset is `importing`. Outcomes:
  - blocked → `failed` `fetch_blocked`
  - over the cap → `fetch_too_large`
  - HTTP 4xx → `fetch_failed`
  - network error, timeout or 5xx → throw, so the job retries; after the final attempt → `fetch_failed`
  - sniffed type not allowed for the kind → `type_not_allowed` (or `type_mismatch` if it is allowed for the other kind)
  - otherwise → `uploaded`
  Every outcome emits its event in the same transaction.
- `media_assets`: new `source_url` column and `importing` status. `sha256`, `size_bytes`, `content_type` and `upload_key` are null only while `importing`, or when an import failed before fetching (enforced by a CHECK). Migration `0020`.
- Slides accept `importing` assets (they are not failed). `ContentSlide` gets `source_url` so Retry works after a reload. Retry starts a new import of the same URL and swaps the slide's asset.
- Editor: the URL field under the drop zone, with kind inferred as decided below. It respects `SLIDES_MAX`. Polling also covers `importing`. Copy in `ar`/`en`, with friendly reasons for the 3 new failure codes. AA, logical CSS.

**Decisions (2026-11-06):**
- Kind for a link: inferred from the URL path extension (`.jpg/.jpeg/.png/.webp` → image, `.mp4/.mov/.webm` → video) with no extra input; otherwise an Image/Video choice appears next to the field and is required. A wrong guess ends in `type_mismatch`.
- The spec is kept whole (~2,000 tokens).

**Never:** Fetch from the API process. Hotlink or serve the source URL. Follow redirects without re-checking. Add a fetch/HTTP library. Add a separate inspection path. Build renditions, duration or resolution checks (3.8/3.9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|----------|--------------|----------|----------------|
| Public JPEG link | `https://cdn.x/a.jpg` | asset `importing` → `uploaded` → `scanned`; slide shows Processing | — |
| Loopback / metadata | `http://127.0.0.1/`, `http://169.254.169.254/` | — | 422 `media-url-not-allowed` |
| DNS name resolving to 10.0.0.5 | worker | `failed` `fetch_blocked` | no retry |
| Redirect to private IP | 302 → `http://192.168.1.1/x` | `failed` `fetch_blocked` | — |
| Oversize | 250 MB video, or no Content-Length and the stream passes the cap | `failed` `fetch_too_large` | stream aborted |
| HTML page link | `text/html` body | `failed` `type_not_allowed` | — |
| 404 | — | `failed` `fetch_failed` | no retry |
| Server down | ECONNREFUSED ×3 | `failed` `fetch_failed` after attempt 3 | — |
| `ftp://`, `https://u:p@x`, port 8080 | POST | — | 422 `media-url-not-allowed` |
| Retry in editor | failed import slide | new import of the same URL; the slide points at it | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/media.ts` -- `importing` in `MEDIA_ASSET_STATUSES`. Reasons `fetch_blocked|fetch_failed|fetch_too_large`. `MEDIA_IMPORT_URL_MAX`, `MediaImportRequest`, `MEDIA_URL_NOT_ALLOWED`, `MEDIA_IMPORT_QUEUE`, `MediaImportJob`. `MediaAsset.content_type`/`size_bytes` become nullable. `events.ts` gets `media.asset.import_requested`. `content.ts` gets `ContentSlide.source_url`.
- `packages/db/src/schema/media.ts` + hand-written `migrations/0020_media_imports.sql` + journal entry. Drop and re-add the status and NOT NULL constraints with the importing CHECK. Seed rows keep working.
- `apps/api/src/ports/external-fetcher.ts`, `adapters/fetch/ssrf-safe-fetcher.ts` (+ `ip-policy.ts`, a pure check that the API reuses for literal hosts). Wire it in `infra.module.ts` / `buildInfra`, worker only.
- `apps/api/src/modules/media/media.service.ts` -- `importFromUrl` (validate, throttle in the same lock, where the count unions grants and imported assets, then insert + event). `media.repository.ts` -- `finishImport`, plus `source_url` in `summariesByIds`. `media-import.ts` (new) -- `MediaImporter.import` (reuses `readCapped`-style capping and `file-type`). `media-inspect.ts` -- narrow the nullable fields (asserted while `uploaded`). `media.controller.ts` -- route + 422.
- `apps/api/src/worker/media-jobs.ts` + `queues.ts` + `worker.ts` -- the handler `import_requested` → send `MEDIA_IMPORT_QUEUE`, and the job handler (final attempt → `fetch_failed`).
- `apps/api/src/modules/content/content.controller.ts` -- pass `source_url` into slides. OpenAPI in `apps/api/src/docs`.
- `apps/dashboard/lib/api/media.ts` -- `importMedia(client, url, kind)`, polling while `importing`. `components/content/editor/SlidesCard.tsx` -- a link form (Input + Add, plus the kind choice when the extension is unknown). The slide row keeps `source_url`. Retry → `importMedia`. `form.ts` -- `source_url` on `SlideValue` (not sent). i18n `content.editor.slides.link*` and the failure copy.
- Tests: `ssrf-safe-fetcher.test.ts` (a local `http` server with an injected allow-list for 127.0.0.1, covering the blocked IPv4/IPv6/mapped table, redirect re-check, cap, timeout, 4xx); `composition/media.test.ts` (on 5436, fake fetcher: the matrix outcomes, the full chain into inspect, the throttle, cross-store 404); contract tests; dashboard `slides.test.tsx` (add by link, failed + Retry, cap).

## Tasks & Acceptance

**Execution:**
- [x] contracts: statuses, reasons, import schemas, event, slide `source_url` (+ tests).
- [x] db: schema + migration 0020 + checks.
- [x] API: IP policy, fetcher port/adapter, service import + throttle, importer, inspect narrowing, controller, OpenAPI (+ tests).
- [x] worker: queue, event handler, job (+ tests).
- [x] dashboard: client, link form, retry, polling, i18n (+ tests).

**Acceptance Criteria:**
- Given an imported file, when it is stored, then it passes the same inspection as an upload (EXIF stripped, malware scan) and is never served from its source URL.
- Given `pnpm turbo run lint typecheck test build`, then all pass (except the known Windows-only `@slips/player#build`).

## Implementation Notes

- **IP policy location.** `ip-policy` lives in `apps/api/src/ports/fetch-url-policy.ts`, not `adapters/fetch/`: the lint boundary `api-module-no-adapter` forbids `modules/media` from importing adapters, and the media service reuses the check for IP-literal hosts. It is pure (`checkFetchUrl`, `isBlockedAddress` on `net.BlockList`). IPv6 outside 2000::/3 is blocked (covers loopback, unspecified, IPv4-compatible, NAT64, unique-local, link-local, site-local, multicast), plus 2001::/23, 2001:db8::/32, 2002::/16 and 3fff::/20; IPv4-mapped addresses are judged by their IPv4 address. A host that resolves to *any* blocked address is refused.
- **Fetcher seams.** `SsrfSafeFetcher` takes `resolve`, `allowAddresses` and `allowPorts` (tests only) plus the timeouts. It returns `ok | blocked | too_large | failed` and throws `ExternalFetchTransientError` for network errors, timeouts and 5xx. A redirect that fails the URL rules (scheme, port, user info, blocked literal) is `blocked`; more than 3 redirects or a 3xx without `Location` is `failed` (`fetch_failed`).
- **Wiring.** `InfraDeps.fetcher` is optional and `buildInfra` sets it only for the worker role. It is not bound in the Nest container, so the API cannot fetch. The worker refuses to boot without it.
- **Importer.** `MediaImporter.import` runs inside the job's store context with the asset row locked (`FOR UPDATE`), like the inspector. An empty body or an unknown sniffed type is `type_not_allowed`; a type allowed only for the other kind is `type_mismatch`. The fetched bytes go to `stores/{store_id}/uploads/{sha256}` (the normal, shared upload key), and the asset becomes `uploaded` with `media.asset.uploaded`, so the unchanged 3.5 inspection and release follow. Any throw on the final attempt (storage down included) records `fetch_failed`. `finishImport` only updates rows still `importing`.
- **Throttle.** `nthRecentIssueSince` unions upload grants and imported assets (`source_url is not null`) in the window, under the same advisory lock. Migration 0020 adds a partial index `(store_id, created_at) where source_url is not null` for it.
- **Migration 0020** also adds `media_assets_source_url_check` (1..2048 chars), `media_assets_importing_check` (the four file fields are set, or the asset is `importing` or `failed` with a `source_url`) and `media_assets_importing_source_check` (`importing` needs a `source_url`). `source_url` is now in the media export.
- **Contracts.** `ContentSlide.source_url` defaults to null on parse, so older fixtures still parse. `MediaImportRequest.url` is trimmed and capped at `MEDIA_IMPORT_URL_MAX` (a longer value is 400, as for other shape errors). The URL rules are 422s from the API. The `media.asset.import_requested` event carries no URL.
- **Dashboard.** The upload queue (`use-uploads.ts`) now holds a `source` (`file` or `link`), so links share the queue, the error mapping (429 wait, 422 → "This link can't be imported") and Retry. A link row shows Importing from Add until its asset leaves `importing`. Retry after a reload (no held source) re-queues the slide's `source_url` under the same row key. The new asset id then replaces the old one in the form, and the next save swaps the slide. Polling covers `importing` and lasts up to 10 minutes for imported slides (`MEDIA_IMPORT_POLL_MAX_MS`). The link check in the browser (`media-link.ts`) mirrors the API rules except the IP-literal check. The link field is not a nested form: Enter in it adds the link.
- **Known risks.** As with inspection, the import job holds a DB transaction and the asset row lock while it fetches (up to 120 s, 200 MB in memory, media concurrency 2). Fetched bytes put at the upload key are left behind if the outcome transaction then rolls back (the retry rewrites the same key; the store purge removes them). TLS or certificate errors count as transient, so they retry and then end `fetch_failed`. HTTPS through the real fetcher is not covered by tests (the local test server is plain http).

## Spec Change Log

## Review Triage Log

## Verification

Ran 2026-11-06: contracts 86, db 60 (on 5436), API 627 (full suite on 5436; re-run by the orchestrator after the policy move), dashboard 307 -- all pass. `pnpm turbo run lint typecheck build --continue`: only `@slips/player#build` fails (known Windows path bug).

**Commands:**
- `pnpm -C packages/contracts test`, `pnpm -C packages/db test` (on 5436), `pnpm -C apps/dashboard test` -- pass.
- API suite on the Docker DB at 5436 (swap `127.0.0.1:5433` → `5436` in the test files, run `pnpm -C apps/api exec vitest run`, swap back) -- pass.
- `pnpm turbo run lint typecheck build --continue` -- pass except `@slips/player#build`.


### Pilot review closeout — 2026-11-11

Closed within specified fetcher scope: import policy, SSRF/DNS/private-address/redirect restrictions, retry/byte/time bounds and shared pipeline checks pass. Deployed HTTPS/media compatibility remains launch validation.

Actual shared verification: API 677, dashboard 367, contracts 92, DB 62, UI 102 and player 62 unit tests passed; dashboard 16 and player 33 browser tests passed. All 26 repository lint/typecheck/test/build tasks succeeded. See [review-gap closeout](review-gap-closeout-2026-11-11.md) for commands, environment, initial failures, cache use and remaining acceptance/launch gates. These are executed results; older expected-only commands above remain historical.
