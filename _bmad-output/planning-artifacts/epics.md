---
status: draft
stepsCompleted: [1]
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

{{requirements_coverage_map}}

## Epic List

{{epics_list}}

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic {{N}}: {{epic_title_N}}

{{epic_goal_N}}

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story {{N}}.{{M}}: {{story_title_N_M}}

As a {{user_type}},
I want {{capability}},
So that {{value_benefit}}.

**Acceptance Criteria:**

<!-- for each AC on this story -->

**Given** {{precondition}}
**When** {{action}}
**Then** {{expected_outcome}}
**And** {{additional_criteria}}

<!-- End story repeat -->
