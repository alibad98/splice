---
title: 'Story 3.10: serve a preview manifest for one content item'
type: 'feature'
created: '2026-11-10'
status: 'done'
baseline_commit: 'a1560ec704e262ad07f60986f3285d3570210c7d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The player preview needs a manifest endpoint, contract and shared publishing compiler; none exists.

**Approach:** Introduce StoreManifest v1 and a reusable compiler in publishing, then expose `GET /v1/preview/content/{id}` for the authenticated merchant. Return one saved item with ordered slides, current product snapshot and playable asset URLs. Epic 4 will reuse the compiler for storefront publishing.

## Boundaries & Constraints

**Always:**
- Derive store identity exclusively from the merchant session. Return 404 for malformed, missing, deleted or other-store content IDs. Preview any live item regardless of publication status, schedule or placement; preview reads never change status or emit events.
- Manifest envelope: `v: 1`, `store_id`, `items`. Items carry ID, title, format, CTA label/action/URL/style, nullable product snapshot and ordered slides. Reuse existing content enums and product snapshot fields, including integer minor-unit prices, currency, availability, required-options and deleted flags. Slides carry ID, media asset ID, kind, alt text, media status, nullable source/poster URLs and rendition descriptors (profile, URL, content type, dimensions). Use explicit nulls/empty arrays for unavailable media; do not fabricate URLs.
- The pure compiler accepts snapshots and resolved URLs. Keep preview selection/fallback outside storefront eligibility; use one compiler.
- Processed images use the web rendition; processed videos expose available 480p/720p/1080p renditions and poster. While processing, prefer an available poster, otherwise the inspected source. Only scanned/processed assets may expose bytes: the fallback is the malware-scanned, sanitized `storageKey`, never the raw `uploadKey` or imported external URL. Uploaded/importing/failed assets remain placeholders.
- Add authenticated store-scoped media byte URLs for selected rendition profiles and the inspected source, backed by existing ObjectStorage streaming. Return 404 for unavailable/unsafe assets, unknown profiles or missing objects. Keep storage keys private. URLs are API-relative; consumers use the API origin and merchant credentials as with existing media endpoints.
- Manifest and new media responses use `Cache-Control: private, no-store`; retain the global session guard. No CDN publishing is introduced.

