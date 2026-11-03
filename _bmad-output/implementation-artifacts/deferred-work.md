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
