---
status: draft
stepsCompleted: [1, 2, 3]
inputDocuments:
  - docs/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-splice-2026-10-10/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-splice-2026-10-10/EXPERIENCE.md
  - docs/prd-addendum.md
  - docs/salla-desk-research.md
  - docs/tech-stack.md
---

# Slips - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Slips, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: Install from the Salla App Store and authenticate via Salla OAuth; tokens stored encrypted and refreshed automatically; dashboard shows "Connected to Salla" with the store name.
- FR2: Handle install/uninstall events. On uninstall: content API returns empty for the store, billing processing stops, 30-day grace (reinstall restores content and settings), then permanent deletion (NFR10).
- FR3: Sync products (name, image, category, price incl. sale price, availability, required-options flag) via webhooks plus manual sync; show last sync time. Availability: Available / Low (5 or fewer in stock) / Out of stock.
- FR4: Create Stories and Reels with title, format, linked product, CTA and multiple images/videos (upload or external link). CTA = label + action (add to cart / open product / open link) + optional preset style; "open link" accepts only URLs on the store's own domain.
- FR5: Validate uploads, transcode to renditions (1080p/720p/480p), generate posters, run quality check; optional auto-publish on pass. Global limits: video MP4/MOV/WebM, <= 200 MB, <= 90 s, min 720p shorter side; images JPG/PNG/WebP, <= 10 MB, min 1080 px shorter side. QC flags: below min resolution, no video track, corrupt, over duration. External links are fetched and processed like uploads; never hotlinked.
- FR6: Content list with status filters (All, Published, Scheduled, Drafts) and counts; edit, duplicate, archive, delete; status rules per FR22.
- FR7: Live vertical preview while editing, rendered by the real storefront player in preview mode (cart actions simulated).
- FR8: Placements (home, category, product page; optional target ID), layout per placement (FR29), scheduled start and optional end; no placement = cannot publish. Schedules in store time zone (Salla, else Asia/Riyadh with merchant setting; confirmed at gate).
- FR9: Injector loads automatically on every storefront page via Salla App Snippet with no theme edits; identifies the store from Salla store ID; manual snippet with injector key is fallback only; renders only content eligible for the page (page type, target ID, schedule, status).
- FR10: Player supports Story and Reels modes, muted autoplay, lazy loading, adaptive rendition, RTL/LTR from storefront language; respects autoplay, data-saver and reduced-motion. If Slips unreachable or key invalid, storefront fully functional with nothing visible.
- FR11: Product card (image, name, price the cart will charge, CTA). Add to cart adds to Salla cart without leaving content, with confirmation; errors (out of stock, API failure) show localized message and keep shopper in the experience; secondary action opens product page or cart; every Slips add to cart tagged for attribution (G4 mechanism).
- FR12: Capture events: impression, view, quartile progress, completion, slide advance, product click, add to cart (no share in MVP).
- FR13: Attribute Salla orders (replaces SRS FR-ANA-03): (1) only products added to cart from inside Slips content, Salla-confirmed and tagged, earn credit; views/clicks never; (2) only cart-tagged line items credited, shipping excluded, revenue excl. VAT, order-level discounts apportioned pro rata to pre-discount value; (3) window default 7 days, merchant-settable 1-14, window change applies to orders after change, window shown next to every attributed figure; (4) one credit per line item for full ordered quantity; (5) several content items -> most recent Slips add to cart before order wins; (6) mixed orders: untagged lines ignored, order attributed if >= 1 line credited; (7) order after window: no credit, add still in funnel; (8) cancellation removes all credit; partial refund subtracts refunded amount of credited lines; order un-attributed if nothing credited remains; applied on order update (webhook or FR25 reconciliation); (9) only FR26-valid add-to-cart events count.
- FR14: Analytics page: four Analytics KPIs (Views, Unique viewers, Product clicks, Attributed orders) with % change; ranges Last 7 days, Last 30 days, This month, custom; funnel with counts and step rates; per-content performance (views, completion rate, CTR, attributed revenue); metric tooltips; attribution methodology page.
- FR15: Overview dashboard: four Overview KPIs (Views, CTR, Product clicks, Attributed revenue) with % change; 7-day chart; latest content (title, last activity, views, CTR, status) with All/Published/Drafts filter and link to full list; empty-state banner "Create your first story".
- FR16: Products page: category, price, linked-content count, attributed orders, availability; filter by category, search by name. Out-of-stock: CTA disabled showing "Out of stock"; form warns when linking an out-of-stock product.
- FR17: Settings: Salla connection tab (status, store name/URL, reconnect, disconnect); injector tab (live install detection, default display options; store key copy/regenerate only for manual fallback); attribution window (1-14 days); dashboard language. Regenerate issues new key, purges storefront cache, old key works for 7-day overlap; merchant told whether reinstall needed. Explicit save with "Changes saved".
- FR18: Store preview page with Stories/Reels toggle, in-content product card and "Order now", installation instructions, real player in preview mode; "Preview store" button on every dashboard page.
- FR19: Salla app billing: react to subscription events (start, renew, upgrade, downgrade, cancel, expire); enforce plan limits on active items and placements at publish and in storefront API; show plan and usage with warnings at 80% and 100%; on downgrade/expiry deactivate (never delete) over-limit content with notice and grace period; support free trial if configured. Plans/prices/limits/grace/deactivation order TBD (Q-04).
- FR20: "Need help? Contact support" on every dashboard page; email and WhatsApp, Arabic and English, Sun-Thu business hours (Asia/Riyadh), first response within 1 business day.
- FR21: Onboarding checklist on first install: connect store, sync products, injector detected, create first content; each shows done/not done.
- FR22: Content status model: Draft, Processing, Failed, Scheduled, Published, Archived, Deactivated (no "Ready"; passing processing without auto-publish returns to Draft). Only Published within schedule shown on storefront. Published + Scheduled count toward plan limits. Tabs: All (every status), Published, Scheduled, Drafts (Draft, Processing, Failed); Archived/Deactivated under All with chip. Auto-publish with no placement stays Draft with reason.
- FR23: Products with required options: until the gate confirms option selection via Salla, CTA reads "View options" and opens the product page; counts as product click, never earns attribution.
- FR24: Freshness: publish/unpublish/archive/schedule start-end reflected on storefront within 1 minute; Salla price/stock changes reach storefront within 2 min P95 (1 min sync + 1 min cache). On add to cart Salla's price governs; card updates to Salla's price if different.
- FR25: Integration lifecycle: at least daily reconciliation back-fills missed products/orders; out-of-order webhooks never overwrite newer data; token refresh single-flight per store; lost access -> Disconnected state with reconnect, sync paused; reinstall within grace restores (FR2); deleted linked product removes content from storefront and flags "Linked product deleted".
- FR26: Event integrity: events accepted only for a valid store key from the store's own storefront domain; unique event IDs, duplicates dropped; per-store and per-viewer rate limits; bot/implausible-activity heuristics; only Salla-confirmed Slips adds to cart earn credit.
- FR27: Slips Admin (internal): look up a store and see connection status, sync state and last sync, processing jobs and failures, plan and usage, pilot status (published content, attributed orders); Slips staff only, separate internal sign-in.
- FR28: Dashboard access from Salla (or direct link), signed in through Salla account; one merchant account per store, no team members; sessions expire after inactivity; sign out; re-entry mechanism confirmed at gate.
- FR29: Layouts per placement: product-page strip (below images or custom position), home/category carousel (boxed or full width), full-screen Reels viewer (opened from strip or carousel). Stories as ring or bar; Reels as carousel/strip of covers opening the viewer. Defaults set in Settings.
- FR30: Several published items on one placement: most recently published first, cap 10 items per placement.

**Gate checks (Epic 1 go/no-go):**

- G1: Storefront injection on home/category/product pages of >= 3 themes without theme edits; reads page type, product/category ID, language; not blocked by CSP. Fallback: guided manual snippet; else no-go.
- G2: Add to cart (simple products) from injected player for guest and signed-in shoppers with success/failure response. Fallback: open product page pre-selected ("View product"); no cart path = no-go on in-content purchase.
- G3: Add to cart with required options via a supported Salla API. Fallback: keep FR23.
- G4: Cart tag set at add-to-cart readable from the resulting order and linkable to line items. Fallback: order note/custom field or thank-you beacon; else FR13 demoted to "assisted orders".
- G5: Install, uninstall and subscription events (incl. trial) arrive as documented; billing supports plan structure. Fallback: manual plan assignment by Slips Admin.
- G6: Product, stock and order webhooks signed, verifiable, redelivery/ordering as documented. Fallback: reconciliation polling; FR24 bounds relaxed.
- G7: Store time zone available from Salla. Fallback: Asia/Riyadh default with merchant setting.
- G8: Dashboard re-entry from Salla signed in; whether Salla exposes a storefront consent state. Fallback: separate login link via OAuth; consent default per Q-18.
- Findings for G1-G8 (pass/fail, evidence, fallback) recorded in `docs/spike-findings.md`.

### NonFunctional Requirements

- NFR1: Storefront performance: initial injector payload <= 50 KB gzip (core target ~20 KB, CI warns above); lazy modules each capped, media excluded; no Slips-caused layout shift and no reserved space when nothing eligible, tested on >= 3 themes in 4 scenarios (content, no content, API timeout, invalid key); async/non-blocking, heavy work deferred to interaction/viewport; enforced in CI.
- NFR2: First video frame <= 2 s after opening player (Fast 4G, mid-range Android); dashboard interactive <= 3 s on broadband; analytics queries <= 2 s P95 for 30-day range.
- NFR3: Security: TLS 1.2+, encryption at rest incl. backups; Salla tokens/secrets server-side encrypted, never logged, minimal OAuth scopes, token access logged; injector key is a public identifier (not masked), protected by server-side origin/store binding, rate limits, bot heuristics; strict tenant isolation with automated tests; webhooks verified and idempotent; OWASP Top 10 incl. XSS in merchant text/links, SSRF on external fetch, unsafe uploads (content-sniffed type, metadata/GPS stripped, SVG rejected, malware scan before publish); one account per store, RBAC deferred.
- NFR4: Privacy (PDPL):
  - NFR4.a: Analytics events use pseudonymous viewer IDs only; no name/phone/email/address; IPs used transiently for rate limit/bot checks, not stored.
  - NFR4.b: From orders store only order ID, status, timestamps, line items (product, qty, amounts), currency, cart tag; shopper PII never stored or logged; unavoidable identifiers only as salted hash/pseudonymous ID.
  - NFR4.c: Tracking honours store consent state where Salla exposes it; default without signal [NEEDS LEGAL, Q-18].
  - NFR4.d: Every data class (raw events, aggregates, attribution records, media, logs, backups) has a retention period (NFR10).
  - NFR4.e: Merchant machine-readable export and deletion on request; uninstall deletion after grace incl. media from storage and CDN; response time [NEEDS LEGAL].
  - NFR4.f: Record of processing activities (categories, purposes, retention, sub-processors, locations); processor role, DPA, breach procedure [NEEDS LEGAL].
  - NFR4.g: Privacy Policy and Data Processing terms published and linked in app listing.
  - NFR4.h: Storage location follows data residency decision (Q-05).
- NFR5: All user-facing strings externalized in Arabic and English; correct RTL/LTR and mixed direction; dates, numbers, currency per locale in store base currency; player RTL gesture/layout rules from UX spec.
- NFR6: Accessibility: dashboard WCAG 2.1 AA; player keyboard operation, visible focus, pause control for auto-advance and video, button alternatives to swipes, reduced motion; player "AA except captions" (captions Phase 2).
- NFR7: Availability: storefront services 99.9% monthly, dashboard 99.5% monthly (SLIs: content-API edge success, event submission success, dashboard request success; excl. announced maintenance); event submission tolerates outages via client retry/queue; content API CDN-cached with invalidation within 1 minute.
- NFR8: Operations: logging, metrics, tracing, alerting (API errors, queue depth, processing failures, Salla API failures, injector error rates); injector versioned with gradual rollout and rollback; daily DB backups with PITR and quarterly restore test.
- NFR9: Compatibility: Salla official + common custom themes, compatibility matrix, >= 3 themes tested pre-launch; player on iOS Safari (last 3), Android Chrome (last 3), Samsung Internet, desktop Chrome/Safari/Edge/Firefox (last 2); dashboard same desktop browsers, responsive from tablet up; injector no global namespace pollution, style isolation.
- NFR10: Retention: content/settings kept 30 days after uninstall then deleted; raw events 13 months then aggregated/deleted; daily aggregates and order/attribution records while installed + 30 days; app logs 30 days; backups 35 days; shopper PII never stored; export/deletion on request.
- NFR11: Cost/abuse: storage and video delivery metered per store; abusive upload volume/rate detected and throttled; per-plan cost caps per Q-04.
- NFR12: Failed media jobs retried automatically (count/backoff per architecture), then shown as Failed with reason and retry action.
- NFR13: Media processing of a 60 s video <= 5 min P95 (excl. queue spikes); injector does not worsen store Core Web Vitals vs. the store without Slips.
- NFR14: Scale: designed for 5,000 concurrently active stores; pre-launch load test covers 1,000 active stores and 10x seasonal peaks (Ramadan, White Friday, National Day).

### Additional Requirements

**Starter template:** NONE. The architecture specifies no starter/greenfield template. Epic 1 Story 1 must scaffold a Turborepo monorepo per the spine Source tree and Stack table: pnpm 12.11, Turborepo 2.11, Node 24 (min 24.15), TypeScript 6.0; `apps/dashboard` (Next.js 16.4 / React 19.3, Tailwind 4.3, shadcn CLI 4.21, TanStack Query 5.104 / Table 9.2, nuqs 2.10, React Hook Form 7.89, Zod 4.6, boneyard-js 1.10); `apps/api` (NestJS 12.1, `src/modules`, `src/ports`, `src/adapters`; pino 10.4; pg-boss 12.37); `packages/contracts` (Zod v1), `packages/db` (Drizzle ORM 0.45 / Kit 0.31 / drizzle-zod 0.8, PostgreSQL 18, migrations, RLS), `packages/player` (Preact 11.0, fallback 10.29; Vite 8.3 build; `stub/`), `packages/ui`, `packages/config` (tsconfig, eslint incl. boundary rules, vitest presets); `docs/runbooks/`; Vitest 5.0 / Playwright 1.64; local docker compose (Postgres, MinIO); `@salla.sa/twilight` 2.14 type-only, `@salla.sa/embedded-sdk` 0.2 pinned exactly.

