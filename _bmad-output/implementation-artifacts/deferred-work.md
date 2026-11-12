- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: CI should smoke-run both Docker images (http health check, worker against a Postgres service).
  evidence: Images are built but never started; severity medium (unverified until CI runs once).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-monorepo-ci.md`
  summary: Pin the MinIO image to a verified release tag or digest.
  evidence: docker-compose.yml uses minio/minio:latest; the tag couldn't be verified from the sandbox.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Error tracking has no vendor sink; captured errors are only logged (redacted) at error level.
  evidence: Observability vendor is deferred (Q-05). Add an adapter behind Telemetry.captureError when chosen.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Alert rules in ops/alert-rules.json are not loaded by any alerting backend yet.
  evidence: No hosting or monitoring vendor exists; wire the file into the chosen backend and route owners to real on-call contacts.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Queue age metric depends on pg-boss readyOldestSeconds, which is null until a monitor pass counts the queue.
  evidence: Reported as 0 meanwhile; verify against a real backlog when the first queue lands.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Feature flags are env-backed; AD-22 names a config table.
  evidence: Move to a DB table behind the FeatureFlags port once the schema and tenancy stories land (1.6).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-observability-baseline.md`
  summary: Dashboard SLI counting trusts an x-slips-client header or /v1/dashboard path prefix.
  evidence: Fine for metrics; revisit when dashboard auth (1.9) defines the dashboard API surface.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-transactional-domain-event-transport.md`
  summary: The http role has no pg-boss producer yet; publishEvent needs a send-only PgBoss in the http infra when the first module publishes.
  evidence: events.dispatch is created by the worker at boot, so publishing before the first worker boot fails on the queue foreign key.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-transactional-domain-event-transport.md`
  summary: event_deliveries is never pruned; slips_app has no DELETE on it.
  evidence: Add a retention job (owner role or a granted function) deleting rows older than the pg-boss archive window (7 days) plus margin.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Salla OAuth/user-info/Admin API shapes, refresh-failure semantics and webhook signature are fixture-only (verify in Story 1.11-1.13).
  evidence: Desk research only; no Salla credentials or demo store exist.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Dashboard connection chip still shows the not-connected placeholder.
  evidence: Needs the merchant session of Story 1.9; connectionFromStatus and IntegrationService.getConnection are ready.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Reinstall restore of uninstalled stores and install_epoch increments are not implemented (Story 1.10).
  evidence: installFromTokens throws StoreLifecycleConflictError for uninstalled/purged stores.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: Master key rotation is not wired in env config, and token_access_log has no retention job.
  evidence: See docs/runbooks/token-encryption-key.md.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-salla-oauth-install-secure-tokens.md`
  summary: http-role event publishing needs the worker to have booted once (pg-boss schema, queue, app-role grants).
  evidence: grantEventPublishing runs at worker boot; deploy order must be migrate, worker, http.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-sign-in-embedded-and-direct.md`
  summary: Embedded introspection shape (exchange-authority endpoint, S-Source, merchant_id/exp) and iframe behaviour (getToken from URL, auth.refresh, Sec-Fetch-Dest, s.salla.sa origin) are source-derived only.
  evidence: verify in Story 1.11-1.13 on a real store; EMBED_ALLOWED_ORIGIN overrides the framing origin.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-sign-in-embedded-and-direct.md`
  summary: No throttle on POST /v1/session/embedded and no retention job for merchant_sessions (lazy per-store delete only).
  evidence: Add with the other retention jobs; low risk at pilot scale.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-sign-in-embedded-and-direct.md`
  summary: Cookie sessions need API and dashboard on the same site (SESSION_COOKIE_DOMAIN); CSRF relies on SameSite=Lax plus the x-csrf-token header, no Origin check; direct-link sign-in re-runs the full OAuth install path.
  evidence: Add to the deploy runbook; consider a sign-in-only grant after Story 1.10.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-sign-in-embedded-and-direct.md`
  summary: No browser end-to-end test of the iframe flow; Admin sign-in provider is a deny-all stub until Epic 7.
  evidence: Unit, render and live-Postgres composition tests only.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-sign-in-embedded-and-direct.md`
  summary: Verify app binding of the embedded token in Story 1.11-1.13 (the documented introspection response has no app id/audience; the adapter checks app_id/aud/client_id only if present, otherwise relies on the S-Source header).
  evidence: Security review.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-sign-in-embedded-and-direct.md`
  summary: Owner to confirm staff access: any Salla user who can open the app in a store's dashboard gets that store's merchant session (one merchant account per store, no team roles in the MVP).
  evidence: platform_user_id is stored on the session row and logged for audit.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-full-product-catalog.md`
  summary: A full catalog sync only upserts; products and categories deleted in Salla keep their rows (visible, in stock) until Stories 2.5/2.6 remove or hide them.
  evidence: CatalogSync never deletes; a reinstall resync leaves rows for products removed on the platform. Review 2026-11-01 (blind-hunter, edge-case-hunter).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-full-product-catalog.md`
  summary: Page-number paging can skip or repeat products when the merchant edits the catalog during a sync or between a failure and its resumed retry.
  evidence: Salla /products is offset-paged; resume uses next_page. The Story 2.6 daily reconcile should catch misses (or page by updated_at).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-full-product-catalog.md`
  summary: A catalog sync that exhausts its 5 attempts stays `failed` with no automatic resync, the state reads `failed` between retries, and skipped-product counts are only logged.
  evidence: Story 2.3 (manual sync, last sync time) should add the resync trigger and show retrying vs given up and skipped counts.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-full-product-catalog.md`
  summary: UNVERIFIED (would be medium) -- if Salla's /products omits `pagination` on a multi-page store, the sync stops after page 1 and reports success.
  evidence: Settle with the Task 1 recorded products page; if pagination can be absent, fall back to "has more while the page is non-empty".
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-full-product-catalog.md`
  summary: startWorker's handler and event wiring (integration and catalog) has no test; dropping registerCatalogEventHandlers would pass CI.
  evidence: Extract a buildWorkerHandlers(pool, infra, boss, events) and assert the registry has the catalog triggers and the queue handlers.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-browse-products-page.md`
  summary: Stores installed before Story 2.1 have sync status `never` and the Products page shows "Syncing your products..." forever while polling two endpoints every 5 s.
  evidence: No sync row exists until a full sync runs; the approved 2.2 matrix maps `never` to the syncing state. Story 2.3's manual sync gives these stores a way out; consider capping the poll there.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-browse-products-page.md`
  summary: Product name search does not fold Arabic letter variants (أ/إ/آ→ا, ة/ه, ى/ي) or strip tashkeel, so "عبايه" does not find "عباية".
  evidence: `CatalogReadRepository.where` uses plain `ilike`; normalize both sides (e.g. translate + regexp_replace) with tests.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-manual-sync.md`
  summary: Wave-1 UI kit first-load budget is already used up (Button, Spinner, Toast add 15.2 KB to /products; Radix Toast ~20.8 KB); lazy-load the Toaster.
  evidence: Story 2.3 build measurement against the UI-kit spec's 15 KB wave-1 budget.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-manual-sync.md`
  summary: Toast uses an inline close SVG and the "Last synced" exact-time hint is not Escape-dismissable; move `Icon` into packages/ui and use the wave-2 Tooltip.
  evidence: UI-kit spec forbids a second icon set and requires WCAG 1.4.13 for hover content.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-manual-sync.md`
  summary: No test proves the merchant layout mounts the Toaster.
  evidence: Tests render their own Toaster; the dashboard has no harness for async server layouts.

## Deferred from: code review of spec-ui-kit-global-components (2026-11-03)
- source_spec: `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md`
  summary: Hard-coded colours outside tokens (Salla button teal, DotField canvas RGB, `bg-black/40` scrims).
  evidence: Partner brand colour and canvas drawing need a token-reading helper; revisit with the next design pass.
- source_spec: `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md`
  summary: Skeleton is not boneyard-based yet (only a `data-boneyard-bone` attribute and `animate-pulse`).
  evidence: Registry row 1 says boneyard; wire it when the first skeleton-heavy page lands.
- source_spec: `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md`
  summary: Wave-1 acceptance items still open (Products states on kit Alert/EmptyState/Skeleton, budget report, AA check, impeccable pass).
  evidence: Tasks checkboxes unchecked; close with the wave-1 sign-off.
- source_spec: `_bmad-output/implementation-artifacts/spec-ui-kit-global-components.md`
  summary: Two icon sets in the dashboard (`components/shell/Icon` and the kit `Icon`).
  evidence: SessionActions.tsx and AppShell.tsx import both; migrate shell icons to the kit.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-apply-product-webhooks.md`
  summary: Untested lost-race branch in `CatalogRepository.applyProduct` (guarded upsert returns no row after the read).
  evidence: Practically unreachable under the `for update` row lock plus the `catalog-product` advisory lock; testing needs an artificial interleaving.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-apply-product-webhooks.md`
  summary: A product webhook needing a fetch for a disconnected store retries as `internal`, then dead-letters (`getAccessToken` throws `StoreDisconnected*`).
  evidence: Story 2.7 (pause sync when disconnected) should skip or park these; reconciliation repairs after reconnect.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-apply-product-webhooks.md`
  summary: Partial product payloads (`product.quantity.low`, `product.available`) might map with defaults and overwrite fields (unverified, medium if true).
  evidence: Settle by recording real deliveries on the demo store with the webhook recorder and adding them as fixtures.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-reconcile-catalog-daily.md`
  summary: The daily `catalog.reconcile.schedule` cron registration in `startWorker` (like the webhook sweep cron) has no test; deleting the `boss.schedule` line passes CI.
  evidence: No worker-startup test harness exists. Covering it needs a `startWorker` seam (e.g. an extracted `registerSchedules(boss, selected)`) that tests can call with a fake.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-reconcile-catalog-daily.md`
  summary: UNVERIFIED (medium if true). A truncated or empty listing turns most live products into deletion candidates. That means unbounded sequential `products.get` calls, and a mass tombstone if Salla's 404 were systemic.
  evidence: Confirm-before-delete protects against a bad listing only while `get` answers correctly. Settle Salla's 404 behaviour with the webhook recorder (Story 2.5 deferred). If it is not trustworthy, add a candidate cap (e.g. abort and alert when more than X% of live products are absent).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-pause-sync-disconnected.md`
  summary: The dashboard's session connection is read only at sign-in or page load. A store that disconnects mid-session shows no banner, and Sync stays enabled, until the next full page load or re-sign-in.
  evidence: `session-client.ts` derives `connection` once, and client navigation does not rerun the server layout. Fix with a session refresh, e.g. refetch the session describe when `GET /v1/catalog/sync` reports `failed`/`store_inactive`, or on window focus.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-pause-sync-disconnected.md`
  summary: `integration.isStoreActive` (the storefront content-endpoint check, AD-20) returns false for `disconnected`, so a disconnected store's storefront would go empty. That contradicts the Story 2.7 rule "storefront content keeps serving last data".
  evidence: Pre-existing and with no caller yet; the Epic 4 content endpoint will call it. Decide there: serve for `active` and `disconnected`, and empty only for uninstalled, purged and unknown stores. Then update the AD-20 wording.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-content-model-lifecycle.md`
  summary: "`undo_archive` (and billing's `reactivate`) return an item to `published` or `scheduled` without any publish-eligibility or plan-limit check, so archive-then-undo could get around Epic 4 placement rules or Epic 7 limits."
  evidence: "No eligibility or limit gate exists in Story 3.1. When Story 3.9 / Epic 4 adds the publish eligibility check and Story 7.4 adds limit enforcement in `content`, apply the same gate to every transition into `published`/`scheduled` (undo_archive, reactivate, go_live). Also consider limiting how long Undo stays available."
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-content-model-lifecycle.md`
  summary: "Nothing tests that `startWorker` registers a handler for every catalogued domain event (content, catalog, integration). A missing `register*EventHandlers` call would make every such event fail dispatch in production."
  evidence: "Extract the three `register*EventHandlers` calls in `worker.ts` into an exported `registerAllEventHandlers(registry, boss, telemetry)`, and add a `worker.test.ts` case asserting `handlersFor(name).length > 0` for every `EVENT_CATALOG` name."

## Deferred from: code review of spec-3-1-content-model-lifecycle.md (2026-11-04)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-content-model-lifecycle.md`
  summary: "deactivated → archive → restore yields a `draft` with `reactivate_to` cleared, which the merchant can later publish past billing's deactivation."
  evidence: "Story 7.4's limit gate must apply to every transition into `published`/`scheduled` (including publish from a restored draft), as recorded above."
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-content-model-lifecycle.md`
  summary: "Items archived while `deactivated` are skipped by billing's upgrade `reactivate` (it targets `status = 'deactivated'`); after Undo they return to `deactivated` and stay there."
  evidence: "Epic 7: on upgrade, also handle `archived` rows with `reactivate_to` set (e.g. clear the deactivation so Undo returns to `reactivate_to`)."
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-content-model-lifecycle.md`
  summary: "`undo_archive`/`reactivate` can return an item to `scheduled` after its go-live or end time passed while it was archived/deactivated."
  evidence: "Epic 4: re-check the schedule on `content.item.unarchived`/`content.item.reactivated` (go live or end immediately)."
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-content-model-lifecycle.md`
  summary: "Deleting an item while `processing` makes media's later `finish_processing`/`fail_processing` hit `ContentNotFoundError`."
  evidence: "Story 3.8/3.9: treat `ContentNotFoundError` as terminal in the media job (ack, clean up the upload)."
- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-link-product-picker.md`
  summary: `lifecycle.test.ts` "the sweep finishes pending webhooks and queues a purge…" fails once the shared test DB holds over 100 due `store_purge_schedule` rows, because `duePurges` takes the 100 oldest.
  evidence: 2026-11-05 the Docker test DB (5436) had 132 leftover schedules from earlier runs; the test passed after clearing them. Fix: give the test its own due window/limit or clean schedules in its setup.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-upload-media-directly-to-storage.md`
  summary: Replace the dev-only `EicarMalwareScanner` with a real `MalwareScanner` adapter, and refuse to boot in production without one.
  evidence: Story 3.5 ships no vendor (AD-15, Q-05 hosting undecided); the EICAR adapter is wired in every environment today.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-upload-media-directly-to-storage.md`
  summary: Stream media inspection (hash, sniff, scan) instead of buffering whole files, and do storage I/O outside the asset-row transaction.
  evidence: Story 3.5 buffers up to 200 MB per job (media concurrency 2) and holds a DB transaction across storage calls; revisit with 3.8 video processing.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-8-process-videos-into-renditions-and-posters.md`
  summary: Replace `DevMediaProcessor` video transcoding with a real FFmpeg/cloud `MediaProcessor` adapter once hosting is chosen (Q-05), and refuse to boot in production without one.
  evidence: Story 3.8 uses `sharp` for real WebP image optimization and poster generation, and a deterministic in-process MP4 generator for video renditions until Q-05 is resolved.
  update_2026_11_11: Superseded for adapter implementation: apps/api/src/http.ts imports FfmpegMediaProcessor and wires it for workers with env.FFMPEG_PATH. Production runtime FFmpeg, representative media, limits and playback verification remain open in pilot-readiness.md; the separate EicarMalwareScanner production gap remains open. Historical evidence above is retained.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-9-run-quality-checks-retry-failures-auto-publish.md`
  summary: Reconcile media status atomically when attaching slides so completion/failure events cannot race the attachment transaction.
  evidence: Attachment validation already reads media outside the lifecycle transaction in Story 3.8; an event delivered before the slide write sees no referencing item, and the subsequent write can use stale status. Verify with an interleaved event/attachment integration test.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-9-run-quality-checks-retry-failures-auto-publish.md`
  summary: Extend the production processor probe to support WebM without Duration and verify encoded resolution against representative container fixtures.
  evidence: The development adapter requires explicit duration metadata and uses presentation dimensions. Keep conservative rejection when duration is unknown. Timestamp-derived WebM duration and encoded-versus-presentation resolution validation must accompany the production FFmpeg/cloud adapter deferred under Q-05; encoded-resolution bypass impact remains unverified until a representative fixture is tested.

- source_spec: `spec-3-10-serve-a-preview-manifest-for-one-content-item.md`
  summary: Normalize generated OpenAPI paths to brace parameters and declare required path parameter schemas across all routes.
  evidence: Existing buildOpenApi uses paths[r.path] with Express colon segments and only generates query parameters; Swagger/generated clients cannot substitute the documented IDs. Story 3.10 inherits this pre-existing generator behavior.

- source_spec: `spec-3-13-edit-duplicate-archive-restore-delete-content.md`
  summary: Restore quantified upload/processing and cost-abuse constraints in the refreshed Epic 3 agent context.
  evidence: Independent review B9/B10 found the context refresh omitted upload-URL throttling, abuse metrics, per-store stored-byte metering, the exact 15-minute presigned expiry and recording the processing P95 metric; authoritative planning requirements remain unchanged. Context-file corrections are deferred by the BMAD review routing rule.

## Review-gap resolutions — 2026-11-11

Original entries above retain their historical findings. Current disposition and executed evidence are in [review-gap closeout](review-gap-closeout-2026-11-11.md).

- Daily reconcile cron registration and registration of every catalogued domain event are now covered through worker startup tests, including media-only queue selection.
- Mid-session disconnect/reconnect metadata now refreshes periodically/on focus with cleanup and failure coverage. Background refresh preserves cookie idle expiry.
- The purge-sweep integration fixture no longer falls outside its first 100-row page when earlier test runs leave due schedules; unrelated rows are retained.
- Media attachment now locks/re-reads media owner data inside the content transaction. Interleaved create/PATCH completion/failure and actual PostgreSQL lock-wait regression tests pass.
- OpenAPI colon paths are normalized to brace parameters, with required path schemas; every path placeholder is covered.
- Epic 3 context once again carries exact presigned expiry, throttling/abuse metrics, per-store metering and processing-duration measurement requirements, plus the approved pilot direction.
- Full FFmpeg output correctness is verified locally. Staging 60-second 1080p P95, real scanner/hosting decisions, deployed HTTPS/merchant format compatibility, Salla 404 behavior and bounded ingestion resource validation remain open launch evidence. Publishing disconnected-store eligibility and every return-to-live placement gate remain explicit Epic 4 dependencies.


## Home pilot review follow-ups - 2026-11-11

- source_spec: `spec-4-1-placements-and-targets.md`
  summary: Ensure 4.4 storefront selection excludes empty or unprocessed media after explicit Published edits.
  evidence: B1/B2 confirm existing lifecycle behavior permits zero slides and pending Published replacements. The Home slice gates every new live destination; storefront delivery remains absent. Apply the existing processed-assets requirement at 4.4 selection, without exposing pending preview media publicly.

- source_spec: `spec-4-1-placements-and-targets.md`
  summary: Bound background session refresh and guard late authentication failures against a replaced/stopped session.
  evidence: B4/B5/E1/E2 trace the inherited review-gap changes: a never-settling request keeps refreshing occupied; request() handles a late cookie 401 before the caller's generation/state guard. Add timeout/abort plus stop/restart/late-401 tests and mounted unresolved-request cleanup coverage (B9).

- source_spec: `spec-4-1-placements-and-targets.md`
  summary: Strengthen inherited resolution browser and worker-startup verification.
  evidence: B8/B10 propose a real-browser valid replacement after invalid media and exact startup handler identities/counts plus recurring registration counts. Existing tests cover invalid replacement feedback and at least one handler per event; no new Home implementation defect was demonstrated.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-ring-layout-pilot-slice.md`
  summary: Verify that the API (DI-built) and worker `ContentLifecycle` instances actually read the store display default from `IntegrationService.getDisplayDefaults` when a placement layout is omitted.
  evidence: Review V1/B13 (2026-11-11). Ring is both the only allowed default and the fallback, so the current API settings-row test passes even when the integration dependency is not wired. Settle it once a second layout (Bar) exists by storing a non-Ring default and asserting a new Home placement inherits it through the HTTP and worker paths.

