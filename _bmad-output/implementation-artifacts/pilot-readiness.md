# Controlled pilot readiness

Scope approved by Ali on 2026-11-11: "okay approve". Source: [approved proposal](../planning-artifacts/sprint-change-proposal-2026-11-11.md). Planning changes are applied; implementation and launch gates below remain open unless evidence is explicitly recorded. No new tests were run to approve this plan.

## Milestone and ownership

Free, manually onboarded pilot: one explicitly enrolled live merchant, expanding to at most three after the first accepted run. Journey: install → sign in → sync → create Story → process media → link product → preview → Home → publish now → Story ring → real cart → archive/delete withdrawal within one minute. Required options use View options. No new shopper tracking, attribution/ROI claims or billing automation.

Ali owns commercial terms, merchant permission, launch decisions and acceptance. Development owns implementation, checks and evidence; production configuration must have a named operational owner. Scope approval does not authorize deployment, enrollment or merchant communications. Original story IDs/acceptance criteria remain intact; pilot slices never imply full-story completion.

## Decisions before live use

- [ ] Select merchant and obtain explicit pilot terms/permission.
- [ ] Choose production provider/region, database, storage/CDN, HTTPS/domains and secret/session configuration.
- [ ] Name support contact, operational/alert owner and response procedure.
- [ ] Set numeric upload, storage, queue and cost caps with enforcement and alerts.
- [ ] Record applicable data/legal decisions and tested authorized export/delete route.
- [ ] Obtain explicit deployment/enrollment authorization after readiness evidence is reviewable.

## Review closeout before the Home placement slice

| Work | Current evidence | Remaining action |
| --- | --- | --- |
| 3.13 | Spec `spec-3-13-edit-duplicate-archive-restore-delete-content.md` is done with final parent verification: API 180, dashboard 363, browser 12; tracker intentionally review under Build sync | Reuse final record; recheck only affected paths or unresolved concerns |
| 2.6-2.7 | Executed catalog/reconcile/reconnect/lifecycle checks; cron/event startup coverage; live metadata refresh with idle expiry preserved | 2.6 closed; 2.7 storefront-last-data acceptance remains for 4.4-4.6 |
| 3.3-3.9 | Current API 677/dashboard 367 passing; attachment race fixed with actual interleaved/lock tests; upload feedback checked in four browser configurations | 3.3-3.7/3.9 closed within documented adapter scope; 3.8 staging 60-second 1080p P95 remains open; every return-to-live admission belongs to 4.1 |
| 3.10-3.12 | Corrected OpenAPI paths; dashboard 16/player 33 browser tests passed; Windows player build/budget passed | Local review gaps closed; deployed storefront/theme/cart gates remain separate |

Audit and exact per-story evidence: [review-gap closeout](review-gap-closeout-2026-11-11.md). The engineering prerequisites for Home placement work are verified; this does not satisfy the outstanding full-story or live-pilot gates.

Keep per-spec evidence and remaining risks explicit. Do not mass-promote sprint statuses or treat historical reports as newly executed checks.

## Ordered implementation and evidence

- [x] Home slice of 4.1: persisted tenant-scoped placement, RLS/cross-tenant verification, inline no-placement reason, QC/auto-publish admission and every return-to-live transition gated. Category/Product targets remain full-story work.

  Verified on 2026-11-11: contracts 93, DB 64 (including placement RLS/cross-tenant), API 687 and dashboard 373 tests passed; 20 dashboard browser tests passed, including English/Arabic Home save/reload/publication at desktop/mobile widths. All 19 lint/typecheck/build tasks passed. Independent review fixes and final UI checks are recorded in [the Home slice spec](spec-4-1-placements-and-targets.md). Home is persisted, listed, included in export/purge and omitted from duplicates; QC auto-publish and every resolved Published/Scheduled destination use admission under the item lock. Full 4.1 remains in progress: Category/Product selection, searchable targets and deleted-target invalidation are deferred. Inherited session-refresh reliability and additional verification follow-ups are explicit in deferred-work.md. This does not authorize live use.
- [x] Ring slice of 4.2: fixed Story Ring default using integration settings ownership; disable scheduling and unsupported storefront choices. Remaining layouts/defaults remain full-story work.

  Verified on 2026-11-11 after independent review fixes (isolated PostgreSQL, port 15433): contracts 94, DB 67, API 701 (1 pre-existing MinIO-only skip), dashboard 381 tests passed; 24 dashboard browser tests passed, including Ring/Bar/Reel/Schedule in English/Arabic at desktop/mobile widths; 19/19 lint/typecheck/build tasks passed. Integration owns `store_settings` (forced RLS, cross-tenant, export/purge); every Home placement persists `layout: ring`; other layouts answer 422 `content-invalid-layout`; Reels are refused on every live transition with `unsupported_format`, and live items can not be edited into Reels. Evidence in [the Ring slice spec](spec-4-2-ring-layout-pilot-slice.md). Full 4.2 remains in progress (Bar, Reel layouts, Category/Product, Settings UI). Independent three-layer review completed; its fixes are verified and one verification gap (stored non-Ring default) is deferred in deferred-work.md. This does not authorize live use.