- Import boundaries (lint-enforced): only allowed directions per spine graph; `packages/db` imported by `apps/api` only; player imports `contracts` type-only; domain modules never import adapters.
- AD-1: One `apps/api` image run as `role=http` or `role=worker`; all background work in worker via pg-boss on main Postgres; `WORKER_QUEUES` groups (`realtime`, `media`, `batch`), media as its own deployment; per-queue concurrency and retry policy in one file (5 attempts, 30 s-15 min backoff; media 3); HTTP handlers never do long work inline.
- AD-2: Every table has exactly one owning module (ownership map); test fails on undeclared owner; only owner writes; cross-module reads via owner service batch reads or domain events; cross-owner SQL joins only in analytics rollups; no cascading FKs across modules, soft delete + event.
- AD-3: Non-null `store_id` on tenant tables; `StoreScoped` repository base; Postgres RLS on `app.store_id` (fail closed, `SET LOCAL` via one lint-enforced helper, `FORCE ROW LEVEL SECURITY`, app role owns no tables); workers set store context per job; admin uses read-only RLS-bypass role with `admin_audit_log`; admin mutations via owner services; cross-tenant test per tenant table.
- AD-4: Domain depends on `CommercePlatform` port only; canonical entities carry `(platform, external_id)`; Salla adapter paces per store and honours `Retry-After`; only `integration.getAccessToken(storeId)` refreshes (advisory lock single-flight, persist new pair in same tx; definitive failure -> `disconnected`); player `StorefrontPlatform` wraps `salla.*` and maps to `PageContext`.
- AD-5: Salla adapter maps orders to PII-free canonical `Order`; webhook handler persists only canonical payload; raw bodies never persisted/enqueued/logged; body logging and error capture off on webhook route; fixture test asserts no PII in DB/logs; any shopper identifier as HMAC with key outside DB.
- AD-6: `publishing` compiles one per-store `StoreManifest` (eligible items, placements, display options, product snapshots, immutable asset URLs) served from CDN at `/m/v<major>/<platform>/<platform_store_id>.json` plus key paths; recompile/purge only via AD-18 job; only `publishing` calls `CdnPurger` (exceptions: media asset deletion, AD-20 purge).
- AD-7: Static, store-identical App Snippet stub reading `salla.config`; player runtime deps `preact` only (no runtime Zod/Drizzle/`@salla.sa/*`, lint-enforced); CI fails > 50 KB gzip initial, warns > 20 KB core; lazy caps viewer 25 KB, analytics batcher 5 KB; Shadow DOM, system fonts, `--slips-*` custom properties only, host `dir` from locale; viewer owns focus trap, scroll lock, focus return; single `track()` consulting `getConsent()`.
- AD-8: Viewer and floating bubble mount on `document.body` as overlays; inline placements insert only when eligible and anchor below viewport, else overlay entry; no reserved space; Playwright CLS test on 3 themes (no content, API timeout, scroll past anchor before manifest).
- AD-9: `attribution` owns `cart_adds`, `attributed_lines`, thank-you beacon; cart add counts only after Salla promise confirms, sent immediately via `POST /v1/cart-adds` (`keepalive`, never batched) with cart ID, product, options hash, content item, timestamp; recompute on every order event, matching late cart add, and daily 15-day recheck, replacing the order's rows in one tx; window from `store_settings_history` at `placed_at`; join cart ID = `checkout_id`, fallback beacon; only attribution converts tax-exclusive and apportions discounts (largest remainder); independent E3 +/-3% reconciler in `admin`.
- AD-10: Player batches to `POST /v1/events`; one batched insert into `events_raw` (monthly partitions by `received_at`); validate contract, locator/key, origin vs synced domains, per-store/per-viewer rate limits, UUIDv7 dedup window, duplicate IDs dropped; 429 + `Retry-After`, client jittered retry with bounded buffer; view dedup (30 min) and metric formulas only in analytics rollups and one `metrics` service; dashboards read rollups only; today re-rolled every 15 min; attributed metrics bucketed by `placed_at` in store TZ, dirty-day re-roll; retention drops partitions, erasure in throttled batches.
- AD-11: All wire shapes (requests, responses, manifest, event batch, domain events, job payloads) are hand-written Zod `v1` schemas in `packages/contracts`; strict API input, non-strict client parsing; additive-only within v1; job payloads carry `v` (current + previous accepted); Drizzle types stay in db/api; dashboard data only via API with per-module TanStack Query hooks and query-key factory; Next.js never connects to DB.
- AD-12: Embedded: API introspects embedded SDK `getToken()` and mints short-lived in-memory bearer, refreshed via `getToken()`; direct link: Salla OAuth + first-party httpOnly Secure SameSite=Lax cookie + CSRF; no third-party cookies; idle timeout merchant 12 h, admin 30 min; `/admin` separate sign-in/session/guard; merchant sessions cannot call admin routes; `frame-ancestors` Salla origin only (merchant), `'none'` (admin).
- AD-13: Verify `X-Salla-Signature` over raw body (timing-safe) and require security strategy = signature; `webhook_inbox` stores only canonical PII-free payload, body hash, type, store external ID, Salla event ID (unique), return 200, kept 30 days; unknown stores parked/retried 15 min then dead-lettered (never 404); worker processes per store serialized with guarded writes (`source_updated_at`); order webhooks trigger re-fetch; daily reconciliation; recorded real webhook fixture test in Epic 1.
- AD-14: `billing` derives plan changes by comparing `app.subscription.*`/`app.trial.*` events with stored plan and reconciles with subscriptions API; `plan_source` `salla`/`manual_override` (with end date, never overwritten); `content` is the single limit decision point (publish under per-store lock, deactivate on plan change) via `billing.getEntitlements`; non-`live` stores skip enforcement.
- AD-15: Direct-to-storage store-scoped pre-signed uploads (15 min, size-limited, throttled at issue); store-prefixed content-addressed immutable paths; asset states `uploaded -> scanned -> processed | failed` with `MalwareScanner` port; only processed assets publishable; external fetch only in worker through one SSRF-safe fetcher; `MediaProcessor` port produces progressive MP4 480p/720p/1080p + poster (no HLS); player picks rendition by viewport/connection; failures retried per AD-1 then reported to `content` as command; assets removed only when unreferenced.
- AD-16: Storefront locator `(platform, platform_store_id)` from `salla.config`, no separate public ID; `store_keys` (owned by publishing; `active`, `retiring`, `revoked`) only for manual fallback; regenerate -> new active, old retiring 7 days, then scheduled revoke + compile; only active/retiring accepted; App Snippet installs need no reinstall.
- AD-17: Domain events enqueued to pg-boss in the same DB transaction (transactional outbox); consumed only by worker; handlers idempotent on event ID; names `<module>.<entity>.<past-verb>` with schemas and owner catalogued in contracts; no in-process cross-module emitters (lint).
- AD-18: Manifest compile single-flight per store, debounced ~10 s; monotonic `store_manifests.revision`, never overwrite newer; triggers in one `ManifestInputs` list (content status/edits, product changes/deletion, settings, plan changes, key retirement, lifecycle, schema bump backfill); catalog emits only on manifest-visible field changes; CTA links checked at save and compile; CDN TTL 60 s + stale-while-revalidate; retried purges; compile-lag and manifest-size metrics.
- AD-19: Only `content` writes status; statuses = FR22 + Ended; transition table in contracts; schedule boundaries as pg-boss delayed jobs with dedup key per item/boundary, re-queued on edit; each transition emits event; publishing filters on status only; media/billing request changes via content commands; autosave only for Drafts, Published edits saved explicitly (one edit event); soft delete; FR30 order by `first_published_at`.
- AD-20: `integration` owns `stores.lifecycle_state` (`active -> disconnected -> uninstalled (30-day grace) -> purged`) and `install_epoch`; transitions emit events; every module implements `StoreDataLifecycle` (export, purge, restore incl. media and CDN manifests); reinstall key `(platform, platform_store_id)` restores same row; purge is one resumable orchestrated job with per-store lock, state/epoch rechecks, audit record; stale-epoch work dropped.
- AD-21: Stub loads short-TTL channel pointer naming immutable versioned loader; `stable`/`canary` (cohort %) channels; rollback by repoint; global kill switch; manifest major versioning (loader supports current + previous); `window.__slips` double-boot guard; stub buffers early `cart::*` events; custom elements `slips-player`/`slips-viewer` defined once; loads only from Slips CDN and API origins (documented for CSP); silent fail on block/missing/timeout/unknown major; stub source in `packages/player/stub`, CI-checked, released to Partners Portal via documented step.
- AD-22: From Story 1.7 telemetry module (pino, error tracking, metrics/SLIs per NFR7, alerts for error rate, webhook failures, queue depth/age, Salla API failures, compile lag, player errors; vendor deferred); job payloads carry `trace_id`, `store_id`; alerts map to owners and `docs/runbooks/`; managed Postgres with PITR, daily encrypted backups, quarterly restore test, HA in prod; expand/contract migrations compatible with previous release, rollback = redeploy previous image; job creates `events_raw` partitions 3 months ahead with alert; feature flags in config table; degraded mode on Salla outage (sync paused, manifests keep serving).
- AD-23: Dashboard previews embed the real player build in an iframe with `MockStorefrontPlatform`; preview manifest from the same compiler via a preview endpoint (never CDN); events and cart confirms disabled in preview.
- Convention - IDs: UUIDv7 primary keys; external IDs as `(platform, external_id)`; storefront locator `(platform, platform_store_id)`.
- Convention - Time: `timestamptz` UTC; schedules, day boundaries and date presets in store time zone (default Asia/Riyadh); schedule input wall-clock + zone converted only by API; TZ change re-anchors future schedules.
- Convention - Money: integer minor units with ISO 4217 exponent table in contracts + currency code; prices carry `tax_inclusive`; attributed revenue stored excl. VAT; non-base currency flagged, never summed.
- Convention - Errors: RFC 9457 `application/problem+json` with stable `type` slug; user text localized in dashboard, never in API.
- Convention - Naming: tables snake_case plural; modules/files kebab-case; events `<module>.<entity>.<past-verb>`; queues `<module>.<job>`; Salla inbox types prefixed `salla.` and stay in integration; player event types closed enum; API paths `/v1/<resource>`.
- Convention - Logging: pino JSON with `request_id`, `trace_id`, `store_id`, `job_id`; no PII, tokens or secrets.
- Convention - Config/secrets: env validated with Zod at boot; tokens and webhook secrets envelope-encrypted; no secrets in repo.
- Convention - Retention: raw events 13 months; aggregates/orders/attribution while installed + 30 days; logs 30 days; backups 35 days; `webhook_inbox` 30 days; pg-boss archive 7 days; `admin_audit_log` 2 years.
- Convention - i18n: `ar`/`en` catalogs in dashboard and player; logical CSS properties only; merchant text `dir="auto"`; `Intl` number/currency in store locale.
- Convention - Dashboard state: TanStack Query per contract module; nuqs URL state; RHF + contract Zod forms; TanStack Table v9 APIs; boneyard skeletons.
- Convention - Availability bucket stored by `catalog`; clients never recompute.
- Convention - Testing: Vitest units; API integration tests against real Postgres; Playwright for dashboard flows and player CLS.
- Deployment/environments: local docker compose (Postgres, MinIO) -> staging (test stores, synthetic data only until Q-05) -> production (region per Q-05, HA Postgres + PITR); CI runs lint, typecheck, test, player size + CLS; images built once and promoted; migrations run as a separate release step before new http/worker; player releases via AD-21 channels independent of API.
- Deferred constraint - Q-05 hosting: provider, DB region, object storage, CDN, media processing, malware scanning and IaC tool deferred until data residency (Q-05); must offer managed Postgres 18 HA/PITR/encrypted backups, S3-compatible versioned storage, CDN with purge API and log export, managed video service or ffmpeg workers, all in region; infra in `infra/`. Stories must code against ports/adapters and not assume a vendor.
- Deferred constraint - observability vendor and admin sign-in provider isolated behind telemetry module / admin auth; revisit before staging hardening.
- Deferred constraint - consent default (Q-18/G8) behind `track()` seam; attribution join (G4) with named beacon fallback; exact CLS-safe insertion per layout pending G1/CLS results.
- Deferred (do not build in MVP unless trigger fires): TS 7, Node 26, Drizzle 1.0, Postgres 19, columnar analytics, HLS, Redis/separate queues, shared rate-limit store, manifest sharding (> 15 KB gzip), unique viewers across arbitrary ranges.
- Open question A-1: editing Published items (live explicit save interim vs draft revisions) must close before Epic 3 stories are sharded.

### UX Design Requirements

- UX-DR1: Implement DESIGN.md color tokens as CSS variables in `packages/ui` `globals.css` (Tailwind 4 theme) for light and dark (all `-dark` variants), incl. page, card, primary/accent, muted, border, input-border, info-text, delta-up/down, tints, status text variants, chart-1..5, and player tokens; dark theme switches the full set.
- UX-DR2: Contrast rules enforced: ink text on coral always (white on coral forbidden), coral never as body text (links use info-text), success/warning/amber never as text on white (use `-text` variants), control boundaries use `input-border` (3:1) while `border` is decorative only; no purple; gradients only in logo and story ring.
- UX-DR3: Two-tone focus ring token: 2px ink inner + 2px coral halo (dark: white inner + ring-dark), full opacity, visible on coral fills; player entry points use white inner + ink outer.
- UX-DR4: Typography tokens: Plus Jakarta Sans (Latin) and IBM Plex Sans Arabic (Arabic) stacks ordered by `:lang`, scale display/h1/h2/h3/body/body-lg/small/kpi; no negative letter-spacing on Arabic, Arabic body line-height >= 1.55, Arabic display 700; player uses system font stack with no web fonts.
- UX-DR5: Spacing (4px base, 18px gutter, 28/16px page padding), radius (sm 8, md 12, base 16, lg 22, pill) and single warm card shadow tokens; popovers/dialogs add 1px border ring.
- UX-DR6: Buttons: pill 36px (32 sm, 44 lg/touch), primary coral/ink, secondary outline input-border, one amber accent "make something" action per screen; pending spinner + `aria-busy` with double-submit prevention; unavailable actions use `aria-disabled` with reason and keep focus.
- UX-DR7: App shell: start-side nav (Overview, Videos & Stories, Products, Analytics; Settings pinned bottom) with coral-pill active item; in-flow top bar with store identity + clickable connection chip (to Settings > Connection), "Preview store" and "Need help? Contact support" on every page; nav collapses to icons on md and Sheet on sm; skip-to-content link.
- UX-DR8: KPI tile: 13px muted label with §1.5 definition tooltip, tabular kpi value, 12px delta with arrow icon + sign (delta-up/down), "—" when previous is 0, links to Analytics breakdown; 4-tile row (2x2 < 1024px, 1 col < 640px).
- UX-DR9: Celebration KPI tile: Attributed revenue tile solid coral with ink value/label/delta, exactly one per screen, first in reading order.
- UX-DR10: Status chips x8 (draft, processing with pulsing dot static under reduced motion, failed + 6% row tint, scheduled + date, published, ended outline no dot, archived outline + archive icon, deactivated amber): pill 11.5px/600 (12px min in Arabic), always a text label, never colour alone; each mapped to tab and primary action per EXPERIENCE status table.
- UX-DR11: Content table: shadcn Table in Card, 56px rows with 9:16 thumb (compact 40px min), status chip column, row hover muted, row click / keyboard `Enter` opens editor, row menu Edit/Duplicate/Archive/Delete (confirm dialog), sortable headers, debounced search, tabs/filters in URL via nuqs; becomes card list on sm.
- UX-DR12: Content editor: two columns (form start side, preview end side), stacked with preview toggle on sm, single-column with sticky preview button on md; Drafts autosave (~1 s debounce, "Saved" indicator); Published items explicit "Save changes"; publish blocked without placement with inline reason; unsaved-changes leave confirm; form errors on blur/submit with summary linking to fields; alt text required on image slides.
- UX-DR13: Media uploader: dashed input-border drop zone, drag/drop or pick, multi-file, client-side pre-check against FR5 limits, per-file progress, Processing with poster, Failed with reason + Retry.
- UX-DR14: Slide reorder accessible by keyboard/AT: each slide has "Move earlier"/"Move later" buttons (logical order, RTL-safe), new position announced ("Slide 2 of 3"), focus stays on moved slide; drag also supported.
- UX-DR15: Product picker: searchable combobox of synced products with thumb + availability chip; required-options products show "View options" note on CTA preview; out-of-stock link warning.
- UX-DR16: Live preview: 9:16 phone frame (radius lg, ink bezel) iframe of real player with mock storefront; simulated cart success; always-visible "Preview: no real cart or analytics" note; skeleton phone frame while loading and "Preview didn't load. Try again." with Retry.
- UX-DR17: Onboarding checklist card: 4 steps with 20px check circles (success done / input-border pending), auto-tick from live state (injector detection poll every 10 s while visible), collapses to "Setup complete" and dismissible after.
- UX-DR18: Plan usage meter: 6px pill bar, ink fill < 80%, warning at 80%, destructive at 100%, always with "8 of 10" text; 100% blocks publish with reason + upgrade; downgrade notice lists Deactivated items and grace period.
- UX-DR19: Support sheet: shadcn Sheet from end side with email and WhatsApp channel rows (secondary buttons) opening externally in new tab, hours (Sun-Thu, Asia/Riyadh) and response time.
- UX-DR20: Toast: ink surface, white text, coral-outlined action, 24px close; pre-mounted `aria-live=polite` region at app load; bottom-start position; action toasts (Undo, Retry) never auto-dismiss; plain toasts dismiss after 5 s pausing on hover/focus; `F8` focuses toast region; Archive Undo announced "Archived. Undo available".
- UX-DR21: Banner: full-width in-flow strip (tint + icon + text + one action); offline (warning, "You're offline. Changes will save when you're back.", drafts queue locally, explicit saves disabled) and disconnected (danger, persistent on every page with "Reconnect", last sync shown).
- UX-DR22: Skeleton: boneyard skeletons matching final layout (KPI row, chart, 6 table rows), muted blocks radius sm, shown after 150 ms, shimmer off under reduced motion; no page spinners.
- UX-DR23: Inline per-block error with Retry (other blocks keep working) and empty states per EXPERIENCE (Overview banner + checklist, content tab sentence + action, filtered-empty "Show all", analytics zeros with "Numbers appear after your first view", products syncing / link to Salla).
- UX-DR24: Attribution caption on every attributed figure: small muted text showing live window ("7-day window, add-to-cart only") + info-text "How we count" link to methodology page; never hidden.
- UX-DR25: Story ring: 68px avatar, 2.5px conic coral->amber ring with 2.5px gap; seen = flat seen colour at 1.5px (shape cue), per-viewer local; each item a `button` named "{title}, story, new"/"..., seen"; 12px one-line label; horizontal scroll follows text direction; two-tone focus ring.
- UX-DR26: Floating bubble: 56px story-ring gradient circle on `body`, bottom-start, 24px dismiss button with 44px hit area at top-end, dismissible per session, never covers theme cart/checkout button; used when inline insertion disallowed.
- UX-DR27: Full-screen viewer: `role=dialog`, `aria-modal`, named "{merchant} stories", host siblings `inert`, initial focus on Pause, focus trap, `Esc` closes, focus returns to entry; phone full screen with safe-area insets, desktop centered 9:16 with backdrop and visible arrows.
- UX-DR28: Viewer controls: mute/pause/close/next/previous 44px round buttons (white icon on 40% scrim disc), visible mute and pause in every mode, tap zones as named buttons ("Next slide", "Previous slide"); taps on card/CTA never navigate; opening card pauses auto-advance.
- UX-DR29: Player progress bar: segmented 2px white bars on track with 4px gap over a 64px top scrim (holds 3:1 on bright frames); hidden "Slide 2 of 5" announced on manual navigation only.
- UX-DR30: Player product card: white surface, 22px radius, 12px padding, 56px thumb, 2-line name, tabular price that updates to Salla's price if different; secondary actions "Open product"/"Open cart".
- UX-DR31: Player CTA states: 48px full-width ink pill with amber text; pending = spinner + `aria-disabled="true"` + `aria-busy="true"` (never native `disabled`), focus stays, playback paused; success written to a live region mounted empty at viewer open (`polite` "Added to cart. Cart: 3 items"), playback resumes; failure `assertive` inline "Couldn't add it right now. Try again." and CTA re-enabled; out of stock stays focusable, `aria-disabled`, named "Out of stock".
- UX-DR32: "View options" fallback CTA for required-options products opens the product page (localized "اختر المقاس واللون" / "View options").
- UX-DR33: Player gestures and keyboard per EXPERIENCE table: tap thirds mirrored by direction, arrow keys follow viewer `dir` (Space does not advance), swipe up/down for Reels (`↓`/`↑`), group swipe toward inline-start (`PageDown`/`PageUp`), long-press / `Space` / `K` pause, `M` mute, swipe down / `Esc` close, `Enter` on CTA; single-key shortcuts only when focus inside viewer; every swipe has a button alternative.
- UX-DR34: Reduced motion: dashboard no count-up numbers or slide animations; player Stories do not auto-advance (tap to advance only), no transitions; ended video slide stops on last frame with focus-reachable Next; processing dot and skeleton shimmer static.
- UX-DR35: Player rendering: neutral Slips styling (light-only, black 60-80% scrim, white surfaces, independent of prefers-color-scheme) inside Shadow DOM, styled only via `--slips-*` properties; nothing renders or reserves space without eligible content; poster first then video, no storefront skeleton; offline keeps loaded media playing.
- UX-DR36: RTL/bidi: Arabic-first RTL default, logical properties only (no left/right/ml/mr), `lang`+`dir` on root; directional icons mirrored, media/playback icons never; numbers, SKUs, URLs, store key, product names and currency wrapped in `<bdi>`/`dir="auto"`/`dir="ltr"` isolates with sign kept inside; merchant text `dir="auto"`.
- UX-DR37: Western digits 0-9 with `tabular-nums` in both locales for KPIs, prices, tables and dates; Arabic month names on Gregorian dates; currency via `Intl.NumberFormat` ("340 ر.س" AR symbol after, "SAR 340" EN), two decimals only when non-zero; schedules shown in store time zone with label.
- UX-DR38: Charts: series chart-1..5 order, never meaning by colour alone (legend + labels), time axis runs right to left in RTL (oldest right, newest left).
- UX-DR39: Arabic-first i18n: all dashboard and player copy in `ar`/`en` catalogs, Arabic drafted first in friendly-coach voice (no emoji, no blame, one next step), using the EXPERIENCE microcopy table (publish success, first attributed sale, settings saved, empty states, errors, disconnected, failed upload, plan 80%/100%, shopper add success/failure, view options).
- UX-DR40: Accessibility floor: dashboard WCAG 2.1 AA (text 4.5:1, UI 3:1 light and dark), Radix focus-trapped dialogs/sheets stacked one level, confirm dialogs naming the item, status changes/saves/errors via live regions, 24px minimum targets dashboard, 44px player.
- UX-DR41: Iframe/responsive constraints: no third-party cookies, in-memory token refreshed via `getToken()`, no `window.top` navigation, external links in new tab, page scroll only (no nested scroll), sticky relative to iframe, modals sized to iframe viewport, no fixed full-viewport chrome; breakpoints sm/md/lg per EXPERIENCE; direct-link "Open in Salla" link; `/admin` desktop-only, never framed.
- UX-DR42: Dashboard grid: 12-col max 1360px, Overview main row 8/4 (trend chart / funnel) and list row 8/4; comfortable density default.
- UX-DR43: Brand assets: ship logo mark, EN/AR wordmarks (light/dark), on-coral mark and app icon (coral tile, ink S, amber ring) from `ux-designs/.../brand/`; mark at inline-start of wordmark; clear space = 2x S stroke; derive favicon from the mark (legible at 16px); never flat-recolour the ring except mono.