**Never:** Build the iframe/player/editor UI (3.11/3.12), placements, schedules, CDN distribution, new tables, migrations, storage signing infrastructure or public media access. Read another module's tables directly from publishing, serve uninspected uploads, hotlink imported media or send cart/analytics events.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Complete item | Session A, processed slides, linked product | Valid StoreManifest v1, exactly one item, live slides in saved order, snapshot and streamable rendition URLs | — |
| Partial draft | No slides/product or importing/uploaded/failed media | Valid one-item manifest, nullable product/media URLs, no unsafe fallback | — |
| Processing | Scanned video/image, inspected source present | Poster if available, otherwise authenticated inspected-source URL | Missing byte object returns 404 |
| Isolation | Session B requests A's item or media | No content or bytes leaked | 404 |
| Missing item | Deleted, unknown or malformed ID | No manifest | 404 |
| No session | Manifest or new media URL | No private data | 401 |
| Snapshot changes | Product price/availability or slide order updated | Next request reflects current saved state | — |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/v1/manifest.ts` (new), `v1/index.ts`, `src/index.ts` -- schemas/exports; reuse content/media enums and ContentProductSummary.
- `apps/api/src/modules/publishing/{manifest-compiler,publishing.service,preview.controller,publishing.module}.ts` (new) -- compiler, orchestration and route. Register in `apps/api/src/app.module.ts`.
- `modules/content/content.service.ts` -- scoped item/link/slides read via ContentRepository.findById/findLink/liveSlides; no writes.
- `modules/catalog/catalog.service.ts` -- reuse getProductsByIds, including hidden/deleted snapshots.
- `modules/media/{media.service,media.repository,media.controller}.ts` -- batch asset/rendition reads and streams via findAsset/findRendition, ObjectStorage.getStream and StreamableFile.
- `modules/session/access.guard.ts` -- reuse global authentication/no-store behavior.
- `docs/openapi.ts`, `docs/openapi.test.ts` -- schemas/routes; include PreviewController in route enumeration.
- `composition/preview.test.ts` (new) -- reuse content/media harness: Postgres non-owner RLS role, HTTP sessions, MemoryObjectStorage.

## Tasks & Acceptance

**Execution:**
- [x] Contracts files and tests — define and validate manifest, nested slide/rendition shapes and version.
- [x] Content/media owner services and media repository/controller — expose scoped reads and safe streams; cover fallback and denial cases.
- [x] Publishing files and app registration — compile once, serve one-item preview without writes.
- [x] OpenAPI files — document manifest and byte routes, authentication and responses.
- [x] Compiler unit tests and preview composition tests — verify the matrix, schema parsing, rendition selection, ordering, current snapshots, caching and streamed bytes.

**Acceptance Criteria:**
- Given owner-module boundaries, when preview compiles, then publishing uses exported services and owns the reusable compiler without writing domain state.
- Given the matrix fixtures, when exercised through HTTP, then every response and asset stream matches the specified isolation and safety behavior.
- Given the changed packages, when lint, typecheck, tests and builds run, then they pass; report any unavailable infrastructure or pre-existing failure explicitly.

## Implementation Notes

- Review patches complete: legacy CTA styles normalize to null, saved link destinations survive compilation, cookie sessions are verified on every new route, binary download schemas are explicit, and money assertions isolate each fractional-price rule. All retained findings were fixed; the existing OpenAPI colon-path generator defect is deferred.

- Matrix audit: complete item/current snapshot/order, partial draft/unsafe states, processing fallback, isolation/missing/auth, and no-write lifecycle cases are covered by the passing preview HTTP tests. Full API regression passed 649 tests and exposed a fixture ownership violation; replacing direct link/slide SQL with ContentLifecycle passed all 10 preview/guard tests without changing guards.

- Added exported StoreManifest v1 schemas and the pure publishing compiler. Preview selection uses only ContentService, CatalogService and MediaService reads; it does not apply storefront eligibility rules or write domain state.
- Preview uses authenticated API-relative `/v1/media/:id/renditions/:profile` and `/v1/media/:id/source` URLs. New streams require scanned/processed assets, reject raw upload keys, and return 404 for missing objects. Existing poster endpoint behavior is retained.
- Added HTTP composition coverage using a non-owner RLS role and MemoryObjectStorage. `PREVIEW_TEST_DATABASE_URL` optionally selects the test database; its default is the existing port 5433 convention.

## Spec Change Log

## Review Triage Log

| ID | Layer | Verdict | Evidence / disposition |
| --- | --- | --- | --- |
| B1 | Blind | low | A deleted poster object leaves its recorded URL selected, while the byte endpoint correctly returns 404 (explicit matrix behavior). Missing immutable objects are exceptional; reject adding storage probes/fallback branches for this case. |
| B2 | Blind | low | READ COMMITTED can briefly combine fields from concurrent saves; no revision/atomic snapshot guarantee exists and the next preview refresh corrects it. Reject new snapshot infrastructure for this transient case; existing content GET has the same read pattern. |
| B3 | Blind | low | Streams return the full entity with HTTP 200 rather than byte ranges. Playback remains valid; efficient seeking would need additional storage/HTTP protocol surface. Reject this optimization in the manifest story. |
| B4 | Blind | medium | Verified buildOpenApi preserves Express colon paths and omits path parameters for all existing routes. Defer the pre-existing generator defect, including the newly registered routes. |
| B5 | Blind | medium | New binary stream routes inherit plain string response schemas. Patch octet-stream generation to include binary format and assert it. |
| B6 | Blind | low | Fractional-price test is invalid for multiple reasons. Patch a complete product fixture and mutate each price independently. |
| B7 | Blind | low | New composition fixtures persist rows, matching existing composition-suite conventions. Small isolated UUID fixtures do not affect observed results; reject adding lifecycle cleanup/tracking to this change. |
| B8 | Blind | medium | New routes advertise cookie sessions but only bearer behavior is exercised. Patch direct-cookie success/cache and expired-session coverage. |
| E1 | Edge | low | Same confirmed READ COMMITTED race as B2; reject snapshot infrastructure for a transient preview during a concurrent save. |
| V1 | Verification | medium | Pre-verified: all preview fixtures use null CTA URLs, so replacing the saved URL with null passes. Patch an HTTP open_link case with its exact destination. |
| V2 | Verification | high | Existing content test preserves brand-blue; content serializer normalizes it to null, but publishing parses and throws. Patch by applying the same preset fallback and add a legacy-row regression. |

## Verification

- Final verification: API 34 files / 652 tests and contracts 10 files / 92 tests passed. Contracts/API lint, typecheck and builds passed; git diff --check passed. Logs: system temp/splice-3-10-final/{api,contracts,lint,typecheck,build,migrations}.log. Temporary test port substitutions were restored byte-for-byte.
- Local `pnpm db:migrate` succeeded against localhost:5434: up to date, 22 migrations applied. This story introduced no schema migrations.

- Contracts tests: 91 passed. Targeted preview/compiler/OpenAPI tests: 21 passed against the existing test Postgres on port 5436 using `PREVIEW_TEST_DATABASE_URL`.
- Contracts and API lint, typecheck and builds passed. No new migration or storage infrastructure is required.

- `pnpm -C packages/contracts test` and `pnpm -C packages/contracts build`.
- `pnpm -C apps/api exec vitest run src/modules/publishing src/composition/preview.test.ts src/docs` with the repository test database configured.
- `pnpm --filter @slips/contracts --filter @slips/api lint` and corresponding `typecheck` / `build` commands.


### Pilot review closeout — 2026-11-11

Closed: authenticated saved preview, protected inspected media, cross-store rejection and no-write behavior pass. Deferred OpenAPI colon paths are fixed with required path parameters and generator coverage.

Actual shared verification: API 677, dashboard 367, contracts 92, DB 62, UI 102 and player 62 unit tests passed; dashboard 16 and player 33 browser tests passed. All 26 repository lint/typecheck/test/build tasks succeeded. See [review-gap closeout](review-gap-closeout-2026-11-11.md) for commands, environment, initial failures, cache use and remaining acceptance/launch gates. These are executed results; older expected-only commands above remain historical.