- [ ] 4.4-4.6: shared preview/store compiler, processed assets, newest-first cap, transactional triggers, queue registration, monotonic revisions, CDN delivery/purge, product freshness and withdrawal within one minute. Disconnected retains last manifest; uninstall/purge/unknown returns empty.

  4.4 pilot slice (Home/Story/Ring, publish-now), implemented and independently reviewed on 2026-11-11. Verified after review fixes on isolated PostgreSQL (port 15434):
  - Unit tests: contracts 96, DB 72, API 744 (1 pre-existing MinIO-only skip), player 65, dashboard 381.
  - Browser tests: dashboard 24, player 33.
  - 19/19 lint/typecheck/build tasks passed.

  `store_manifests` is owned by publishing (forced RLS, cross-tenant test, purge deletes the row, not exported). Preview and store manifests share `compileManifest`. All 20 `MANIFEST_INPUTS` events enqueue a compile in the delivery transaction, which is single-flight and debounced at 10 s. Compiles lock the row and write `revision + 1`. A disconnected store keeps its manifest; an uninstalled store compiles empty; a purged or unknown store has no row, which reads as empty. Off-domain open-link CTAs are dropped with a warning metric, and gzip size and compile lag are metered. Evidence and risks are in [the 4.4 slice spec](spec-4-4-compile-store-manifest-pilot-slice.md). Full 4.4 stays in progress (schedules, other placements, Reels, the merchant CTA flag). 4.5 (CDN delivery and purge) and 4.6 (product freshness) remain open. Independent three-layer review completed; its fixes are verified and three findings are deferred in deferred-work.md. This does not authorize live use.
  4.5 pilot slice completed and independently reviewed on 2026-11-12: transactional object delivery with durable upload intent/checkpoints, phase retries, canonical deduplication, lifecycle/epoch protection, object-only public origin, bounded authenticated purge bridge and storage writes, delivery alerts, tested backfill/redrive/status commands and runbook. Parent verification after all review fixes: API 767, DB 75, contracts 96, player 65 and dashboard 381 tests passed (1,384 total); 19/19 lint/typecheck/build tasks passed. All 14 delivery composition cases passed, including real-queue cache freshness, post-PUT crash recovery and final purge-event cleanup. Three review layers ran; seven patch groups were fixed, with browser-cache/loader validation and the pre-existing startup privilege race tracked in deferred-work.md. Evidence: [4.5 slice spec](spec-4-5-cdn-manifest-delivery-pilot-slice.md). Production bridge/provider configuration and deployed CDN evidence remain launch gates. Full 4.5 remains in progress (manual fallback keys and schedule-boundary freshness); this does not authorize live use.
  4.6 pilot slice implemented and independently reviewed on 2026-11-12 (three layers; four patches applied, hidden-product merchant signal deferred): `catalog.product.updated`/`catalog.product.deleted` enqueue a compile only when at least one non-deleted content item links the product (read through `ContentService.getLinkCountsByProductIds` in the delivery transaction; skips logged at debug); `catalog.sync.completed` and every other input still compile unconditionally. The store compile withholds an item whose linked product is hidden in Salla (`visible` false) exactly like a deletion; unhiding restores it; previews are unchanged. New composition test `product-freshness.test.ts` drives signed Salla webhooks through the real Nest app (inline catalog consumer) and the worker sweep (fetched 404), real pg-boss eligibility, compile, delivery and the caching CDN fixture on isolated PostgreSQL (port 15436). Measured webhook-processed → shopper-read ms: price 10217, sale price 9213, stock to low 10108, stock to out 10183, required options 10193, hide 10165, unhide 10188, delete webhook 9149, recreate after webhook 10139, delete via 404 10125, recreate after 404 10102 — all under the 60 s pipeline budget (dominated by the 10 s debounce slot). These ms come from the test's own 100 ms polling loop; the worker's pg-boss polling and the `events.dispatch` job hop are not included. Non-visible changes (same-bucket stock, description, tax flag) emit no event and no compile; a burst of five unlinked visible updates emits five events, zero compile jobs and leaves the revision unchanged. Verification: API 773 passed (1 pre-existing MinIO-only skip, 41 files, `--maxWorkers=2`), 19/19 lint/typecheck/build tasks passed, `git diff --check` clean. Full 4.6 remains in progress (schedule start/end freshness and staging CI timing); Salla webhook delivery latency (the other minute of the 2-minute P95) is not measured here. This does not authorize live use.

- [ ] 5.1-5.3: enrolled-store restriction, release channel, kill switch/rollback, page eligibility, invisible failures and double-boot safety, one Home entry with layout-safe fallback.
- [ ] 5.4-5.6/5.8: production player adapter, accessible viewer, RTL/LTR/reduced motion, muted playback and rendition selection; reuse preview work.
- [ ] 5.9-5.10: real guest/signed-in simple-product carts, deleted/out-of-stock handling and required-options fallback.
- [ ] Pilot 7.7/7.11-7.15: real support, caps/throttles, audited data rights, uninstall media/CDN purge, focused security and i18n/accessibility.
- [ ] 5.12-5.13: three representative themes, target mobile/desktop browsers, measured CLS/CWV, bounded load and deployed journey.
- [ ] Production runbook evidence: backup restore, alert routing, kill switch and rollback rehearsal, runtime FFmpeg and safe media ingestion.
- [ ] Story 3.8: record the five-minute P95 target against representative 60-second 1080p inputs in staging; the local real-FFmpeg fixture verifies correctness, not this performance criterion.
- [ ] Ali accepts first merchant run, with dated evidence and known limitations, before expansion within the cap.

## Stop conditions and later work

Disable enrollment/player for cross-store exposure, broken cart/theme, open high/critical security findings, excessive resource use or inability to withdraw content. Scope size does not waive security, privacy or data rights.

Full MVP retains Category/Product placements, additional layouts/defaults, scheduling, Reels storefront delivery, billing/entitlements, analytics/attribution/refunds, broader settings/admin/onboarding, public listing/legal requirements, scale work and PRD E1-E5. Keep 4.3, 5.7 and 5.11 in backlog. Partial pilot entries above do not close their parent stories.