### FR Coverage Map

FR1: Epic 1 - Install and Salla OAuth
FR2: Epic 1 - Install/uninstall events and lifecycle
FR3: Epic 2 - Product sync
FR4: Epic 3 - Create Stories and Reels
FR5: Epic 3 - Upload validation and media processing
FR6: Epic 3 - Content list and management
FR7: Epic 3 - Live preview with the real player
FR8: Epic 4 - Placements and scheduling
FR9: Epic 5 - Injector via App Snippet
FR10: Epic 5 - Player modes and playback
FR11: Epic 5 - Product card and add to cart
FR12: Epic 6 - Event capture
FR13: Epic 6 - Attribution rules
FR14: Epic 6 - Analytics page
FR15: Epic 6 - Overview dashboard
FR16: Epic 2 - Products page
FR17: Epic 7 - Settings
FR18: Epic 7 - Store preview page
FR19: Epic 7 - Salla app billing and plan limits
FR20: Epic 7 - Support entry point
FR21: Epic 7 - Onboarding checklist
FR22: Epic 3 - Content status model
FR23: Epic 5 - Products with required options (View options)
FR24: Epic 4 - Freshness bounds
FR25: Epic 2 - Integration lifecycle and reconciliation
FR26: Epic 6 - Event integrity
FR27: Epic 7 - Slips Admin view
FR28: Epic 1 - Dashboard access and sessions
FR29: Epic 4 - Layouts per placement
FR30: Epic 4 - Ordering and cap per placement

## Epic List

### Epic 1: Install, Sign-in & Salla Go/No-Go
A merchant can install Slips from the Salla App Store, open the Slips dashboard from Salla already signed in, and see the branded app shell in Arabic or English. The team has a working monorepo, CI with the player budget and CLS checks, observability, the design-system foundation (tokens, focus ring, app shell), and a written go/no-go decision on Salla capabilities G1-G8.
**FRs covered:** FR1, FR2, FR28
**Also carries:** NFR3, NFR7, NFR8 (budget gate); AD-1, AD-3, AD-4, AD-11, AD-12, AD-16, AD-17, AD-20, AD-21, AD-22; UX-DR tokens/app shell/brand assets; gate G1-G8

### Epic 2: Product Catalog Sync
The merchant's Salla products, prices and stock appear in Slips and stay in sync (webhooks, manual sync, daily reconciliation, disconnection handling); the Products page lists them with linked content and availability.
**FRs covered:** FR3, FR16, FR25
**Also carries:** AD-2, AD-13; UX-DR content table, status chips

### Epic 3: Content Creation & Media
The merchant creates, uploads, previews (real player in preview mode), and manages Stories and Reels through their full status lifecycle.
**FRs covered:** FR4, FR5, FR6, FR7, FR22
**Also carries:** NFR11, NFR12, NFR13; AD-15, AD-19, AD-23; UX-DR editor, uploader (keyboard reorder), product picker, live preview, toasts

### Epic 4: Visibility, Scheduling & Publishing
Published content appears on the right storefront pages, in the right layout and order, at the right time, and stays fresh within the FR24 bounds.
**FRs covered:** FR8, FR24, FR29, FR30
**Also carries:** AD-6, AD-18, AD-19 (schedule boundaries)

### Epic 5: Storefront Player & In-Content Purchase
Shoppers see the story ring (or floating bubble), watch Stories and Reels, and add products to their Salla cart without leaving the content, on every supported browser and theme, in Arabic and English.
**FRs covered:** FR9, FR10, FR11, FR23
**Also carries:** NFR1, NFR6 (player), NFR9; AD-7, AD-8, AD-21; UX-DR story ring, viewer, progress bar, player product card + CTA states, View options, reduced motion, player a11y

### Epic 6: Analytics, Attribution & Dashboard
The merchant sees trustworthy views, funnel, attributed orders and attributed revenue on the Overview and Analytics pages, computed with the FR13 rules.
**FRs covered:** FR12, FR13, FR14, FR15, FR26
**Also carries:** NFR2, NFR4 (shopper PII), NFR10, NFR14; AD-5, AD-9, AD-10; UX-DR KPI tiles (celebration tile), charts (RTL axis), attribution caption

### Epic 7: Settings, Billing, Support, Admin & Launch Readiness
The merchant manages settings, plan and billing, previews the storefront, gets help, and finishes onboarding; Slips staff can look up a store; data rights, security and exit criteria are verified for launch.
**FRs covered:** FR17, FR18, FR19, FR20, FR21, FR27
**Also carries:** NFR4 (export/deletion), NFR5, NFR6 (dashboard audit); AD-14, AD-20, AD-22; UX-DR onboarding checklist, plan usage meter, support sheet, banners; launch tasks L-1 to L-7 (non-dev)

## Epic 1: Install, Sign-in & Salla Go/No-Go

A merchant can install Slips from the Salla App Store, open the Slips dashboard from Salla already signed in, and see the branded app shell in Arabic or English. The team has a working monorepo, CI with the player budget and CLS checks, observability, the design-system foundation (tokens, focus ring, app shell), and a written go/no-go decision on Salla capabilities G1-G8.

### Story 1.1: Scaffold the Turborepo monorepo and CI pipeline

As a Slips developer,
I want a monorepo laid out exactly per the architecture spine's source tree and Stack table, with CI on every pull request,
So that every later story lands in a known place and every change is checked automatically.

**Requirements:** AD-1, AD-11, NFR8

**Acceptance Criteria:**

**Given** an empty repository and no starter template
**When** the scaffold is created
**Then** it contains `apps/dashboard` (Next.js 16.4 App Router with `(merchant)` and `/admin` route groups), `apps/api` (NestJS 12.1 with `src/modules`, `src/ports`, `src/adapters`), `packages/contracts`, `packages/db`, `packages/player` (with `stub/`), `packages/ui`, `packages/config` and `docs/runbooks/`
**And** tool versions match the spine Stack table (pnpm 12.11, Turborepo 2.11, Node 24 min 24.15, TypeScript 6.0, Vitest 5.0, Playwright 1.64; `@salla.sa/embedded-sdk` 0.2 and `@salla.sa/twilight` 2.14 pinned exactly, twilight type-only)

**Given** the import-boundary rules in `packages/config` eslint
**When** a file imports across a disallowed direction (e.g. `packages/db` from anything but `apps/api`, the player importing `contracts` at runtime, a domain module importing an adapter)
**Then** lint fails with a message naming the rule

**Given** `apps/api` built as one image
**When** it starts with `role=http` or `role=worker` (with `WORKER_QUEUES` groups `realtime`, `media`, `batch`)
**Then** the http role serves a `GET /v1/health` endpoint and the worker role connects to pg-boss on the main Postgres, with per-queue concurrency and retry policy (5 attempts, 30 s-15 min backoff; media 3) defined in one file
**And** env is validated with Zod at boot and the process exits with a clear error on a missing or invalid variable

**Given** `packages/contracts`
**When** a developer adds a wire shape
**Then** it is a hand-written Zod `v1` schema exported from contracts, and a sample `HealthResponse` schema is used by both API and dashboard

**Given** a developer runs `docker compose up`
**When** the stack starts
**Then** local Postgres 18 and MinIO are available and `pnpm dev` runs dashboard, API http and worker against them

**Given** any pull request
**When** CI runs
**Then** lint, typecheck and tests run via Turborepo for all packages and the PR is blocked on failure
**And** a "hello" dashboard and API build is deployable to a staging environment documented as holding only test-store or synthetic data until Q-05 is decided, with migrations run as a separate release step

### Story 1.2: Gate the player stub and bundle budget plus CLS in CI

As a Slips developer,
I want the player's size and layout-shift behaviour checked in CI from day one,
So that the storefront player can never silently exceed its budget or move the merchant's page.

**Requirements:** NFR1, NFR8, AD-7, AD-8, AD-21

**Acceptance Criteria:**

**Given** `packages/player` with a static store-identical stub in `stub/` and a placeholder loader built with Vite 8.3 and Preact 11.0
**When** CI builds the player
**Then** it fails if the initial payload exceeds 50 KB gzip and warns if the core loader exceeds 20 KB gzip
**And** separate size checks exist for the lazy viewer (cap 25 KB gzip) and analytics batcher (cap 5 KB gzip), each failing above its cap

**Given** the player runtime dependency list
**When** lint runs
**Then** any runtime import other than `preact` (e.g. Zod, Drizzle, `@salla.sa/*`) fails the build

**Given** a Playwright reference page with three theme fixtures
**When** the CLS suite runs the four NFR1 scenarios (content present, no content, API timeout, invalid key) plus "scroll past anchor before manifest"
**Then** the test fails if any `layout-shift` entry is attributable to Slips elements
**And** in the no-content, timeout and invalid-key scenarios no Slips element occupies layout space

**Given** the stub source
**When** CI runs
**Then** the stub is linted and tested to set a single `window.__slips` guard (second boot exits), load only from configured Slips CDN/API origins, and fail silently when the loader is blocked or times out
**And** a release step for publishing the stub to the Salla Partners Portal is documented in `docs/runbooks/`

### Story 1.3: Establish the observability baseline

As a Slips developer,
I want structured logs, error tracking, metrics and alerts behind one telemetry module,
So that the team can see and fix problems during the gate spike and pilot.

**Requirements:** AD-22, NFR7, NFR8, NFR3

**Acceptance Criteria:**

**Given** the API http and worker roles
**When** any request or job runs
**Then** pino JSON logs carry `request_id`, `trace_id`, `store_id` (when known) and `job_id`, and job payloads carry `trace_id` and `store_id` so one trace spans request and job

**Given** a request containing a token, secret, `Authorization` header or shopper PII field
**When** it is logged or captured as an error
**Then** those values are redacted, verified by a unit test

**Given** a `Telemetry` port in `src/ports` with a vendor-neutral adapter
**When** the system runs
**Then** metrics exist for API error rate, Salla API failures, webhook processing failures, queue depth and age per queue, and SLI counters for dashboard request success (NFR7)
**And** a metric or alert can be added later for compile lag and player errors without changing callers

**Given** alert rules
**When** the 5-minute API error rate exceeds the configured threshold or a webhook job dead-letters
**Then** an alert fires naming an owner and linking a runbook in `docs/runbooks/`

**Given** a `feature_flags` config mechanism
**When** a flag is read
**Then** it returns the configured value with a safe default when unset

### Story 1.4: Build the design-system foundation tokens

As a merchant,
I want the dashboard to use Slips' coral identity with readable contrast and visible focus,
So that it feels like one trustworthy product and is usable by keyboard.

**Requirements:** UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR40, NFR6

**Acceptance Criteria:**

**Given** `packages/ui` `globals.css` with the Tailwind 4 theme
**When** the dashboard loads
**Then** every DESIGN.md color token (page, card, primary/accent, muted, border, input-border, info-text, delta-up/down, tints, status `-text` variants, chart-1..5, player tokens) exists as a CSS variable for light and dark, and the dark theme switches the full set
**And** no purple value exists in the token set and gradients appear only in the logo and story-ring tokens

**Given** a focusable control on any surface including a coral fill
**When** it receives keyboard focus
**Then** the two-tone focus ring renders (2px ink inner + 2px coral halo; dark: white inner + ring-dark) at full opacity

**Given** a form control
**When** it renders
**Then** its boundary uses `input-border` (3:1) while `border` stays decorative only

**Given** a primary coral button
**When** it renders
**Then** its text uses ink, never white, and coral is never used for body text (links use `info-text`)
**And** an automated contrast check over the token pairs passes 4.5:1 text and 3:1 UI in light and dark

**Given** Arabic and Latin text
**When** fonts load
**Then** IBM Plex Sans Arabic and Plus Jakarta Sans are self-hosted via `next/font` and ordered by `:lang`, with the type scale (display, h1-h3, body, body-lg, small, kpi), no negative letter-spacing on Arabic, Arabic body line-height at least 1.55 and Arabic display weight 700
**And** spacing (4px base, 18px gutter, 28/16px page padding), radius (sm 8, md 12, base 16, lg 22, pill) and the single warm card shadow exist as tokens, with popovers/dialogs adding a 1px border ring

### Story 1.5: Set up Arabic-first i18n, RTL/LTR and the branded app shell

As a merchant,
I want the dashboard to open in Arabic (or English) with correct direction inside a branded shell,
So that I can find my way around in my own language from the first visit.