- source_spec: none
  summary: Pilot slice of Story 4.5 — serve the compiled store manifest from the CDN at /m/v1/salla/<platform_store_id>.json with 60-second TTL and retried purge on change.
  evidence: Split from the combined 4.4–4.6 pilot intent on 2026-11-11 (user chose one story at a time); depends on 4.4 output.
- source_spec: none
  summary: Pilot slice of Story 4.6 — recompile and refresh the storefront manifest on visible product price, stock and deletion changes within the two-minute P95 budget.
  evidence: Split from the combined 4.4–4.6 pilot intent on 2026-11-11 (user chose one story at a time); depends on 4.4 compiler and 4.5 delivery.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-compile-store-manifest-pilot-slice.md`
  summary: Avoid CDN uploads/purges (or revision bumps) when a compile produces an unchanged manifest.
  evidence: Review B3 (2026-11-11). Every compile writes revision + 1, including those triggered by unrelated catalog/media events and repeated compiles of an uninstalled store. Story 4.5 uploads and purges per revision; compare a content hash before uploading.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-compile-store-manifest-pilot-slice.md`
  summary: Bound the store manifest candidate read instead of loading every published Home Story on each compile.
  evidence: Review B7 (2026-11-11). `publishedHomeStories` is unbounded; only 10 are kept after media and product filtering. Negligible at pilot scale; needs an iterative or over-fetching read before wider rollout.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-compile-store-manifest-pilot-slice.md`
  summary: Emit a manifest trigger when an active store's synced domains change.
  evidence: Review E3 (2026-11-11). Refreshing an active store's details updates `synced_domains` without any `MANIFEST_INPUTS` event, so open-link CTA drop decisions can stay stale until the next trigger. Pre-existing; save-time validation still rejects off-domain URLs.
- source_spec: `spec-4-5-cdn-manifest-delivery-pilot-slice.md`
  summary: Verify browser cache and stale-while-revalidate behavior when the production player loader is implemented.
  evidence: The local caching HTTP fixture verifies invalidation, while the future loader fetch policy and browser cache behavior remain unknown. Check browser requests and deployed CDN timing to settle the unverified medium-risk freshness question; CDN purge cannot invalidate a browser cache.

- source_spec: `spec-4-5-cdn-manifest-delivery-pilot-slice.md`
  summary: Make worker-start event-publishing privilege replacement atomic.
  evidence: grantEventPublishing already executed REVOKE and subsequent GRANT statements in separate transactions before 4.5, temporarily removing enqueue permissions during worker startup. Wrap the sequence in one transaction and verify concurrent producers in a follow-up.