**Requirements:** UX-DR7, UX-DR36, UX-DR37, UX-DR39, UX-DR41, UX-DR42, UX-DR43, NFR5

**Acceptance Criteria:**

**Given** `ar` and `en` message catalogs in the dashboard
**When** the app renders with no language preference
**Then** it defaults to Arabic with `lang="ar"` and `dir="rtl"` on the root, and switching to English sets `lang="en"` and `dir="ltr"`
**And** a CI check fails on any hard-coded user-facing string or any missing key in either catalog

**Given** dashboard styles
**When** lint runs
**Then** physical direction utilities and properties (left/right, `ml`/`mr`, `pl`/`pr`) fail the build; only logical properties are allowed
**And** directional icons mirror in RTL while media/playback icons never mirror

**Given** a number, price or date
**When** shown in either locale
**Then** Western digits 0-9 with `tabular-nums` are used, currency formats via `Intl.NumberFormat` ("340 ر.س" in Arabic, "SAR 340" in English, decimals only when non-zero), and LTR tokens (URLs, IDs, SKUs) are isolated with `<bdi>`/`dir="ltr"`

**Given** a signed-in merchant
**When** any page loads
**Then** the shell shows the start-side nav (Overview, Videos & Stories, Products, Analytics; Settings pinned bottom) with a coral-pill active item, an in-flow top bar with the store identity, a connection chip linking to Settings > Connection, "Preview store" and "Need help? Contact support", and a skip-to-content link as the first focusable element
**And** the nav collapses to icons at md and to a Sheet at sm, inside a 12-column grid with max width 1360px and comfortable density

**Given** the shell rendered inside the Salla iframe
**When** the merchant scrolls or opens a modal
**Then** only the page scrolls (no nested scroll), sticky elements are relative to the iframe, modals fit the iframe viewport, there is no `window.top` navigation and external links open in a new tab

**Given** brand assets from `ux-designs/ux-splice-2026-10-10/brand/`
**When** the dashboard loads
**Then** the logo mark sits at the inline-start of the EN or AR wordmark (light or dark per theme) with clear space of 2x the S stroke, the favicon is derived from the mark and legible at 16px, and the app icon (coral tile, ink S, amber ring) is exported for the Salla listing
**And** shell copy is drafted in Arabic first in the friendly-coach voice (no emoji, one next step)

### Story 1.6: Enforce tenant isolation with RLS and the StoreScoped repository

As a Slips developer,
I want every tenant query fenced by store context in both code and Postgres,
So that no query can ever return another store's data.

**Requirements:** AD-3, AD-2, NFR3

**Acceptance Criteria:**

**Given** `packages/db` with Drizzle ORM 0.45 / Kit 0.31
**When** migrations run
**Then** an app DB role exists that owns no tables, and a migration convention requires every tenant table to have non-null `store_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a policy on `current_setting('app.store_id')` without `missing_ok`

**Given** one helper that opens a transaction and runs `SET LOCAL app.store_id`
**When** code sets the store context any other way
**Then** lint fails

**Given** a `StoreScoped` repository base
**When** it is called without a store context
**Then** it throws, and a raw query with no context returns an error (fail closed), not rows

**Given** a worker job carrying `store_id`
**When** the job runs
**Then** the job runner sets the store context for that job only

**Given** a table ownership registry in `packages/db`
**When** a table is added without a declared owner from the spine ownership map
**Then** a test fails

**Given** a reusable cross-tenant test harness
**When** it runs against a tenant table with rows for store A and store B
**Then** store A's context cannot read, update or delete store B's rows, and every later tenant table must register with this harness

### Story 1.7: Provide the transactional domain event transport

As a Slips developer,
I want domain events enqueued in the same transaction as the state change and consumed only by the worker,
So that cross-module reactions never fire before commit, after rollback, or get lost on a crash.

**Requirements:** AD-17, AD-1, AD-11

**Acceptance Criteria:**

**Given** a module writes a state change and publishes an event through the outbox helper
**When** the transaction commits
**Then** exactly one pg-boss job exists for the event; **when** it rolls back, none exists

**Given** an event catalog in `packages/contracts`
**When** an event is published
**Then** its name matches `<module>.<entity>.<past-verb>`, its payload validates against its v1 Zod schema with a `v` field, and its owning module is declared; an unknown event name fails at compile time

**Given** a handler registered in the worker role
**When** the same event ID is delivered twice
**Then** the handler's effect happens once (idempotent on event ID)
**And** the http role never consumes events

**Given** a module emitting an event through an in-process emitter to another module
**When** lint runs
**Then** it fails

**Given** the event carries `trace_id` and `store_id`
**When** the handler runs
**Then** logs share the originating trace and the store context is set (Story 1.6)

### Story 1.8: Install Slips through Salla OAuth and store tokens securely

As a merchant,
I want to install Slips from the Salla App Store and be connected,
So that I can start using it without any setup outside Salla.

**Requirements:** FR1, AD-4, AD-16, AD-20, NFR3

**Acceptance Criteria:**

**Given** a `CommercePlatform` port (auth, products, orders, subscriptions, webhook verification) and a Salla adapter in `src/adapters/salla`
**When** domain code needs Salla
**Then** it depends only on the port, and lint fails on any Salla SDK or type import outside the adapter

**Given** a merchant installs on a Salla test store
**When** the OAuth flow completes with minimal scopes
**Then** a `stores` row is created (`platform='salla'`, `platform_store_id`, store name, `lifecycle_state='active'`, `install_epoch=1`, synced domains), a `merchant_accounts` row is created for the one store owner, and `platform_tokens` holds the access and refresh tokens envelope-encrypted
**And** the store is located by `(platform, platform_store_id)` with no separate public ID

**Given** tokens and secrets
**When** any log line, error report or API response is produced
**Then** no token or secret value appears in it, and each token access is recorded

**Given** two concurrent callers for the same store with an expired access token
**When** they call `integration.getAccessToken(storeId)`
**Then** exactly one refresh happens under `pg_advisory_xact_lock`, the second caller re-reads the new token, and the new pair is persisted in the same transaction

**Given** Salla rejects the refresh definitively
**When** `getAccessToken` fails
**Then** the store moves to `disconnected` and a `integration.store.disconnected` domain event is emitted

**Given** Salla responds with 429 and `Retry-After`
**When** the adapter calls Salla
**Then** it waits per `Retry-After` and paces calls per store

**Given** an installed store
**When** the merchant opens the dashboard
**Then** the connection chip shows "Connected to Salla" with the store name (Arabic "متصل بسلة")

### Story 1.9: Sign merchants in from the Salla iframe and the direct link

As a merchant,
I want to open Slips from inside Salla already signed in, or from a direct link,
So that I reach my dashboard without a separate password.

**Requirements:** FR28, AD-12, UX-DR41, NFR3

**Acceptance Criteria:**

**Given** the dashboard opened inside the Salla dashboard iframe
**When** the embedded SDK `getToken()` returns a token
**Then** the API introspects it, binds the session to that store, and mints a short-lived bearer token held in memory only and sent as `Authorization`
**And** before expiry the dashboard calls `getToken()` again to refresh, with no third-party cookie used

**Given** the dashboard opened by direct link outside Salla
**When** the merchant signs in
**Then** Salla OAuth runs and a first-party httpOnly, Secure, SameSite=Lax cookie plus CSRF token is issued, and an "Open in Salla" link is shown

**Given** a state-changing request on the cookie session without a valid CSRF token
**When** it reaches the API
**Then** it is rejected with a `application/problem+json` 403

**Given** a merchant session idle for 12 hours
**When** the merchant makes the next request
**Then** the session is expired and the merchant is returned to sign-in with friendly copy
**And** "Sign out" ends the session immediately in either mode

**Given** a merchant session
**When** it calls any `/admin` API route
**Then** it is refused (403), and `/admin` has its own sign-in placeholder and guard

**Given** response headers
**When** a merchant page is served
**Then** `frame-ancestors` allows only Salla's dashboard origin; `/admin` sends `frame-ancestors 'none'`

**Given** a token introspected for an uninstalled or unknown store
**When** sign-in is attempted
**Then** access is refused with a reinstall message, and sessions are tenant-scoped per Story 1.6

### Story 1.10: Receive install and uninstall webhooks and run the store lifecycle

As a merchant,
I want uninstalling to stop Slips immediately and reinstalling within 30 days to bring everything back,
So that my storefront is safe on exit and nothing is lost if I return.

**Requirements:** FR2, AD-20, AD-4, AD-16, AD-17, NFR3, NFR10

**Acceptance Criteria:**

**Given** a Salla webhook for install or uninstall
**When** it arrives
**Then** `X-Salla-Signature` is verified over the raw body with a timing-safe compare; an invalid signature returns 401 and is not stored
**And** a valid one is written to `webhook_inbox` (canonical PII-free payload, body hash, type, store external ID, unique Salla event ID), the handler returns 200, and no raw body is logged

**Given** the same Salla event ID delivered twice
**When** both are received
**Then** one inbox row exists and the transition runs once

**Given** an install webhook for an unknown store that arrives before OAuth completes
**When** it is received
**Then** it is parked and retried for 15 minutes, then dead-lettered (never answered 404)

**Given** an active store
**When** an uninstall event is processed
**Then** `lifecycle_state` becomes `uninstalled` with a 30-day grace end date, `integration.store.uninstalled` is emitted in the same transaction, tokens are revoked, and billing-related processing is skipped for that store
**And** the storefront content endpoint returns an empty result for that store's locator

**Given** an uninstalled store within the 30-day grace
**When** the merchant reinstalls
**Then** the same `stores` row is restored by `(platform, platform_store_id)`, `install_epoch` increments, state returns to `active`, and `integration.store.reinstalled` is emitted

**Given** a `StoreDataLifecycle` port (export, purge, restore)
**When** the grace period ends
**Then** one resumable purge job takes a per-store lock, re-checks state and epoch before each batch, calls every registered module's purge, writes an audit record, sets state `purged`, and drops work carrying a stale epoch
**And** a reinstall during a running purge stops further batches

### Story 1.11: Verify storefront injection and store time zone on a Salla demo store (gate G1, G7)

As a Slips developer,
I want to prove the App Snippet stub loads and reads page context on real Salla themes,
So that the team knows whether storefront injection works before building the player.

**Precondition:** a Salla Partners app and a Salla demo/test store with at least 3 representative themes available to switch between.

**Requirements:** AD-4, AD-7, AD-16, AD-21, NFR1, NFR9

**Acceptance Criteria:**

**Given** the stub from Story 1.2 registered as the App Snippet on the demo store
**When** home, category and product pages are opened on 3 or more themes without editing theme code
**Then** the stub loads on every page type and a spike `StorefrontPlatform` maps `salla.config` to a `PageContext` (`pageType`, `targetId`, `lang`, `dir`) and the `(platform, platform_store_id)` locator

**Given** each theme
**When** the page is checked for CSP and reserved space
**Then** the team records whether CSP blocks Slips CDN/API origins and whether space can be reserved before the script runs (input to AD-8)

**Given** the Salla store API
**When** store details are fetched
**Then** the team records whether the store time zone is available

**Given** the results
**When** the story is complete
**Then** `docs/spike-findings.md` has G1 and G7 entries with pass/fail, evidence (theme names, screenshots or logs) and the fallback if failed (guided manual snippet; Asia/Riyadh default)

### Story 1.12: Verify add-to-cart and cart tagging on a Salla demo store (gate G2, G3, G4)

As a Slips developer,
I want to add products to the Salla cart from the injected script and trace the tag into the order,
So that the team knows whether in-content purchase and attribution are feasible.

**Precondition:** the Salla demo store from Story 1.11 with at least one simple product and one product with required options, and the ability to place test orders as guest and signed-in shopper.

**Requirements:** AD-4, AD-9

**Acceptance Criteria:**

**Given** the injected spike script
**When** it adds a simple product to the cart as a guest and as a signed-in shopper
**Then** the team records the success and failure responses from Salla's cart API (G2)

**Given** a product with required options
**When** the script attempts to choose an option and add it
**Then** the team records whether a supported Salla API allows this (G3)

**Given** a tag set at add-to-cart time and a test order placed from that cart
**When** the order webhook and order API are inspected
**Then** the team records whether the tag or cart/checkout ID is readable and linkable to line items, and whether a thank-you-page beacon is possible (G4)
**And** no shopper PII from the test order is written to the repository or logs

**Given** the results
**When** the story is complete
**Then** `docs/spike-findings.md` has G2, G3 and G4 entries with pass/fail, evidence and the chosen fallback ("View product", FR23 "View options", order note/beacon or "assisted orders")

### Story 1.13: Verify webhooks, billing events and dashboard re-entry on a Salla demo store (gate G5, G6, G8)

As a Slips developer,
I want to observe real Salla lifecycle, billing, catalog and order webhooks plus dashboard re-entry,
So that the team knows which Salla behaviours later epics can rely on.

**Precondition:** the Salla demo store and Partners app from Story 1.11 with app billing plans (incl. a trial) configurable in the Partners Portal; Stories 1.8-1.10 deployed to staging.

**Requirements:** AD-12, AD-20, FR28

**Acceptance Criteria:**

**Given** the app installed, uninstalled, reinstalled and moved through subscription start, renew, upgrade, downgrade, cancel, expire and trial
**When** events arrive at the receiver
**Then** the team records which events arrive, their order and timing, and whether billing supports the planned plan structure (G5)

**Given** product, stock and order (created, updated, cancelled, refunded) changes on the demo store
**When** the webhooks arrive
**Then** the team records that signatures verify, how redelivery and ordering behave, and saves a recorded PII-scrubbed real webhook fixture for the integration test suite (G6)

**Given** the merchant reopens Slips from the Salla dashboard
**When** the iframe loads
**Then** the team records whether the merchant is signed in via `getToken()` and whether Salla exposes a storefront consent state (G8)

**Given** the results
**When** the story is complete
**Then** `docs/spike-findings.md` has G5, G6 and G8 entries with pass/fail, evidence and the fallback if failed (manual plan assignment by Slips Admin; reconciliation polling with relaxed FR24 bounds; OAuth login link and consent default per Q-18)

### Story 1.14: Record the Salla go/no-go decision

As a Slips developer,
I want one consolidated decision on every Salla capability,
So that later epics are built only on what Salla actually supports.

**Precondition:** Stories 1.11-1.13 completed against the Salla demo store.

**Requirements:** FR1, FR2, FR28

**Acceptance Criteria:**

**Given** the entries from Stories 1.11-1.13
**When** `docs/spike-findings.md` is finalised
**Then** it lists G1-G8 each with pass/fail, evidence links and the fallback chosen for each fail, and ends with a go/no-go decision and a product-owner sign-off line

**Given** any gate failed
**When** the decision is recorded
**Then** the affected requirements (e.g. FR11, FR13, FR17, FR23, FR24) are listed with the proposed PRD change, and Epics 2-7 are flagged as not to be sharded until the PRD is updated

**Given** G1 fails with no working manual-snippet fallback, or G2 has no reliable cart path
**When** the decision is recorded
**Then** the document states no-go for the affected scope (storefront or in-content purchase) explicitly

**Given** the PRD open questions
**When** the decision is recorded
**Then** Q-01 and Q-11 are proposed for closure with the evidence

## Epic 2: Product Catalog Sync

The merchant's Salla products, prices and stock appear in Slips and stay in sync (webhooks, manual sync, daily reconciliation, disconnection handling); the Products page lists them with linked content and availability.

### Story 2.1: Import the full product catalog on first install

As a merchant,
I want my Salla products imported automatically after I install Slips,
So that I can link them to my content without typing anything.

**Requirements:** FR3, FR25, AD-2, AD-4, AD-14

**Acceptance Criteria:**

**Given** a store has just completed install and OAuth (Epic 1) and emitted the install lifecycle event
**When** the worker consumes that event
**Then** a `catalog.full-sync` job (batch queue) imports every product through the `CommercePlatform` port, storing name, image, category, price, sale price, `tax_inclusive`, currency, availability and required-options flag
**And** this story creates the `products` and `categories` tables, owned by `catalog` in the ownership map, each with non-null `store_id`, RLS and a cross-tenant test

**Given** a product is stored
**When** its stock is 0, 1-5, or more than 5
**Then** `catalog` stores the availability bucket Out of stock, Low, or Available respectively, and no client recomputes it
**And** prices are integer minor units with currency code per the money convention, and every row carries `(platform, external_id)` plus `source_updated_at`

**Given** Salla returns `429` or a transient error during import
**When** the adapter retries
**Then** it paces per store, honours `Retry-After`, and uses the AD-1 default policy (5 attempts, 30 s to 15 min backoff)
**And** if the job still fails the store's sync state is `failed` with a reason code, exposed through `catalog`'s service for later UI

**Given** the import needs an access token
**When** it calls Salla
**Then** it gets the token only through `integration.getAccessToken(storeId)` and never refreshes tokens itself

**Given** a store on any plan or with plan enforcement skipped (non-`live` store)
**When** the catalog syncs
**Then** product count is never limited by plan; catalog sync reads no billing entitlements (limits are decided only by `content`, AD-14)

**Given** the import finishes
**When** the job completes
**Then** `catalog` records the last successful sync time and emits `catalog.sync.completed` via the transactional outbox with counts of created/updated products

### Story 2.2: Browse products on the Products page

As a merchant,
I want a Products page listing my synced products with category, price and availability,
So that I can see what I can promote and what is out of stock.

**Requirements:** FR16, FR3, AD-2, UX-DR10, UX-DR11, UX-DR22, UX-DR23, UX-DR36, UX-DR37

**Acceptance Criteria:**

**Given** a store with synced products
**When** the merchant opens Products from the side nav
**Then** a table (shadcn Table in Card, 56px rows, thumb) shows name, category, price, linked-content count, attributed orders and availability
**And** price shows the sale price when set, formatted with `Intl.NumberFormat` in store currency, Western digits, `tabular-nums`, isolated with `<bdi>`

**Given** the availability column
**When** a product is Available, Low or Out of stock
**Then** a status chip with a text label (never colour alone) is shown using the status-chip component tokens; Out of stock reads "Out of stock" / "نفد المخزون"
**And** this story builds the reusable status-chip and data-table components in `packages/ui` that Epic 3 reuses

**Given** the linked-content column
**When** `content` has not yet exposed its batch read (before Epic 3)
**Then** the column shows 0 via a single batch call shape `getLinkCountsByProductIds(storeId, ids)` (no N+1)
**And** the attributed orders column shows "—" until Epic 6 attribution is live

**Given** the merchant filters by category or types in search
**When** input changes
**Then** search is debounced, matches product name in Arabic or English, filter and search persist in the URL via nuqs, and the back button restores them
**And** a filtered-empty result shows a sentence and "Show all"

**Given** the store has no products yet or the first sync is still running
**When** the page loads
**Then** a syncing empty state with a link to Salla products is shown; while loading, a boneyard skeleton of 6 rows appears after 150 ms
**And** if the request fails, an inline error with Retry is shown and the shell keeps working

**Given** the viewport is `sm`
**When** the page renders
**Then** the table becomes a card list with no horizontal page scroll, in RTL and LTR

### Story 2.3: Sync products manually and see last sync time

As a merchant,
I want a "Sync products" button and the last sync time,
So that I can force an update and trust that my catalog is current.

**Requirements:** FR3, NFR12, UX-DR6, UX-DR20, UX-DR39

**Acceptance Criteria:**

**Given** the Products page
**When** it renders
**Then** the header shows "Last synced {relative time}" in the store time zone and a "Sync products" secondary button

**Given** the merchant clicks "Sync products"
**When** the request is accepted (`POST /v1/catalog/sync`)
**Then** the button shows a spinner with `aria-busy` and ignores further clicks, a full-sync job is enqueued (single-flight per store, a second request while running returns the running job), and on completion the list refreshes and last sync time updates

**Given** a manual sync was requested less than 60 seconds after the previous one
**When** the API receives it
**Then** it responds with an RFC 9457 problem (`type` `sync-rate-limited`) and the dashboard shows a localized friendly message

**Given** the sync fails after all retries
**When** the merchant views the page
**Then** an action toast reads the localized friendly-coach error with a "Retry" action that never auto-dismisses, and the page keeps showing the previous catalog

### Story 2.4: Apply product webhooks in near real time

As a merchant,
I want product, price and stock changes in Salla reflected in Slips automatically,
So that shoppers always see current prices and stock.

**Requirements:** FR3, FR25, AD-13, AD-17, AD-18, AD-2

**Acceptance Criteria:**

**Given** Salla sends a signed `product.created`, `product.updated` or stock/quantity webhook
**When** it is verified and stored in `webhook_inbox` by Epic 1's transport
**Then** a `catalog` handler (per store, serialized) upserts the product within 1 minute of receipt

**Given** two webhooks for the same product arrive out of order
**When** the older one is processed after the newer
**Then** the guarded write on `source_updated_at` leaves the newer data in place and the skip is counted in a metric

**Given** the same Salla event ID is delivered twice
**When** processed
**Then** the second delivery is a no-op

**Given** a product update changes a manifest-visible field (price, sale price, availability bucket, name, image, required-options flag)
**When** the upsert commits
**Then** `catalog.product.updated` is emitted in the same transaction with the changed fields
**And** a change only to non-visible fields (for example description) emits no event

**Given** a webhook payload is malformed or the product fetch fails
**When** retries are exhausted
**Then** the inbox row is dead-lettered, an alert fires through the telemetry module, and the next reconciliation (Story 2.6) repairs the product

### Story 2.5: Handle products deleted in Salla

As a merchant,
I want Slips to notice when I delete a product in Salla,
So that content never sells something that no longer exists.

**Requirements:** FR25, AD-2, AD-17

**Acceptance Criteria:**

**Given** a `product.deleted` webhook or a reconciliation finding that a product no longer exists
**When** `catalog` processes it
**Then** the product is soft-deleted (tombstone with `deleted_at`, no cascading FK delete) and `catalog.product.deleted` is emitted with `(store_id, product_id)`

**Given** a deleted product
**When** the Products page or product picker queries products
**Then** it is excluded by default

**Given** the product is later recreated in Salla with the same external ID
**When** a create/update webhook arrives
**Then** the tombstone is cleared and `catalog.product.updated` is emitted

**Given** the deletion event
**When** consumers exist (content in Story 3.4, publishing in Epic 4)
**Then** the event schema and owner are catalogued in `packages/contracts` so they can react idempotently on event ID

### Story 2.6: Reconcile the catalog daily

As a merchant,
I want my catalog to self-correct at least daily,
So that missed webhooks never leave wrong prices or stock on my store.

**Requirements:** FR25, AD-13, AD-1

**Acceptance Criteria:**

**Given** a scheduled `catalog.reconcile` job runs at least once every 24 hours per active store
**When** it compares Salla's products with local rows
**Then** missing products are created, differing products updated, and absent ones handled per Story 2.5, using the same guarded writes and event rules as Story 2.4

**Given** reconciliation finds differences
**When** it finishes
**Then** a structured log line and metric record counts of created, updated, deleted and unchanged products with `store_id` and `trace_id`, and last sync time updates

**Given** reconciliation for one store fails
**When** retries are exhausted
**Then** other stores are unaffected and an alert is raised

**Given** a store is `disconnected` or `uninstalled`
**When** the schedule fires
**Then** that store is skipped

### Story 2.7: Pause sync when disconnected and resume on reconnect

As a merchant,
I want to see clearly when Slips loses access to my store and fix it in one step,
So that my catalog does not silently go stale.

**Requirements:** FR25, AD-20, UX-DR21, UX-DR39

**Acceptance Criteria:**

**Given** the store moves to `disconnected` (token refresh definitively failed or access revoked, Epic 1)
**When** catalog jobs or webhooks are processed
**Then** sync is paused (jobs skip with reason `disconnected`) and storefront content keeps serving last data

**Given** a disconnected store
**When** the merchant opens any dashboard page
**Then** a persistent in-flow danger banner shows "Your Salla connection dropped, so syncing paused. Reconnect to continue." (Arabic first) with the last sync time and a "Reconnect" action

**Given** the merchant completes reconnect
**When** the store returns to `active`
**Then** the banner clears and a full sync is enqueued immediately to catch up

**Given** a store reinstalled within the 30-day grace
**When** the restore runs
**Then** `catalog`'s `StoreDataLifecycle` restore keeps the same product rows and triggers a full sync; its export returns products and categories and its purge deletes them after grace

## Epic 3: Content Creation & Media

The merchant creates, uploads, previews (real player in preview mode), and manages Stories and Reels through their full status lifecycle.

Note: open question A-1 is resolved for these stories with the AD-19 interim: Published items are edited live and saved explicitly.

### Story 3.1: Model content items and their status lifecycle

As a Slips developer,
I want one content state machine owned by the `content` module,
So that every status change is consistent between dashboard and storefront.

**Requirements:** FR22, AD-19, AD-2, AD-17, AD-11

**Acceptance Criteria:**

**Given** this story
**When** migrations run
**Then** it creates `content_items` (owned by `content`; UUIDv7, `store_id`, title, format Story/Reel, CTA fields, status, auto-publish flag, `first_published_at`, `deleted_at`) with RLS and a cross-tenant test

**Given** the statuses Draft, Processing, Failed, Scheduled, Published, Ended, Archived, Deactivated
**When** a transition is requested
**Then** it is checked against the transition table in `packages/contracts`; disallowed transitions return an RFC 9457 problem (`type` `invalid-transition`) and change nothing
**And** there is no "Ready" status

**Given** any successful transition
**When** it commits
**Then** only `content` writes the status and emits `content.item.<status-verb>` in the same transaction (outbox)

**Given** other modules (`media`, later `billing`)
**When** they need a status change
**Then** they call a `content` command; a lint/test proves no other module writes `content_items.status`

**Given** a content item is deleted
**When** delete runs
**Then** it is soft-deleted (tombstone kept for analytics) and `content.item.deleted` is emitted

### Story 3.2: List and filter content with status tabs

As a merchant,
I want my content listed with status, tabs and counts,
So that I can find and manage any Story or Reel quickly.

**Requirements:** FR6, FR22, UX-DR10, UX-DR11, UX-DR22, UX-DR23, UX-DR39

**Acceptance Criteria:**

**Given** the Videos & Stories page
**When** it loads
**Then** a content table shows thumb, title, format, placement, status chip, views, clicks and a row menu; views and clicks show "—" until Epic 6

**Given** tabs All, Published, Scheduled, Drafts
**When** counts render
**Then** All counts every non-deleted status; Drafts counts Draft, Processing and Failed; Archived, Deactivated and Ended appear only under All with their chip
**And** the active tab, search and sort live in the URL (`?tab=`) via nuqs

**Given** each status chip
**When** shown
**Then** it uses the DESIGN.md chip for that status (Processing with pulsing dot, static under reduced motion; Failed with reason and 6% row tint; Scheduled with date in store time zone; Archived with archive icon; Deactivated amber), always with a text label

**Given** a row
**When** clicked or focused and `Enter` pressed
**Then** the editor opens for that item

**Given** no content exists
**When** the page loads
**Then** the empty state reads the friendly-coach sentence with one amber "Create your first story" action; an empty tab shows its sentence plus action; loading shows a 6-row skeleton after 150 ms; an API failure shows an inline Retry

### Story 3.3: Create a Story or Reel with title, format and CTA

As a merchant,
I want to create content by choosing format, title and a call to action,
So that my content is shoppable from the start.

**Requirements:** FR4, FR22, UX-DR12, UX-DR6, UX-DR39, UX-DR40, AD-19

**Acceptance Criteria:**

**Given** the merchant clicks "Create" (amber action)
**When** the editor opens (`mockups/key-content-editor.html`)
**Then** it shows two columns (form start side, preview placeholder end side), single column with sticky preview button on `md`, stacked with preview toggle on `sm`
**And** saving the first field creates a Draft

**Given** the CTA section
**When** the merchant fills it
**Then** they set a label, an action (add to cart / open product / open link) and an optional preset style
**And** "open link" accepts only URLs on the store's own synced domains; other URLs show an inline error naming the rule, and the API re-validates and rejects with a problem

**Given** a Draft
**When** the merchant edits any field
**Then** it autosaves after ~1 s debounce and shows "Saved"; merchant text is stored as-is and rendered with `dir="auto"` and escaped (no XSS)

**Given** a validation error
**When** the merchant blurs a field or submits
**Then** errors show in the active language with a summary linking to fields, announced via a live region

**Given** unsaved changes
**When** the merchant navigates away
**Then** a confirm dialog asks before leaving

### Story 3.4: Link a product with the product picker

As a merchant,
I want to pick a synced product for my content,
So that shoppers can buy it from the Story.

**Requirements:** FR4, FR16, FR25, UX-DR15, AD-2

**Acceptance Criteria:**

**Given** the editor's product field
**When** the merchant types
**Then** a searchable combobox lists synced products (via `catalog` service) with thumb, name, price and availability chip, keyboard-operable

**Given** the merchant selects an Out of stock product
**When** it is linked
**Then** a warning says the CTA will show "Out of stock" until stock returns; linking is still allowed

**Given** a product with the required-options flag
**When** it is linked
**Then** the CTA preview note says the button will read "View options"

**Given** a link is saved
**When** it commits
**Then** this story creates `content_product_links` (owned by `content`) and exposes `getLinkCountsByProductIds`, so the Products page linked-content count shows real numbers

**Given** `catalog.product.deleted` arrives
**When** `content` handles it (idempotent on event ID)
**Then** each linked item is flagged "Linked product deleted" in the list and editor, and `content.item.edited` is emitted so publishing can drop it

### Story 3.5: Upload media directly to storage safely

As a merchant,
I want to upload images and videos securely,
So that my files are accepted quickly and nothing unsafe goes live.

**Requirements:** FR5, NFR11, AD-15, AD-2

**Acceptance Criteria:**

**Given** the merchant requests an upload
**When** `media` issues a pre-signed URL
**Then** it is store-scoped, store-prefixed, content-addressed, size-limited (video 200 MB, image 10 MB) and expires in 15 minutes
**And** this story creates `media_assets` (owned by `media`) with states `uploaded -> scanned -> processed | failed`

**Given** a store exceeds the upload issue rate threshold
**When** it requests more URLs
**Then** issue is throttled with a problem response and an abuse metric is recorded; per-store stored bytes are metered

**Given** an uploaded object
**When** the worker inspects it
**Then** type is sniffed from content (video MP4/MOV/WebM; image JPG/PNG/WebP); SVG and mismatches are rejected; image EXIF/GPS metadata is stripped

**Given** a valid file
**When** the `MalwareScanner` port scans it
**Then** clean files move to `scanned`; infected ones to `failed` with reason; only `processed` assets can ever be published

### Story 3.6: Add slides with the media uploader and reorder them

As a merchant,
I want to drop several files at once and arrange them,
So that I can build a Story in minutes.

**Requirements:** FR4, FR5, UX-DR13, UX-DR14, UX-DR12

**Acceptance Criteria:**

**Given** the editor's uploader (dashed `input-border` drop zone)
**When** the merchant drags or picks multiple files
**Then** each is pre-checked in the browser against FR5 limits (video <= 200 MB, <= 90 s, shorter side >= 720; image <= 10 MB, shorter side >= 1080) and rejected with a message naming the limit, before upload

**Given** accepted files
**When** they upload
**Then** each shows per-file progress, then Processing with poster, or Failed with reason and Retry
**And** this story creates `slides` (owned by `content`) referencing `media_assets`

**Given** an image slide
**When** saved
**Then** alt text is required

**Given** a slide
**When** the merchant uses "Move earlier"/"Move later" or drag
**Then** order changes in logical order (RTL-safe), "Slide 2 of 3" is announced, and focus stays on the moved slide

### Story 3.7: Import media from an external link

As a merchant,
I want to paste a link to a video or image,
So that I can reuse media I already host.

**Requirements:** FR5, NFR3, AD-15

**Acceptance Criteria:**

**Given** the merchant pastes a URL
**When** submitted
**Then** a worker job fetches it through the single SSRF-safe fetcher (blocks private/loopback/link-local/metadata IPs and redirects to them, enforces size and timeout) and stores a copy; the media is never hotlinked

**Given** a fetched file
**When** stored
**Then** it goes through the same sniff, strip, scan and processing path as uploads

**Given** the fetch fails or is blocked
**When** the job ends
**Then** the slide shows Failed with a friendly reason and Retry

### Story 3.8: Process videos into renditions and posters

As a merchant,
I want my videos processed automatically,
So that they play smoothly on any connection.

**Requirements:** FR5, NFR13, AD-15, AD-1

**Acceptance Criteria:**

**Given** a `scanned` video asset
**When** the media queue (own worker deployment) processes it via the `MediaProcessor` port
**Then** progressive MP4 renditions at 480p, 720p and 1080p (where the source allows) and a poster are produced at immutable paths; no HLS
**And** this story creates `renditions` (owned by `media`)

**Given** processing is running
**When** the merchant views the item
**Then** the item status is Processing (set through a `content` command)

**Given** a 60 s 1080p test video in staging
**When** processed
**Then** it completes within 5 minutes at P95 excluding queue spikes, recorded as a metric

**Given** an image asset
**When** processed
**Then** a web-optimized version is produced and the asset becomes `processed`

### Story 3.9: Run quality checks, retry failures and auto-publish

As a merchant,
I want clear processing results and an option to publish automatically,
So that I know when my content is ready without watching it.

**Requirements:** FR5, FR22, NFR12, AD-15, AD-19, UX-DR20, UX-DR39

**Acceptance Criteria:**

**Given** a processed asset
**When** the quality check runs
**Then** it flags below minimum resolution, no video track, corrupt file, or over 90 s duration, with a reason code

**Given** a failing job
**When** it errors
**Then** it retries automatically (media: 3 attempts per AD-1); after the last, `media` tells `content` and the item becomes Failed with reason (e.g. "This video didn't finish processing: resolution is below 720p...") and a "Retry" action that re-queues it

**Given** all slides pass and auto-publish is off
**When** processing finishes
**Then** the item returns to Draft

**Given** auto-publish is on
**When** processing passes
**Then** `content` runs its publish eligibility check; with no placement (placements arrive in Epic 4) the item stays Draft with the reason "Add a placement to publish" shown in editor and list

### Story 3.10: Serve a preview manifest for one content item

As a Slips developer,
I want a preview endpoint that builds a manifest with the same compiler code as the storefront,
So that previews match what shoppers will see.

**Requirements:** FR7, AD-23, AD-6, AD-11

**Acceptance Criteria:**

**Given** an authenticated merchant
**When** they call `GET /v1/preview/content/{id}`
**Then** the API returns a `StoreManifest` v1 (contracts schema) containing only that item, its slides, product snapshot and asset URLs, built by a compile function in `publishing` that Epic 4 reuses for the CDN manifest

**Given** a preview response
**When** served
**Then** it is never cached on the CDN and requires the merchant session; another store's item returns 404

**Given** slides still Processing
**When** previewed
**Then** posters or the original upload are used so the merchant sees something

### Story 3.11: Render content in the player's preview mode

As a Slips developer,
I want the real player build to run in preview mode with a mock storefront,
So that the dashboard preview uses the same code shoppers get.

**Requirements:** FR7, AD-23, AD-7, UX-DR35, UX-DR36

**Acceptance Criteria:**

**Given** `packages/player` built for preview
**When** loaded in an iframe with `MockStorefrontPlatform` and a preview manifest
**Then** it renders the item's slides vertically (9:16), title, product card and CTA in Shadow DOM, system fonts, `--slips-*` properties only

**Given** the shopper-side CTA is pressed in preview
**When** add to cart runs
**Then** it is simulated as success; no events and no cart confirms are sent

**Given** locale `ar` or `en`
**When** rendered
**Then** direction follows locale and merchant text uses `dir="auto"`

**Given** a new manifest posted to the iframe
**When** received
**Then** the player re-renders without reload

### Story 3.12: Show the live preview panel in the editor

As a merchant,
I want a phone-sized preview that updates as I edit,
So that I see exactly what shoppers will see before publishing.

**Requirements:** FR7, UX-DR16, UX-DR41

**Acceptance Criteria:**

**Given** the editor
**When** it loads
**Then** the end-side column shows a 9:16 phone frame (radius lg, ink bezel) iframing the preview player, with the always-visible note "Preview: no real cart or analytics"

**Given** the merchant changes title, CTA, product or slide order
**When** the draft saves
**Then** the preview updates within 2 s

**Given** the preview is loading
**When** it takes over 150 ms
**Then** a skeleton phone frame shows; on failure "Preview didn't load. Try again." with Retry

### Story 3.13: Edit, duplicate, archive, restore and delete content

As a merchant,
I want to change and tidy my content safely,
So that my library stays organized and live items change only when I say so.

**Requirements:** FR6, FR22, AD-19, UX-DR11, UX-DR12, UX-DR20, UX-DR40

**Acceptance Criteria:**

**Given** a Published item in the editor
**When** the merchant edits
**Then** nothing autosaves; a "Save changes" button commits all edits as one `content.item.edited` event and shows the "Changes saved" toast

**Given** the row menu
**When** the merchant chooses Duplicate
**Then** a new Draft copy with "(copy)" title and same slides and link is created, without placements or schedule

**Given** Archive
**When** chosen
**Then** the item becomes Archived, emits its event, and a toast announces "Archived. Undo available" with Undo that never auto-dismisses; Undo returns the prior status
**And** Archived items offer "Restore", returning them to Draft

**Given** Delete
**When** chosen
**Then** a confirm dialog naming the item appears; confirming soft-deletes it, emits `content.item.deleted`, and removes it from all tabs

**Given** media referenced only by a deleted item
**When** no references remain
**Then** `media` may remove the asset later; assets referenced elsewhere are kept

## Epic 4: Visibility, Scheduling & Publishing

Published content appears on the right storefront pages, in the right layout and order, at the right time, and stays fresh within the FR24 bounds.

### Story 4.1: Choose placements and targets for a content item

As a merchant,
I want to choose the pages where my story or reel appears (home, a category, a product page),
So that shoppers see it where it is relevant.

**Requirements:** FR8, AD-2, AD-3, AD-19

**Acceptance Criteria:**

**Given** a content item open in the editor
**When** I add a placement
**Then** I can choose Home, Category or Product page, and for Category/Product an optional target picked from synced categories/products (searchable, Western digits, names in `dir="auto"`)
**And** the `placements` table (owner `content`, non-null `store_id`, RLS, cross-tenant test) is created in this story's migration

**Given** an item with no placement
**When** I press Publish (or auto-publish passes QC)
**Then** publish is blocked with the inline reason "Add a placement to publish" (button `aria-disabled` with reason, focus kept) and an auto-published item stays Draft with that reason (FR22)

**Given** a target product or category is later deleted in Salla
**When** the placement is shown in the editor
**Then** it is flagged "Linked product deleted" and no longer counts as a valid placement

**Given** I add, change or remove a placement on a Published item
**When** I press "Save changes"
**Then** exactly one `content.item.edited` domain event is emitted in the same transaction (AD-17)

### Story 4.2: Pick a layout per placement with Settings defaults

As a merchant,
I want each placement to use a layout (story ring/bar, product-page strip, home/category carousel boxed or full width, Reels covers opening the full-screen viewer),
So that content fits the page it lives on.

**Requirements:** FR29, FR8

**Data:** This story creates `store_settings` (owner `integration`; one row per store, holding display defaults, attribution window default 7 and language). Later stories add columns, never a second settings table.

**Acceptance Criteria:**

**Given** a placement on a Story item
**When** I open its layout control
**Then** I can choose Ring or Bar; for a Reel item I can choose Strip or Carousel of covers (boxed or full width on home/category; strip below images or custom position on product page), each opening the full-screen viewer

**Given** a new placement
**When** it is created
**Then** its layout defaults to the store's display default from `store_settings` (owner `integration`), falling back to Ring for Stories and Strip/Carousel for Reels when no default is stored

**Given** a layout not valid for the page type (e.g. full-width carousel on product page)
**When** I try to save
**Then** the API rejects it with a `problem+json` slug and the form shows a localized field error

### Story 4.3: Schedule start and end in the store time zone

As a merchant,
I want to set a start time and optional end time for a content item,
So that campaigns go live and stop on their own.

**Requirements:** FR8, FR24, AD-19

**Acceptance Criteria:**

**Given** the editor schedule section
**When** I choose "Now" or a wall-clock date/time
**Then** the time is shown and entered in the store time zone with its label (G7 result, else Asia/Riyadh), Arabic month names, Western digits, and the API converts it to UTC `timestamptz`
**And** the `schedules` table (owner `content`, RLS) is created in this story's migration

**Given** a future start time
**When** I publish
**Then** status becomes Scheduled (chip with date) and a pg-boss delayed job is queued with dedup key per item and boundary

**Given** the start boundary passes
**When** the job runs
**Then** status moves Scheduled -> Published via the contracts transition table and emits a status event; at an end time Published -> Ended

**Given** I edit the start/end or the store time zone changes
**When** the change is saved
**Then** existing boundary jobs are replaced (no duplicate transitions) and future schedules are re-anchored

**Given** an end time earlier than or equal to the start
**When** I save
**Then** the form shows "End time must be after the start time" and nothing is saved

### Story 4.4: Compile the per-store manifest of eligible content

As a Slips developer,
I want one compiled `StoreManifest` per store containing only content eligible now,
So that the storefront reads a single small, cacheable file.

**Requirements:** AD-6, AD-18, FR30, FR24, AD-19

**Reuse:** Extend the manifest compile function created in Story 3.10 (`publishing`); do not write a second compiler. Preview and storefront manifests must come from the same code.

**Acceptance Criteria:**

**Given** a store with content items
**When** the compile job runs
**Then** the manifest (contracts `StoreManifest` v1) contains only Published, in-schedule items with their placements, layouts, display options, product snapshots (price the cart charges, sale price, availability bucket, required-options flag) and immutable processed asset URLs
**And** Draft, Processing, Failed, Scheduled, Ended, Archived, Deactivated and deleted items are excluded (filter on status only)

**Given** more than 10 eligible items on one placement
**When** compiled
**Then** items are ordered by `first_published_at` newest first and capped at 10

**Given** several triggers in the `ManifestInputs` list fire within ~10 s
**When** compile runs
**Then** it runs single-flight per store, debounced, writes `store_manifests` (owner `publishing`, created here) with a monotonic `revision`, and never overwrites a newer revision

**Given** a CTA "open link" URL no longer on the store's synced domain
**When** compiled
**Then** that CTA is dropped from the manifest and the item is flagged for the merchant

**Given** a manifest above 15 KB gzip
**When** compiled
**Then** a manifest-size metric and warning are emitted (sharding deferred)

### Story 4.5: Serve the manifest from the CDN and purge on change

As a shopper,
I want the storefront to load current content quickly,
So that I see the right stories within a minute of the merchant's change.

**Requirements:** AD-6, AD-18, FR24, NFR7

**Acceptance Criteria:**

**Given** a compiled manifest
**When** it is uploaded
**Then** it is served at `/m/v1/salla/<platform_store_id>.json` (and active/retiring key paths) with TTL 60 s plus stale-while-revalidate, and only `publishing` calls `CdnPurger`, with retried purges

**Given** publish, unpublish, archive, delete or a schedule boundary
**When** the change commits
**Then** the storefront manifest reflects it within 1 minute (integration test measures it)

**Given** an uninstalled, purged or unknown store, or a revoked key
**When** its manifest path is requested
**Then** an empty eligible list is returned, never an error page

**Given** Salla is in an outage (degraded mode)
**When** shoppers request the manifest
**Then** the last manifest keeps serving and a compile-lag metric/alert reports staleness

### Story 4.6: Refresh the storefront on product price and stock changes

As a merchant,
I want price and stock changes in Salla to show on my stories quickly,
So that shoppers never see a wrong price or buy something out of stock.

**Requirements:** FR24, AD-18

**Acceptance Criteria:**

**Given** a linked product's price, sale price, stock bucket or required-options flag changes in Salla
**When** catalog emits its manifest-visible change event
**Then** a recompile is triggered and the storefront shows the new value within 2 minutes P95 (1 min sync + 1 min cache)

**Given** a product field that is not manifest-visible changes
**When** the event is processed
**Then** no recompile is triggered

**Given** a linked product is deleted
**When** the change is processed
**Then** its content leaves the storefront at the next compile

**Given** the automated freshness test
**When** it runs in CI against staging fixtures
**Then** it covers a schedule start, a schedule end and a price change, each asserted within its bound

## Epic 5: Storefront Player & In-Content Purchase

Shoppers see the story ring (or floating bubble), watch Stories and Reels, and add products to their Salla cart without leaving the content, on every supported browser and theme, in Arabic and English.

### Story 5.1: Ship the App Snippet stub and release-channel loader

As a Slips developer,
I want a static, store-identical App Snippet stub that loads a versioned loader from a release channel,
So that every store gets Slips with no theme edits and we can roll out or roll back safely.

**Requirements:** FR9, AD-21, AD-7, NFR1, NFR8

**Data:** This story creates `store_keys` (owner `publishing`; states active, retiring, revoked; AD-16) for the manual-snippet fallback. Story 7.2 adds the Regenerate action.

**Reuse:** Extend the player build and `StorefrontPlatform` port created for preview mode in Story 3.11; do not start a second player package.

**Acceptance Criteria:**

**Given** the stub in `packages/player/stub`
**When** it runs on a storefront page
**Then** it reads `(platform, platform_store_id)` and language from `salla.config`, fetches the short-TTL channel pointer, and loads the named immutable loader asynchronously without blocking render

**Given** channels `stable` and `canary` (cohort %)
**When** a store falls in the canary cohort
**Then** it gets the canary loader; repointing the channel rolls back; the global kill switch loads nothing

**Given** the stub runs twice, the pointer or loader is blocked/missing/times out, or the manifest major is unknown
**When** boot is attempted
**Then** it fails silently (no console errors thrown to the page, nothing rendered) and the `window.__slips` guard prevents double boot

**Given** `cart::*` events before the loader is ready
**When** the loader boots
**Then** the buffered events are replayed

**Given** the manual-snippet fallback with an injector key
**When** used
**Then** only `active` or `retiring` keys load content
**And** CI fails if the initial payload exceeds 50 KB gzip and warns above 20 KB core; only Slips CDN and API origins are contacted (documented for CSP); release to Partners Portal follows the documented step

### Story 5.2: Render only eligible content for the page and fail invisibly

As a shopper,
I want the store to work normally whether or not Slips has content for this page,
So that Slips never breaks or slows my shopping.

**Requirements:** FR9, FR10, NFR1, AD-7, AD-4, UX-DR35, UX-DR36

**Acceptance Criteria:**

**Given** the loader on a home, category or product page
**When** `StorefrontPlatform` maps `salla.*` to `PageContext`
**Then** only manifest items matching page type and target ID are rendered

**Given** no eligible content, API timeout, invalid key or Slips unreachable
**When** the page loads
**Then** nothing is visible, no space is reserved and the store is fully functional

**Given** content is rendered
**When** inspected
**Then** it lives in Shadow DOM, uses system fonts and only `--slips-*` custom properties, neutral light-only styling independent of `prefers-color-scheme`, defines `slips-player`/`slips-viewer` once, adds no globals beyond `window.__slips`, and imports `preact` only at runtime (lint-enforced)

**Given** the storefront language is Arabic or English
**When** the player mounts
**Then** the host gets `lang` and `dir` (RTL/LTR) from the locale, uses logical properties only and wraps prices/names in bidi isolates

### Story 5.3: Show the story ring entry with floating-bubble fallback without layout shift

As a shopper,
I want a story ring (or a small floating bubble) where content is available,
So that I can open stories without the page jumping.

**Requirements:** FR10, FR29, AD-8, NFR1, UX-DR25, UX-DR26, UX-DR3

**Acceptance Criteria:**

**Given** eligible Story content with ring/bar layout and its anchor below the viewport at insertion
**When** the manifest arrives
**Then** the ring inserts inline: 68px avatars with the coral-to-amber story-ring gradient, 12px one-line label, horizontal scroll following text direction (mockups/key-story-viewer.html)

**Given** the anchor is already in view (including when the shopper scrolled past before the manifest arrived)
**When** insertion would occur
**Then** no inline element is inserted and a 56px floating bubble mounts on `document.body` at bottom-start, never covering the theme cart/checkout button

**Given** the bubble
**When** I tap its 24px dismiss button (44px hit area)
**Then** it hides for the rest of the session

**Given** a ring item
**When** focused or read by AT
**Then** it is a `button` named "{title}, story, new" or "..., seen", seen state (stored per viewer locally) uses the thinner flat seen ring, and focus uses the white-inner/ink-outer player focus ring

**Given** the Playwright CLS test on 3 themes
**When** run for no content, API timeout and scroll-past-anchor-before-manifest
**Then** Slips-caused CLS is 0

### Story 5.4: Open the full-screen viewer with accessible controls

As a shopper,
I want a full-screen viewer that I can control by touch, mouse, keyboard or screen reader,
So that I can watch content comfortably and leave it easily.

**Requirements:** FR10, NFR6, AD-7, AD-8, UX-DR27, UX-DR28, UX-DR35

**Acceptance Criteria:**

**Given** I activate any entry point
**When** the viewer opens
**Then** it mounts on `document.body` as `role=dialog`, `aria-modal`, named "{merchant} stories", host siblings `inert`, scroll locked, initial focus on Pause, focus trapped; phone full screen with safe-area insets, desktop centered 9:16 with backdrop and visible arrows

**Given** the viewer is open
**When** I look for controls
**Then** mute, pause, close, next and previous are 44px round buttons (white icon on 40% scrim), mute and pause visible in every mode, tap zones are named buttons "Next slide"/"Previous slide"

**Given** I press `Esc` or Close
**When** the viewer closes
**Then** scroll lock and `inert` are removed and focus returns to the entry that opened it

**Given** the lazy viewer module
**When** built
**Then** it loads on first interaction and stays within 25 KB gzip

### Story 5.5: Play Stories with segmented progress and auto-advance

As a shopper,
I want stories to play slide by slide with a progress bar,
So that I can browse a merchant's stories quickly.

**Requirements:** FR10, UX-DR29, UX-DR35

**Acceptance Criteria:**

**Given** a story opens
**When** the first slide shows
**Then** the poster shows first then the video plays muted; image slides advance after their duration; segmented 2px white bars with 4px gap sit on a 64px top scrim

**Given** Pause, long-press, `Space` or `K`
**When** used
**Then** auto-advance and video stop until resumed

**Given** I navigate manually
**When** the slide changes
**Then** a hidden "Slide 2 of 5" is announced (not announced on auto-advance)

**Given** the last slide of a story ends
**When** more stories exist in the ring
**Then** the next story opens; after the last, the viewer closes and focus returns to the entry

**Given** the shopper goes offline mid-view
**When** media is already loaded
**Then** it keeps playing

### Story 5.6: Apply RTL/LTR gestures, keyboard map and reduced motion

As a shopper,
I want gestures and keys to follow my language direction and my motion settings,
So that the player feels native and never moves on its own when I asked it not to.

**Requirements:** FR10, NFR5, NFR6, UX-DR33, UX-DR34, UX-DR36

**Acceptance Criteria:**

**Given** an RTL viewer
**When** I tap the inline-start third
**Then** it goes to the next slide; tap zones mirror in LTR; progress fills in reading direction; media/playback icons never mirror

**Given** keyboard focus inside the viewer
**When** I press arrow keys, `PageDown`/`PageUp`, `M`, `Esc`, `Space`/`K`
**Then** arrows follow viewer `dir` for slides, `PageDown`/`PageUp` move between story groups, `M` mutes, `Esc` closes, `Space`/`K` pause (Space never advances); single-key shortcuts do nothing when focus is outside the viewer

**Given** swipe toward inline-start, swipe down, long-press
**When** performed
**Then** they move to the next group, close, and pause respectively, and each has a button alternative

**Given** `prefers-reduced-motion: reduce`
**When** Stories play
**Then** they do not auto-advance (tap/Next to advance only), there are no transitions, and an ended video slide stops on its last frame with a focus-reachable Next

### Story 5.7: Play Reels as a vertical swipe feed with lazy loading

As a shopper,
I want to swipe through full-screen videos one at a time,
So that discovery feels natural without wasting my data.

**Requirements:** FR10, NFR1, UX-DR33, UX-DR28

**Acceptance Criteria:**

**Given** Reels covers (strip/carousel)
**When** I open one
**Then** the viewer shows one video at a time, muted autoplay, swipe up/`↓` for next and swipe down/`↑` for previous, with Next/Previous buttons

**Given** the page loads
**When** the Reels placement is not yet near the viewport
**Then** no video bytes or viewer code are loaded

**Given** data saver is on or the browser blocks autoplay
**When** a reel is shown
**Then** the poster with a play button appears instead of autoplay

**Given** the open viewer
**When** I swipe down from the first reel or press `Esc`
**Then** the viewer closes and focus returns

### Story 5.8: Pick an adaptive rendition for a fast first frame

As a shopper,
I want videos to start fast on my connection,
So that I don't wait.

**Requirements:** FR10, NFR2, AD-15

**Acceptance Criteria:**

**Given** 480p/720p/1080p progressive MP4 renditions
**When** a video starts
**Then** the player picks a rendition from viewport size and connection (Network Information where available, else 720p), preloading only the poster and the next slide

**Given** Fast 4G on a mid-range Android profile
**When** the player opens
**Then** the first video frame appears within 2 s (CI performance test)

**Given** playback stalls repeatedly
**When** detected
**Then** the next slide uses a lower rendition

### Story 5.9: Show the product card and add to the Salla cart in place

As a shopper,
I want to see the product price and add it to my cart from the video,
So that I can buy without leaving the content.

**Requirements:** FR11, AD-7, AD-9, NFR6, UX-DR30, UX-DR31, UX-DR39

**Acceptance Criteria:**

**Given** a slide with a linked product
**When** shown
**Then** the card has a white surface, 22px radius, 56px thumb, 2-line name, tabular price the cart will charge (sale price when set) and a 48px full-width ink CTA with amber text; opening the card pauses auto-advance; taps on the card/CTA never navigate slides

**Given** I press Add to cart
**When** the request is pending
**Then** the CTA shows a spinner with `aria-disabled="true"` and `aria-busy="true"` (never native `disabled`), focus stays, playback pauses, double-submit is ignored

**Given** Salla's cart promise confirms
**When** success returns
**Then** the empty polite live region (mounted at viewer open) announces "Added to cart. Cart: 3 items", playback resumes, the add is tagged per the G4 mechanism and `POST /v1/cart-adds` is sent immediately with `keepalive` (never batched)

**Given** Salla returns a different price
**When** the add completes
**Then** the card updates to Salla's price

**Given** out of stock or an API failure
**When** the add fails
**Then** an assertive inline "Couldn't add it right now. Try again." (or localized out-of-stock text) shows, the CTA re-enables and the shopper stays in the viewer

**Given** the secondary actions
**When** I choose "Open product" or "Open cart"
**Then** the product page or cart opens

### Story 5.10: Handle required-options and out-of-stock products

As a shopper,
I want clear actions for products that need size/colour or are sold out,
So that I am never stuck on a button that can't work.

**Requirements:** FR23, FR11, FR16, UX-DR32, UX-DR31

**Acceptance Criteria:**

**Given** a product with the required-options flag and no G3 pass
**When** its card shows
**Then** the CTA reads "اختر المقاس واللون" / "View options" and opens the product page; it is recorded as a product click and never sent as a cart add or credited

**Given** an out-of-stock product in the manifest
**When** its card shows
**Then** the CTA stays focusable with `aria-disabled`, is named "Out of stock" and does nothing on press

**Given** stock changes back to available
**When** the next manifest is loaded
**Then** the normal Add to cart CTA returns

### Story 5.11: Render product-page strip and home/category carousel layouts

As a merchant,
I want my content shown as a product-page strip or home/category carousel,
So that it fits each page of my store.

**Requirements:** FR29, FR10, AD-8, NFR1

**Acceptance Criteria:**

**Given** a product-page placement with strip layout
**When** eligible and its anchor is below the viewport
**Then** the strip inserts below product images (or the custom position) and opens the viewer on tap

**Given** a home/category placement with carousel (boxed or full width)
**When** eligible and anchor below the viewport
**Then** the carousel inserts and opens the full-screen viewer; otherwise the floating bubble is used

**Given** each layout in Arabic and English
**When** rendered
**Then** scroll and order follow text direction

**Given** the CLS test
**When** run on 3 themes in the 4 scenarios (content, no content, API timeout, invalid key)
**Then** every layout has zero Slips-caused layout shift

### Story 5.12: Verify the player across browsers and themes

As a Slips developer,
I want the player tested across supported browsers and themes,
So that no shopper gets a broken store.

**Requirements:** NFR9, NFR1, NFR6

**Acceptance Criteria:**

**Given** the player test suite
**When** CI runs
**Then** it covers iOS Safari (last 3), Android Chrome (last 3), Samsung Internet and desktop Chrome/Safari/Edge/Firefox (last 2), including keyboard and screen-reader-name checks

**Given** the theme compatibility matrix in the repo
**When** reviewed
**Then** it lists at least 3 representative Salla themes with pass/fail per layout and scenario

**Given** any matrix failure
**When** a player release is attempted
**Then** promotion to `stable` is blocked

### Story 5.13: Measure storefront impact on Core Web Vitals

As a Slips admin,
I want proof that Slips does not slow stores down,
So that we meet exit criterion E2 and the counter-metric.

**Requirements:** NFR13, NFR1

**Acceptance Criteria:**

**Given** a repeatable test
**When** run on at least 3 representative themes with and without Slips
**Then** it reports LCP, INP and CLS and fails if Slips worsens any versus baseline beyond measurement noise

**Given** a pilot store with merchant permission
**When** the same measurement is run
**Then** results are saved as a report used for E2 and the Core Web Vitals counter-metric

## Epic 6: Analytics, Attribution & Dashboard

The merchant sees trustworthy views, funnel, attributed orders and attributed revenue on the Overview and Analytics pages, computed with the FR13 rules.

### Story 6.1: Ingest player events into an append-only store

As a Slips developer,
I want the player to send batched events to `POST /v1/events` that land in one batched insert into `events_raw`,
So that analytics are built on complete, privacy-safe raw data.

**Requirements:** FR12, NFR4, NFR10, NFR14, AD-10

**Acceptance Criteria:**

**Given** a shopper interacts with Slips content
**When** the player records impression, view, quartile progress (25/50/75/100%), completion, slide advance, product click or add to cart
**Then** each event carries a UUIDv7 event ID, pseudonymous viewer ID, store locator, content item and timestamp, and is validated against the `contracts` event schema
**And** no share event exists in MVP.

**Given** a batch arrives
**When** it passes validation
**Then** it is appended to `events_raw` (created here, owned by `analytics`, monthly partitions on server `received_at`) in one batched insert with no queue fan-out
**And** invalid events in a batch are rejected individually with a reason code, valid ones are kept.

**Given** the page is being closed
**When** events are still buffered
**Then** they are flushed with `keepalive`/`sendBeacon`
**And** when the API returns 5xx or 429 with `Retry-After`, the client retries with jitter and drops oldest events once its bounded buffer is full.

**Given** any stored event or log line
**When** inspected by a fixture test
**Then** it contains no name, phone, email or address, and the IP is used only transiently and never stored (NFR4.a).

**Given** the partition maintenance job runs
**When** it executes daily
**Then** partitions exist 3 months ahead (alert if not) and partitions older than 13 months are dropped (NFR10).

**Given** a synthetic test at the event rate of 5,000 active stores
**When** the endpoint is exercised
**Then** P95 latency and error rate stay within NFR7 SLIs, and the result is recorded for the NFR14 load test.

### Story 6.2: Reject untrusted, duplicate and abusive events

As a merchant,
I want my numbers protected from fake and duplicated traffic,
So that I can trust them.

**Requirements:** FR26, NFR4, AD-10

**Acceptance Criteria:**

**Given** an event for an unknown locator or a key that is not active or retiring
**When** it reaches `POST /v1/events`
**Then** it is rejected and counted in an internal `events_rejected{reason}` metric.

**Given** an event whose `Origin` is not one of the store's synced storefront domains
**When** it arrives
**Then** it is rejected with reason `origin_mismatch`.

**Given** an event ID already received, or a UUIDv7 time outside the dedup window
**When** it arrives (including client retries)
**Then** it is dropped and not stored twice.

**Given** per-store and per-viewer rate limits
**When** a store or viewer exceeds them
**Then** the API returns 429 with `Retry-After` and the excess is not stored.

**Given** implausible activity (e.g. a viewer producing views faster than playback allows, or known bot user agents)
**When** the heuristics flag it
**Then** the events are marked excluded and never counted in rollups or attribution.

### Story 6.3: Store orders without shopper PII

As a Slips developer,
I want Salla order events mapped to a PII-free canonical `Order` and stored idempotently,
So that attribution has the order data it needs and shoppers' privacy is protected.

**Requirements:** FR13, NFR4, AD-5

**Acceptance Criteria:**

**Given** an order created, updated, cancelled or refunded webhook
**When** the handler processes it
**Then** the Salla adapter maps it to canonical `Order` and only that is persisted to `orders` and `order_lines` (created here, owned by `integration`): order ID, status, `placed_at`, timestamps, line items (product, qty, unit price, tax, discount, refunded amount), shipping, currency and `checkout_id`/cart tag.

**Given** the webhook route
**When** any request is handled
**Then** raw bodies are never persisted, enqueued or logged, body logging and error-payload capture are off, and any unavoidable shopper identifier is stored only as an HMAC with a key held outside the DB.

**Given** the same event delivered twice or out of order
**When** processed
**Then** the result is idempotent and an older event never overwrites newer order state (FR25).

**Given** the daily FR25 reconciliation
**When** it finds orders missed by webhooks
**Then** they are back-filled through the same mapping.

**Given** a fixture order containing name, phone, email and address
**When** it is ingested end to end
**Then** an automated test asserts none of those values appear in the DB, logs or error tracking.

### Story 6.4: Record confirmed Slips adds to cart and the thank-you beacon

As a Slips developer,
I want each Salla-confirmed add to cart from Slips recorded immediately with its cart ID,
So that orders can be joined to content reliably.

**Requirements:** FR12, FR13, FR26, AD-9

**Acceptance Criteria:**

**Given** a shopper taps the CTA in Slips content
**When** the `StorefrontPlatform` add-to-cart promise resolves successfully
**Then** the player sends `POST /v1/cart-adds` immediately with `keepalive`, never batched, containing cart ID, product, options hash, content item, viewer ID and timestamp
**And** a rejected or failed add sends nothing.

**Given** a valid cart-add request (same locator, origin and dedup checks as Story 6.2)
**When** accepted
**Then** it is stored in `cart_adds` (created here, owned by `attribution`); one viewer may have several cart IDs.

**Given** the shopper reaches the Salla thank-you page
**When** the injector sees the order confirmation
**Then** it posts the beacon (`page.id` = order ID, viewer ID, recent cart IDs) used as the fallback join when no cart ID matches a `checkout_id`.

**Given** a cart add arrives for a cart ID that already matches a stored order's `checkout_id`
**When** it is stored
**Then** an attribution recompute for that order is enqueued.

### Story 6.5: Attribute order lines with the FR13 rules

As a merchant,
I want orders credited to my content only under clear, conservative rules,
So that I see real revenue I can check against Salla.

**Requirements:** FR13, AD-9

**Data:** This story creates `store_settings_history` (owner `integration`), backfilled with one row per store holding the current window (default 7 days) effective from install time.

**Acceptance Criteria:**

**Given** an order event or enqueued recompute
**When** the attribution recompute runs
**Then** it derives the order's credited lines from `(cart_adds, current canonical order)` and replaces that order's rows in `attributed_lines` (created here) in one transaction.

**Given** join resolution
**When** any recorded cart ID equals the order `checkout_id`
**Then** that cart's adds are used; otherwise the thank-you beacon for that order ID is used; otherwise nothing is credited.

**Given** a line item whose product has a Slips add to cart within the window in force at `placed_at` (read from `store_settings_history`, default 7 days)
**When** credited
**Then** credit is for the full ordered quantity once, revenue is tax-exclusive, shipping is excluded, and order-level discounts are apportioned pro rata to pre-discount line value using largest-remainder rounding to the minor unit.

**Given** the same product added from several content items
**When** credited
**Then** the most recent add before `placed_at` wins, and each credited line links to exactly one content item.

**Given** a mixed order
**When** credited
**Then** untagged lines are ignored and the order is attributed if at least one line is credited.

**Given** an order placed after the window
**When** recomputed
**Then** no credit is given, while the add still counts in the funnel.

**Given** views or product clicks with no confirmed add
**When** recomputed
**Then** they never earn credit; only FR26-valid cart adds count.

**Given** the fixture suite
**When** tests run
**Then** every rule above, incl. a 15% VAT order and a 50 SAR order discount over two lines, passes with exact expected amounts, and per-content totals sum to the order total.

### Story 6.6: Reverse credit on cancellations, refunds and late data

As a merchant,
I want refunds, cancellations and late events reflected in my numbers,
So that they stay honest.

**Requirements:** FR13, AD-9

**Acceptance Criteria:**

**Given** a cancelled order
**When** recomputed
**Then** all its `attributed_lines` are removed and it no longer counts as attributed.

**Given** a partial refund of a credited line
**When** recomputed
**Then** the refunded tax-exclusive amount is subtracted; if nothing credited remains, the order stops counting as attributed.

**Given** the daily recheck job
**When** it runs
**Then** it recomputes every order with `placed_at` in the last 15 days, catching updates missed by webhooks.

**Given** the merchant changes the attribution window from 7 to 3 days
**When** later orders are recomputed
**Then** orders placed before the change keep the 7-day window and orders placed after use 3 days.

**Given** any recompute that changes an order's credit
**When** committed
**Then** the store-local day of its `placed_at` is marked dirty for re-roll.

**Given** the fixture suite
**When** tests run
**Then** cancel, full refund and partial refund cases pass with exact expected amounts.

### Story 6.7: Build daily rollups and the single metrics service

As a Slips developer,
I want one rollup pipeline and one `metrics` service that compute every metric per §1.5,
So that every screen shows the same numbers fast.

**Requirements:** FR14, FR15, NFR2, NFR10, AD-10

**Acceptance Criteria:**

**Given** events, cart adds and attributed lines
**When** the rollup job runs
**Then** it writes `daily_rollups` (created here, owned by `analytics`) per store, content item and store-local day: impressions, views (deduped once per item per viewer per 30 minutes), unique viewers, completions, product clicks, adds to cart, attributed orders and attributed revenue (summed only, never recomputed).

**Given** today
**When** 15 minutes pass
**Then** today is re-rolled with `final = false`; dirty days from Story 6.6 are re-rolled within the next run.

**Given** the `metrics` service
**When** any endpoint requests completion rate, CTR, funnel step rates or % change
**Then** the formulas come only from this service, "Engagement rate" never appears (always CTR), and % change returns null when the previous period is 0.

**Given** a 30-day range on a store with seeded high-volume data
**When** queried
**Then** the response is <= 2 s P95 and reads only rollup tables.

**Given** the consistency test
**When** run for any range
**Then** store totals equal the sum of per-content totals (unique viewers excepted, computed over the range).

### Story 6.8: Show attribution captions and the methodology page

As a merchant,
I want every attributed figure to tell me how it was counted,
So that I trust and can verify it.

**Requirements:** FR13, FR14, NFR5, UX-DR24, UX-DR39

**Acceptance Criteria:**

**Given** any attributed figure on any screen
**When** rendered
**Then** a muted caption shows the live window ("7-day window, add-to-cart only") and an info-text "How we count" link, and it is never hidden.

**Given** the merchant opens "How we count"
**When** the methodology page loads
**Then** it explains FR13 rules 1-9 in Arabic-first friendly-coach copy, incl. VAT excluded, shipping excluded, discount apportioning and refunds, in Arabic and English.

### Story 6.9: Overview dashboard with KPIs, 7-day chart and latest content

As a merchant,
I want a quick summary when I open Slips,
So that I see my results at a glance.

**Requirements:** FR15, NFR2, NFR5, NFR6, UX-DR8, UX-DR9, UX-DR22, UX-DR23, UX-DR37, UX-DR38, UX-DR42

**Acceptance Criteria:**

**Given** the Overview (`/`, per mockups/identity-studio-coral.html)
**When** it loads
**Then** four KPI tiles show Views, CTR, Product clicks and Attributed revenue with % change vs the previous 7 days, "—" when previous is 0, label tooltips with §1.5 definitions, and each links to its Analytics breakdown
**And** Attributed revenue is the single coral celebration tile, first in reading order, with its attribution caption.

**Given** the 7-day chart
**When** rendered in Arabic
**Then** the time axis runs right to left (oldest right), series use chart-1..5 order with legend and labels, and values use Western tabular digits with Arabic month names.

**Given** the latest content list
**When** filtered All/Published/Drafts
**Then** it shows title, last activity, views, CTR and status chip, the filter is in the URL, and "View all" opens the full list.

**Given** data is loading or a block fails
**When** rendered
**Then** boneyard skeletons appear after 150 ms (no spinners) and a failed block shows inline Retry while others keep working; the page is interactive <= 3 s on broadband.

**Given** a store with no content
**When** the Overview loads
**Then** a banner "Create your first story" with one action to the editor is shown, and zero metrics read "Numbers appear after your first view".

**Given** viewport width < 1024 px / < 640 px
**When** rendered
**Then** KPI tiles reflow to 2x2 / 1 column and the 8/4 grid stacks.

### Story 6.10: Analytics page with ranges, funnel and per-content table

As a merchant,
I want KPIs, a funnel and per-content results over any range,
So that I know what works.

**Requirements:** FR14, NFR2, NFR5, NFR6, UX-DR8, UX-DR11, UX-DR22, UX-DR23, UX-DR24, UX-DR37, UX-DR38

**Acceptance Criteria:**

**Given** the Analytics page
**When** it loads
**Then** four KPI tiles show Views, Unique viewers, Product clicks and Attributed orders with % change vs the equal previous period, and the range selector offers Last 7 days, Last 30 days, This month and custom (stored in the URL).

**Given** a custom range with end before start, or in the future
**When** applied
**Then** it is refused with an inline message and the previous range stays.

**Given** the funnel
**When** rendered
**Then** it shows views -> product clicks -> Slips adds to cart -> attributed orders with counts and step-to-step rates, labelled (not colour-only) and RTL-correct.

**Given** the per-content table
**When** rendered
**Then** each item shows views, completion rate, CTR and attributed revenue with header tooltips, sortable headers, and attributed revenue carries the caption.

**Given** a 30-day range
**When** loaded
**Then** all blocks return <= 2 s P95.

## Epic 7: Settings, Billing, Support, Admin & Launch Readiness

The merchant manages settings, plan and billing, previews the storefront, gets help, and finishes onboarding; Slips staff can look up a store; data rights, security and exit criteria are verified for launch. Non-development launch tasks L-1 to L-7 (Salla listing and review, pilot recruitment, legal documents, PDPL and external security review, support channel setup, demo snapshot, exit-criteria sign-off) are owned by the product owner/UX and tracked outside these stories; Stories 7.15 and 7.17 produce their inputs.

### Story 7.1: Settings connection and language tabs with explicit save

As a merchant,
I want to manage my Salla connection and dashboard language,
So that I stay in control of my store link.

**Requirements:** FR17, NFR5, UX-DR21, UX-DR39, UX-DR40

**Acceptance Criteria:**

**Given** Settings > Connection (per mockups/key-settings-injector.html)
**When** opened
**Then** it shows connection status chip, store name and URL (`<bdi>`), Reconnect and Disconnect.

**Given** the merchant clicks Disconnect
**When** a confirm dialog naming the store is accepted
**Then** the store moves to `disconnected` via `integration`, sync pauses, and the persistent danger banner appears on every page with Reconnect.

**Given** the merchant changes language Arabic/English
**When** saved
**Then** the choice persists to `store_settings` and the UI re-renders with matching `lang`/`dir`.

**Given** any edited settings form
**When** the merchant clicks Save
**Then** the toast "Changes saved" is announced; unsaved changes prompt before leaving; a failed save keeps the values and shows Retry.

### Story 7.2: Injector, display defaults and attribution window settings

As a merchant,
I want to see injector status, set default display options and my attribution window,
So that Slips fits my store.

**Requirements:** FR17, FR13, AD-9

**Acceptance Criteria:**

**Given** Settings > Injector
**When** opened
**Then** it shows live install detection (App Snippet seen or not) and the installation guide; the store key is shown in full with Copy only for the manual-snippet fallback.

**Given** the merchant regenerates the key and confirms
**When** done
**Then** a new key is issued, the storefront cache is purged via the AD-18 job, the old key keeps working for 7 days, and the merchant is told whether a snippet reinstall is needed.

**Given** default display options
**When** the merchant sets layout and position per page type and saves
**Then** they apply to new content and recompile the manifest.

**Given** the attribution window field
**When** the merchant enters 1-14 and saves
**Then** a row with effective time is appended to `store_settings_history`, captions update, and values 0, 15 or non-integers are refused inline.

### Story 7.3: Derive plan from Salla subscription events

As a merchant,
I want my plan to follow what I bought on Salla,
So that I can pay, upgrade and trial without extra steps.

**Requirements:** FR19, AD-14

**Acceptance Criteria:**

**Given** an `app.subscription.*` or `app.trial.*` event (start, renew, upgrade, downgrade, cancel, expire, trial)
**When** processed
**Then** `billing` compares it with the stored plan in `subscriptions` (created here) and derives the change; duplicates are idempotent and every change is logged with `trace_id`.

**Given** the reconciliation job
**When** it compares stored plans with the Salla subscriptions API
**Then** drift is corrected, but a live `manual_override` (with end date) is never replaced.

**Given** a free trial configured in Salla
**When** the trial event arrives
**Then** the store gets trial entitlements until trial end.

**Given** a store whose `store_type` is not `live`
**When** entitlements are requested
**Then** enforcement is skipped.

**Given** G5 fails or Q-04 is unresolved
**When** a plan must be set
**Then** plans, prices and limits load from config, and an admin can set `manual_override` (Story 7.10).

### Story 7.4: Enforce plan limits and show usage

As a merchant,
I want to see my usage and be told clearly when I hit a limit,
So that I know when to upgrade.

**Requirements:** FR19, AD-14, UX-DR18

**Acceptance Criteria:**

**Given** a publish or schedule request
**When** `content` checks `billing.getEntitlements(storeId)` under a per-store lock
**Then** it is refused if active items or placements would exceed the limit, with reason and an Upgrade action; concurrent publishes cannot both pass at the limit.

**Given** the storefront content API
**When** a manifest is compiled
**Then** only items admitted by `content` are served; `publishing` never trims.

**Given** the plan usage meter in Settings > Plan
**When** usage is 8 of 10
**Then** it shows "8 of 10" with the warning state at >= 80% and destructive at 100%; `usage_meters` (created here) stores current counts.

### Story 7.5: Deactivate over-limit content on downgrade or expiry

As a merchant,
I want my content kept safe when my plan shrinks,
So that I never lose work.

**Requirements:** FR19, AD-14, AD-19, UX-DR10, UX-DR18, UX-DR21

**Acceptance Criteria:**

**Given** a downgrade or expiry below current usage
**When** derived
**Then** a warning banner lists items that will be Deactivated and the grace end date.

**Given** the grace period ends
**When** the job runs
**Then** `content` sets over-limit items to Deactivated in the configured order (Q-04), never deletes them, and the manifest recompiles.

**Given** the merchant upgrades again
**When** entitlements allow
**Then** Deactivated items can be reactivated from the content list.

### Story 7.6: Store preview page

As a merchant,
I want to preview Stories and Reels on a simulated store,
So that I can see the result before going live.

**Requirements:** FR18, UX-DR7, UX-DR16

**Acceptance Criteria:**

**Given** "Preview store" in the top bar of any page
**When** clicked
**Then** the preview page opens with a Stories/Reels toggle rendered by the real player in preview mode with a mock storefront.

**Given** the preview
**When** the shopper-side "Order now" is tapped
**Then** cart success is simulated, and the note "Preview: no real cart or analytics" stays visible; no events or cart adds are sent.

**Given** no published content
**When** opened
**Then** sample content is shown with a link to create content; installation instructions are linked here and from Settings.

**Given** the preview fails to load
**When** detected
**Then** "Preview didn't load. Try again" with Retry is shown.

### Story 7.7: Support entry point

As a merchant,
I want help one click away,
So that I can get unstuck.

**Requirements:** FR20, UX-DR19

**Acceptance Criteria:**

**Given** "Need help? Contact support" on every dashboard page
**When** clicked
**Then** a Sheet opens from the end side with email and WhatsApp rows, hours Sun-Thu business hours (Asia/Riyadh) and "First reply within 1 business day", in Arabic and English.

**Given** the merchant picks a channel
**When** it opens externally in a new tab
**Then** the message/subject is prefilled with the store ID; contacts come from config (Q-10).

### Story 7.8: Onboarding checklist on first install

As a merchant,
I want a short checklist that ticks itself,
So that I know how to get my first content live.

**Requirements:** FR21, UX-DR17, UX-DR23

**Acceptance Criteria:**

**Given** a newly installed store
**When** the Overview loads
**Then** a checklist card shows store connected, products synced, injector detected, first content created, each done/not done from live state.

**Given** the card is visible
**When** the App Snippet is first seen
**Then** "Injector detected" ticks within 10 s (poll while visible only).

**Given** all four steps done
**When** rendered
**Then** it collapses to "Setup complete" and can be dismissed; dismissal persists.

### Story 7.9: Slips Admin sign-in, read-only role and audit log

As a Slips admin,
I want a separate staff sign-in with every access audited,
So that only Slips staff see store data.

**Requirements:** FR27, NFR6, AD-3

**Acceptance Criteria:**

**Given** the admin area
**When** a merchant session or anonymous user requests it
**Then** access is denied; only `admin_users` (created here) with separate internal sign-in and MFA get in.

**Given** an admin read
**When** it runs
**Then** it uses the read-only RLS-bypass DB role and writes a row to `admin_audit_log` (created here; actor, store, action, time), retained 2 years.

**Given** an admin mutation (e.g. manual plan override)
**When** performed
**Then** it calls the owning module's service in the store's context with an admin actor and is audited.

### Story 7.10: Slips Admin store lookup

As a Slips admin,
I want to look up a store and see its health and pilot status,
So that I can help pilot merchants quickly.

**Requirements:** FR27, FR19, AD-14

**Acceptance Criteria:**

**Given** a search by store name, URL or Salla ID
**When** submitted
**Then** matching stores list, and a store page shows lifecycle state, sync state and last sync, processing jobs and failures, plan and usage, and pilot status (published content count, attributed orders).

**Given** a store page
**When** the admin sets a `manual_override` plan with an end date
**Then** it is applied via `billing` and audited.

### Story 7.11: Cost metering and upload throttling

As a Slips admin,
I want storage and delivery metered per store and abusive uploads throttled,
So that costs stay within plan revenue.

**Requirements:** FR19, NFR14

**Acceptance Criteria:**

**Given** daily metering
**When** it runs
**Then** storage bytes and video delivery per store are written to `usage_meters` and shown in the admin store page.

**Given** a store uploading far above normal (configurable threshold)
**When** the threshold is crossed
**Then** further uploads are refused with a friendly message naming when they can retry.

### Story 7.12: Store data export and deletion on request

As a merchant,
I want my store's data exported or deleted when I ask,
So that I can trust Slips with my store.

**Requirements:** NFR4, AD-20

**Acceptance Criteria:**

**Given** an admin triggers export for a store
**When** the job in `store_data_jobs` (created here) runs
**Then** each module's `StoreDataLifecycle.export` produces machine-readable JSON (content, settings, products, aggregates, attribution, media links) downloadable once by the admin, audited.

**Given** a deletion request
**When** confirmed
**Then** the same orchestrated purge as uninstall runs immediately (Story 7.13).

### Story 7.13: Verify uninstall grace, restore and purge

As a Slips developer,
I want the uninstall lifecycle proven end to end,
So that retention promises hold.

**Requirements:** NFR4, NFR10, AD-20

**Acceptance Criteria:**

**Given** an uninstalled store within 30 days
**When** it reinstalls
**Then** the same `stores` row is restored with content and settings, and `install_epoch` increments.

**Given** 30 days pass
**When** the purge job runs
**Then** it is one resumable job with per-store lock, rechecks state and epoch, deletes every module's data incl. media in storage and CDN manifests, erases `events_raw` rows in throttled batches, and writes an audit record.

**Given** a purge interrupted midway or a reinstall during purge
**When** resumed
**Then** it completes idempotently or aborts on epoch change; stale-epoch work is dropped.

**Given** the verification test
**When** run after purge
**Then** no row with that `store_id` remains in any tenant table and CDN paths return 404.

### Story 7.14: Final internationalization and accessibility check

As a merchant,
I want the app to work well in Arabic and English,
So that it feels native.

**Requirements:** NFR5, NFR6, UX-DR36, UX-DR37, UX-DR39, UX-DR40

**Acceptance Criteria:**

**Given** a lint for hard-coded strings and physical CSS properties
**When** CI runs
**Then** none remain in dashboard or player.

**Given** key flows (install, create, publish, analytics, settings, viewer)
**When** checked in RTL and LTR with axe and keyboard
**Then** mixed-direction text, currency, focus, 4.5:1/3:1 contrast in light and dark, alt text and reduced motion pass WCAG 2.1 AA (player AA except captions).

### Story 7.15: Security test suite

As a Slips developer,
I want automated security checks before launch,
So that we meet Salla's expectations and E5.

**Requirements:** NFR4, AD-3, AD-5, AD-22

**Acceptance Criteria:**

**Given** the suite
**When** CI runs
**Then** tenant isolation (cross-tenant test per tenant table), upload, SSRF, XSS, webhook verification and event-spoofing tests pass.

**Given** seeded traffic
**When** the PII check runs
**Then** no shopper PII appears in `events_raw`, `orders`, `order_lines`, logs or error tracking.

**Given** findings from the external review (L-4)
**When** tracked
**Then** each has an owner and status, and the report shows zero open critical/high.

### Story 7.16: Peak-load test

As a Slips developer,
I want proof the storefront survives seasonal peaks,
So that a sale day does not break stores.

**Requirements:** NFR14, NFR2, AD-10, AD-22

**Acceptance Criteria:**

**Given** 1,000 active stores at 10x normal traffic (Ramadan, White Friday, National Day profile)
**When** the load test runs on content API, `/v1/events` and `/v1/cart-adds`
**Then** NFR2 and NFR7 targets hold, queue depth/age alerts fire correctly, and degraded mode keeps manifests serving during a simulated Salla outage.

**Given** results
**When** complete
**Then** limits found and the AD-10 direct-insert revisit decision are recorded before launch.

### Story 7.17: Attribution reconciler and exit-criteria report

As a Slips admin,
I want an independent reconciliation and one exit-criteria report,
So that the product owner can sign off launch (L-7).

**Requirements:** FR13, FR27, AD-9

**Acceptance Criteria:**

**Given** a pilot store
**When** the `admin` reconciler runs (independent of `attribution`, reading orders via `CommercePlatform`, sharing only fixtures)
**Then** a `reconciliation_runs` row (created here) records Slips vs recomputed attributed orders and revenue and passes when within +/-3% (E3).

**Given** the report
**When** generated
**Then** it shows E1 listing status, E2 budget and zero CLS on >= 3 themes with Core Web Vitals comparison, E3 per store, E4 10 pilot merchants live each with published content and >= 1 attributed order, E5 security status, and the 30-day uninstall rate.
