# Reconciliation Review: Inputs vs ARCHITECTURE-SPINE.md

**Spine:** `ARCHITECTURE-SPINE.md` (draft, 2026-10-10)
**Inputs:** `docs/prd.md` v0.3, `docs/prd-addendum.md` §A-§C, `docs/salla-desk-research.md`, `docs/tech-stack.md`
**Date:** 2026-10-10
**Lens:** only gaps that need an architecture-level decision, meaning an invariant that two separately built stories could get wrong in incompatible ways. Story-level detail is left out.

Severity:
- **critical:** stories will diverge or the product will break in production. Fix before any Epic 2-7 story is sharded.
- **high:** a cross-story invariant is missing, or a hard PRD bound has no owner in the spine.
- **medium:** a convention is missing, so stories will each invent their own.
- **low:** wording, a deviation that is not recorded, or a small clarification.

---

## Summary: top gaps

| # | Gap | Input | Severity | Suggested fix |
|---|---|---|---|---|
| 1 | The embedded dashboard runs in a cross-site iframe, so the AD-12 `SameSite=Lax` session cookie will not be sent. | Salla research G8 | critical | AD-12 amendment |
| 2 | How the stub maps Salla `store.id` to the "store public ID" or injector key is undefined, and key regeneration has no defined meaning. | Salla research G1, PRD FR9/FR17, B.7 | critical | New AD "Storefront identity and key rotation" |
| 3 | AD-13 (store every webhook in `webhook_inbox`) conflicts with AD-5 (reduce the body before persisting). The inbox would hold raw order PII. | PRD NFR4.b, B.11 | critical | AD-5/AD-13 amendment |
| 4 | No store lifecycle state machine, so uninstall, the 30-day grace period, reinstall and purge have no defined cascade across modules, storage, CDN and backups. Export has no owner either. | PRD FR2, NFR4.e, NFR10, Story 7.9 | critical | New AD "Store lifecycle, data deletion and export" |
| 5 | No numeric freshness budget, CDN TTL or purge-failure rule for the manifest. The FR24 bounds (1 min and 2 min P95) have no owner. | PRD FR24, B.8 | high | AD-6 amendment |
| 6 | Preview reuse of the real player is mentioned only in the capability map. There is no rule for the preview manifest, the mock platform adapter or event suppression. | PRD FR7/FR18, B.5 | high | New AD "Preview mode" |
| 7 | No outbound Salla rate-limit pacing and no single-flight token refresh. Salla refresh tokens are single-use, so a race between two refreshes disconnects the store. | Salla research, FR25, B.9 | high | New AD "CommercePlatform outbound discipline" |
| 8 | Retention for each data class is defined only for `events_raw`. | PRD NFR10 | high | Retention table convention |
| 9 | Event ingestion writes synchronously to Postgres, but B.3 asked for a queue. The deviation is not recorded, and the rate-limit state store and the dedup window are not defined. | B.3, B.10, FR26 | high | AD-10 amendment |
| 10 | No Shadow DOM font or custom-property contract, no global-name contract, and no guard against double boot. | B.6, Story 5.1 AC3, tech-stack | medium | AD-7 amendment |

---

## 1. `docs/prd.md` (FRs, NFRs, stories, gate G1-G8)

### 1.1 [critical] Store lifecycle, uninstall, grace period, reinstall, purge and export
- **Input:** FR2, FR25 (Disconnected, reinstall restores), NFR4.e, NFR10 (30-day grace period, then permanent deletion that includes media in storage and the CDN), Stories 2.5 AC3 and 7.9 AC1/AC3, and the Salla app review (uninstall cleanup is reviewed at submission).
- **Spine today:** AD-6 lists "app uninstalled" as a recompile trigger. The capability map says "uninstall jobs". AD-2 gives every module its own tables. There is no lifecycle model.
- **Why it is architectural:**
  - Nine modules own tables.
  - Deletion and export each need a contribution from every module.
  - "Disconnected", "uninstalled" and "suspended billing" each change what sync, publishing, billing, ingestion and attribution do.
  - Without one state model, each epic will check something different, for example a status column, the token's existence or an installation row.
- **Suggested AD, "Store lifecycle and data rights":**
  - `integration` owns `stores.lifecycle_state` with the values `active | disconnected | uninstalled_grace | purging | purged`. It emits `integration.store.<state>` events.
  - Each module subscribes to these events and declares what it does in each state:
    - sync pauses when the store is `disconnected`
    - the manifest is emptied in `uninstalled_grace`
    - event ingestion rejects writes for the store
    - billing stops
  - Each module implements a `StoreDataPort` with `export(storeId)` and `purge(storeId)`. The `admin` module orchestrates a purge job, and the job is idempotent and resumable.
  - Media and manifests are deleted through the `ObjectStorage` and `CdnPurger` ports.
  - Backups age out on their own 35-day cycle. Record that a purge is complete only once backups have expired.
  - Reinstall restores from the grace state. It must not create a new store row. `(platform, external_id)` is the reinstall key.

### 1.2 [critical] Storefront identity and injector-key regeneration overlap
- **Input:** FR9, FR17 (the old key keeps working for an overlap period marked [TBD: Architect]), Story 7.1b AC2, NFR3, and AD-7 (the stub reads `store.id`).
- **Spine today:**
  - The ID convention defines a "store public ID" as a separate column.
  - AD-6 serves the manifest "keyed by the store's public ID".
  - AD-7's stub reads `store.id` from `salla.config`.
  - AD-6 lists "injector key regenerated" as a purge trigger.
  - None of these says what the key is or how the stub learns it.
- **Why it is architectural:** Story 1.3 (creating the store row), Story 5.1 (loader), Story 6.1b (event validation), Story 7.1b (regeneration) and the CDN path layout all depend on one answer. If the stub uses the Salla `store.id` and the manifest uses a Slips public ID, nothing loads.
- **Suggested AD:** pick one of these and record it.
  - **(a) Use the Salla store ID.** The manifest path and the event key are derived from `(platform, salla store.id)`. "Regenerate" changes only the per-store random suffix that the stub reads from a public App Setting (`salla.config.get('app.slips_key')`), which Slips pushes via the settings API.
  - **(b) Drop merchant-visible regeneration from the MVP** (as the research's implication 1 suggests). Record the PRD change.
  - Either way, fix these rules:
    - Overlap period: for example 24 hours. During it, both keys resolve to the same manifest, and `store_keys` holds rows with `valid_until`.
    - Event validation accepts any non-expired key.
    - CDN paths use the key, never a DB row ID.

### 1.3 [critical] Webhook inbox vs PII minimisation
- **Input:** NFR4.b, Story 6.2a AC2, Story 7.5 AC2 ("no shopper PII in ... order records or logs").
- **Spine today:** AD-13 stores "each webhook" in `webhook_inbox`. AD-5 says raw bodies are "reduced to that canonical form before they are enqueued or persisted".
- **Why it is architectural:** the person building the inbox (Story 1.4) and the person building order ingestion (Story 6.2a) will disagree about what the inbox row holds.
- **Suggested amendment:**
  - The inbox stores the event ID, type, the store's external ID, the source `updated_at`, the body hash and the **canonical (PII-free) payload** produced by the adapter's mapper at receive time.
  - The raw body is never persisted.
  - Set a retention for inbox rows, for example 30 days.
  - Error tracking and log serializers redact request bodies on the webhook route.

### 1.4 [high] Freshness bounds have no numeric owner
- **Input:**
  - FR24: publish, unpublish, archive and schedule changes appear within 1 minute; price and stock within 2 minutes at P95.
  - Stories 3.6 AC2, 4.3 AC2 and 4.4.
  - NFR7: CDN invalidation within 1 minute.
- **Spine today:** AD-6 lists the triggers but sets no budget, TTL, compile coalescing or purge-failure behaviour.
- **Suggested amendment to AD-6:**
  - End-to-end budget: trigger, then compile (≤ 20 s), then upload, then purge (≤ 20 s), measured from the domain event.
  - CDN `Cache-Control` for the manifest is `max-age=60, stale-while-revalidate=<n>`, so a failed purge still converges within 60 s.
  - Concurrent triggers for a store are debounced or coalesced per store using a pg-boss singleton key.
  - Schedule-boundary jobs are enqueued with `startAfter` = boundary time. When a schedule is edited, its jobs are re-planned.
  - `publishing.manifest.compiled` records the trigger timestamp, so the FR24 P95 can be measured (an alert, plus the Story 4.4 AC3 test).

### 1.5 [high] Manifest size budget and shape
- **Input:** NFR1 (the stub fetches the manifest before first render), FR30 (cap of 10 items per placement), and product-targeted placements (one target ID each).
- **Spine today:** there is one manifest per store, with no size bound and no per-page splitting.
- **Why it is architectural:** a store with hundreds of product-targeted items produces a large manifest on every page view. The player build (Epic 5) and the compiler (Epic 4) must agree on the shape.
- **Suggested convention:**
  - Set a manifest gzip cap, for example ≤ 15 KB, enforced at compile time.
  - Above the cap, split into an index manifest (home and category entries plus a product-ID bloom or list) and per-product shards at `/m/<key>/p/<productId>.json`, purged by the same rules.
  - Media URLs in the manifest are immutable and content-hashed.

### 1.6 [high] Retention for each data class
- **Input:** NFR4.d and NFR10.
  - Raw events: 13 months.
  - Daily aggregates, orders and attribution: kept while installed, plus 30 days.
  - Application logs: 30 days.
  - Backups: 35 days.
  - Also needed: `webhook_inbox`, `cart_adds`, `admin_audit_log` and pg-boss archive tables.
- **Spine today:** only AD-10 covers retention, and only for `events_raw` partitions.
- **Suggested convention:**
  - Add a "Retention" column to the ERD ownership map, so every table declares its retention class.
  - Add one `admin.retention.sweep` job (or a per-module job with the same contract).
  - Configure pg-boss `archiveCompletedAfterSeconds` and `deleteAfterDays` explicitly, because job payloads may carry tenant data.

### 1.7 [high] Attribution-window semantics contradict the PRD
- **Input:** FR13 rule 3 and Story 6.2c AC3: a changed window applies to **orders placed after the change**.
- **Spine today:** AD-9 records "the window in force" on each cart add, which is add-time semantics.
- **Why it matters:** two implementations produce different credited revenue, and E3 depends on the number.
- **Suggested fix to AD-9:**
  - Keep an `attribution_settings_history` table with columns `(store_id, window_days, effective_from)`.
  - The recompute uses the window effective at the order's `created_at`.
  - Drop the per-cart-add window, or keep it only for display.

### 1.8 [high] Independent reconciliation for E3
- **Input:** E3 (±3% against an independent recomputation from Salla order data) and Story 7.6 AC1.
- **Spine today:** AD-13 covers "daily reconciliation" for sync gaps. There is nothing on the E3 recomputation.
- **Suggested AD note:**
  - The E3 reconciler lives in `admin` (or `analytics`).
  - It reads orders through `CommercePlatform` directly, not from the `orders` table.
  - It applies a separately coded, test-vector-shared FR13 rule set. A shared fixture suite must hold for both implementations.
  - If it called `attribution`, the check would be circular (the same objection as addendum C.1).

### 1.9 [medium] Money rounding for apportionment
- **Input:** FR13 rule 2 (VAT excluded, discounts apportioned proportionally) and the consistency rule that per-content revenue sums to the total.
- **Suggested convention:** apportion in halalas using the largest-remainder method. Compute it once, in `attribution` only, and store it on `attributed_lines`. Rollups only sum.

### 1.10 [medium] Metric definitions have one home
- **Input:** Story 6.5 AC1 ("shared definitions used by every screen") and the §1.5 view rule (once per item per viewer per 30 minutes).
- **Suggested convention:**
  - View dedup and metric formulas are computed in `analytics` rollups only. The client never pre-dedups.
  - Ratios such as CTR and completion rate are computed from rollup counts in one `metrics` service that every dashboard endpoint uses.
  - Day buckets use the store time zone.

### 1.11 [medium] Values marked "[TBD: Architect]" are still unset
- Media and sync retry count and backoff (NFR12, Story 2.1 AC3).
- Session inactivity timeout (FR28, Story 1.3 AC4).
- Caps for each on-demand player module (NFR1, Story 1.2 AC2).
- Key overlap period (FR17).
- **Suggested convention:**
  - One default pg-boss retry policy, for example 5 attempts with exponential backoff from 30 s and a cap of 15 min, overridable per queue in a single file.
  - Session idle timeout: 12 h for merchants and 30 min for admin.
  - Size caps in KB gzip: viewer ≤ 25, analytics batcher ≤ 5.

### 1.12 [medium] Upload safety gate
- **Input:** NFR3 (content-type sniffing, EXIF and GPS stripping, SVG rejection, malware scan before publish, SSRF in external-link fetching) and Stories 3.3 AC2-AC4.
- **Spine today:** AD-15 covers renditions only.
- **Suggested amendment to AD-15:**
  - `media_assets.state` is `uploaded → scanned → processed | failed`.
  - `content` may publish only assets in `processed`, which implies `scanned`.
  - External URL fetch runs only in the worker, through one SSRF-safe fetcher (deny private IP ranges, re-resolve DNS, cap redirects and size).
  - Pre-signed URLs are store-scoped, have content-length limits and expire in 15 minutes or less.

### 1.13 [medium] Player loader versioning and rollout
- **Input:** NFR8 (versioned injector with gradual rollout and rollback).
- **Spine today:** AD-7 says "versioned loader" but does not say who picks the version.
- **Suggested convention:**
  - The stub fetches a small, short-TTL pointer file (`/loader/channel.json`, or the version inside the manifest).
  - That file maps stores to a version by percentage cohort using a hash of the store ID.
  - Loader bundles are immutable and content-hashed.
  - Rollback means changing the pointer and purging it.

### 1.14 [medium] Storefront failure budget
- **Input:** NFR1 "API timeout" scenario, FR10, Story 5.1 AC2.
- **Suggested convention:**
  - Manifest fetch timeout: for example 3 s. On timeout, abort silently.
  - A failed stub or loader never throws to `window.onerror`.
  - No retry before first render.

### 1.15 [medium] RTL and accessibility in the player
- **Input:** FR10, NFR5, NFR6, Stories 5.2b and 7.4.
- **Spine today:** the i18n convention covers logical CSS only. It does not say where direction comes from or how the focus trap and scroll lock work for an overlay mounted on `document.body`.
- **Suggested convention:**
  - `StorefrontPlatform.getLocale()` returns `{lang, dir}` from `salla.config` `user.language_code`, falling back to `document.documentElement.lang/dir`. Every player root sets `dir` on its shadow host.
  - Merchant text is rendered with `dir="auto"`.
  - The viewer overlay uses `inert` on siblings (with a fallback), body scroll lock that restores the scroll position, and focus return to the opener. The pause control is always present.

### 1.16 [medium] Consent seam
- **Input:** NFR4.c and Q-18 (deferred in the spine, which is fine).
- **Gap:** no seam is fixed. Without one, every event call site may need changes later.
- **Suggested convention:**
  - All player telemetry goes through one `track()` that consults `StorefrontPlatform.getConsent()`, which returns `accepted | rejected | unknown`.
  - The policy for each state is one config value in the loader.
  - The viewer ID is created lazily, only when the policy allows it.

### 1.17 [medium] Trace propagation across the queue
- **Input:** Story 1.7 AC3 (one trace ID across API and background jobs).
- **Suggested convention:** every job-payload contract carries `trace_id`, and so does `store_id`. The enqueue helper injects both, and the worker logger binds them.

### 1.18 [low] Dashboard CSP and framing
- **Input:** NFR3 (OWASP).
- **Suggested convention:**
  - `frame-ancestors https://s.salla.sa` for the merchant app.
  - `frame-ancestors 'none'` for `/admin`.
  - A strict CSP with nonces.
  - The preview iframe is same-origin and sandboxed.

### 1.19 [low] CTA link allow-list enforced at two points
- **Input:** FR4 (only links on the store's own domain).
- **Suggested convention:** validate the link at content save and again at manifest compile, against the store's synced domain list. The player renders only `https:` URLs taken from the manifest.

---

## 2. `docs/prd-addendum.md` §B (architect notes B.1-B.12) and §A/§C

| Note | Status in spine | Gap | Severity | Suggestion |
|---|---|---|---|---|
| B.1 Layout shift | Landed as AD-8 (options 2 and 4) | The "API timeout" scenario needs a timeout value, and the CLS rule needs it. | medium | Add the 3 s abort to AD-8 (see 1.14). |
| B.2 Byte budget | Mostly landed in AD-7 | The cap for each on-demand module is not set. The CSP-driven origin policy is missing (see below). | medium | Fix the KB caps in AD-7. |
| B.2 Merchant CSP | **Not landed** | The number of origins the player touches is not fixed. Each new origin is a new CSP risk on stores that use `connect-src`/`media-src`. | high | Convention: the player uses at most two origins, one CDN origin (manifest, loader, media) and one API origin (events, cart confirm). No third-party origins. Record a fallback if a store blocks them (G1). |
| B.3 Analytics through a queue | **Deviation not recorded** | AD-10 appends synchronously to `events_raw`. B.3 says "through a queue, not written synchronously". At 10× peak (NFR14), the HTTP pods write directly to Postgres. | high | Record the deviation and why (one bulk `INSERT ... ON CONFLICT DO NOTHING` per batch is cheaper than enqueuing). Name the back-pressure rule: return 503 with `Retry-After`, and the client retries per Story 6.1a. |
| B.4 Tenant isolation | Landed in AD-3 | Under RLS, `analytics` rollups (cross-owner joins) and the E3 reconciler need to run either per store or under a named role. That is not said. | medium | Rollups run one job per store with the store context set. Only `admin` bypasses RLS. |
| B.5 Previews reuse the real player | **Only in the capability map** | No rule that the preview uses the production loader build, compiles a preview manifest from draft content with the same compiler, injects a mock `StorefrontPlatform`, and suppresses events. Stories 3.5 and 7.3 and the player could each build a different preview. | high | New AD "Preview mode": `packages/player` exports `mountPreview(manifest, {platform: MockPlatform})`; `publishing` exposes a pure `compileManifest(input)` that is used for both the live and the draft manifest; the dashboard hosts it in a same-origin sandboxed iframe; `track()` is a no-op in preview. |
| B.6 Shadow DOM fonts and custom properties | **Not landed** | No rule that player fonts use the system stack or a light-DOM `@font-face`. No stable `--slips-*` custom-property API for FR-INJ-08. No rule that the viewer overlay gets its own shadow root. | medium | Add to AD-7: system font stack only in the MVP. Publish a documented `--slips-*` token list (colour, radius, font family) that is read inside the shadow root with defaults. Overlay and inline roots are separate hosts. |
| B.6 Focus trap and scroll lock | **Not landed** | B.6 asks the architect to decide. | medium | See 1.15. |
| B.7 Key overlap and regeneration | **Not landed** | No overlap rule and no mapping from key to store. | critical | See 1.2. |
| B.7 Short-lived signed tokens | Not mentioned | Optional per B.7. | low | Record it as a deferred option in the Deferred section. |
| B.8 Freshness budget | Triggers landed; **budget not landed** | See 1.4. | high | AD-6 amendment. |
| B.8 Queue and CDN purge capabilities | Landed (pg-boss, `CdnPurger`) | none | none | none |
| B.9 Single-flight token refresh | **Not landed** | No lock mechanism. Workers and HTTP can both refresh. | high | See 3.3. |
| B.9 Order updates re-run attribution | Landed in AD-9 | none | none | none |
| B.10 Dedup window and plausibility | Partly landed | The dedup window length and the store for rate-limit counters are not named (there is no Redis). Plausibility heuristics and the internal "rejected events" metric have no home. | medium | Dedup is a unique index on `(store_id, event_id)` in the current partition, which makes the dedup window the partition. Rate limits use a per-pod token bucket plus a Postgres `UNLOGGED` counter table (or edge rate limiting at the CDN/WAF). Heuristics run as a rollup-time filter, not on the hot path. |
| B.11 Salted hash | Landed (AD-5 HMAC) | none | none | none |
| B.12 Admin location | Landed (route group) | none | none | none |
| A / C.9 Managed video service vs custom transcoding | **Conflict** | Addendum A and C.9 reject a custom transcoding pipeline. The spine's Deferred section keeps "container workers that can run ffmpeg" open, and the MP4-only rendition choice limits which managed services fit. | medium | Record it as an explicit deviation or keep it out. State that `MediaProcessor` adapters must be managed services unless Q-05 rules them all out. |
| C.5 No hotlinking | Not explicit | — | low | Covered by the 1.12 SSRF-fetch convention. |

---

## 3. `docs/salla-desk-research.md`

### 3.1 [critical] The embedded-app session cookie is cross-site
- **Finding:** the merchant dashboard runs in an iframe at `s.salla.sa/embedded/app/...`. Identity comes from token introspection (G8).
- **Spine today:** AD-12 issues a `SameSite=Lax` httpOnly cookie. In a cross-site iframe, browsers do not send a `Lax` cookie on subresource and fetch requests, and Safari's ITP blocks third-party cookies outright. Every API call from the embedded dashboard would be unauthenticated.
- **Suggested fix to AD-12:** choose one of these.
  - (a) A `SameSite=None; Secure; Partitioned` (CHIPS) cookie, with a token fallback.
  - (b) An in-memory bearer token minted after introspection and re-minted via `embedded.auth.getToken()` on 401. Cookies are used only on the standalone OAuth path.
- Also fix CSRF protection for whichever option is chosen.

### 3.2 [critical] How the stub identifies the store
- **Finding:** the snippet is one static file for all stores. Identity comes at runtime from `store.id` or a public App Setting. `store.domain` is forbidden.
- **Gap:** see 1.2. The spine must name the exact lookup key the stub uses and how the key reaches the browser.

### 3.3 [high] Outbound Salla API discipline
- **Findings:**
  - Leaky-bucket limits per store: Plus 120/min, Pro 360/min, Special 720/min. A 429 response carries `Retry-After`.
  - Refresh tokens are **single-use**.
  - `app.updated` triggers a new `app.store.authorize`.
  - Easy Mode delivers tokens by webhook.
- **Spine today:** nothing on pacing. AD-12 says "OAuth fallback", but the install path (Easy Mode via webhook) is not stated.
- **Why it is architectural:** initial sync (Epic 2), daily reconciliation (Stories 2.4 and 6.2a), subscription reconciliation (AD-14), Order Tag write-back and the E3 reconciler all share one per-store budget.
- **Suggested AD, "CommercePlatform outbound discipline":**
  - The Salla adapter owns a per-store token bucket, persisted in Postgres or held in a per-store pg-boss singleton queue.
  - It enforces a priority order: webhook follow-ups first, then user-triggered sync, then reconciliation.
  - It honours `Retry-After`.
  - Token refresh runs under a Postgres advisory lock on `store_id`. The refreshed pair is persisted in the same transaction. On failure, the store moves to `disconnected` (see 1.1).
  - Tokens from `app.store.authorize` always replace the stored pair, with an `updated_at` guard.

### 3.4 [high] Cart-ID join fragility
- **Finding:** on a non-422 error, the SDK resets the cart and retries. On `product.single` for the same product, `addItem` validates the page's options form. `checkout_id` "equals cart_id" only according to a type comment.
- **Spine today:** AD-9 joins on cart ID, which assumes a store has one cart ID per viewer.
- **Suggested amendment to AD-9 and AD-4:**
  - `StorefrontPlatform.addToCart` returns `{ok, cartId, error}` from the confirmed response and always records the cart ID **returned by that add**.
  - Attribution matches any `cart_adds.cart_id` equal to the order's `checkout_id`, so several cart IDs per viewer are allowed.
  - The adapter uses `quickAdd` when the target product equals the page product, to avoid the page-form validation.
  - Treat the join key as a G4 result. The thank-you beacon contract (`page.slug === 'thank-you'`, `page.id`) is a named fallback in `contracts`.

### 3.5 [medium] Canonical page context
- **Finding:** `page.slug` values for home and category are undocumented, and the category ID is not in `page.id`.
- **Gap:** manifest eligibility (FR9) matches on page type and target ID, but `contracts` defines no canonical `PageContext`.
- **Suggested convention:**
  - `contracts: PageContext = {pageType: 'home'|'category'|'product'|'other', targetId?: string, lang, dir}`.
  - Only the Salla `StorefrontPlatform` adapter maps slugs, URLs and markup to it.
  - The compiler and the player match only on `PageContext`.

### 3.6 [medium] Early SDK events and the stub/loader split
- **Finding:** `cart::*` listeners must be registered at the top level, because some events fire before `salla.onReady`.
- **Gap:** AD-7 lazy-loads the loader. Cart and thank-you events that fire before it arrives are lost.
- **Suggested convention:** the stub registers the needed `salla.event` listeners at once and buffers them in a bounded queue (for example 20 entries). The loader drains the queue. The stub's responsibilities are listed and size-capped (for example ≤ 2 KB).

### 3.7 [medium] Webhook resolution before tenant context
- **Finding:** the store is identified by the top-level `payload.merchant`. App events auto-deliver, store events need a subscription, and the endpoint must answer within ~30 s, with only 3 retries over ~15 min.
- **Suggested amendment to AD-13:**
  - The inbox write resolves `merchant` to `store_id` before the RLS context exists. An insert-only role is allowed for that purpose.
  - Webhooks for unknown or uninstalled stores are stored and dropped, so Salla does not see 404s and retry.
  - The webhook subscription set is declared in code (one list) and is the minimum needed for the review.

### 3.8 [medium] Consent signal source
- **Finding:** `salla.storage.get('cookies-consent')` and the `salla-cookies-bar::*` events apply only when `store.features` includes `website-cookies`.
- **Suggested convention:** the seam described in 1.16. Only the Salla adapter reads these values.

### 3.9 [low] Order Tag write-back and OAuth scopes
- **Finding:** Order Tags need the `orders.read_write` scope, and app review demands minimum scopes.
- **Suggested convention:** write-back is optional. If it is adopted, it is an `attribution` side effect through `CommercePlatform`. Record the scope list in one place.

### 3.10 [low] Distribution of the stub
- **Finding:** snippet edits redeploy to every store and live in the Partners Portal.
- **Suggested convention:** the stub source lives in `packages/player/stub`. It is built and checked in CI (`node --check`, no `customer.*` or `store.domain`), and is pasted into the Portal only through a documented release step.

---

## 4. `docs/tech-stack.md`

| Item | Gap | Severity | Suggestion |
|---|---|---|---|
| Web Component `<slips-player>` with Shadow DOM | AD-7 says "renders inside Shadow DOM" but does not fix the custom-element name. It also does not cover the "one documented global" rule (Story 5.1 AC3) or a guard against double registration. A manual-paste fallback combined with the App Snippet would boot twice. | medium | Add to AD-7: custom elements are `slips-player` (inline) and `slips-viewer` (overlay), defined only if not already defined. The single global is `window.__slips`, set once, and a second boot exits. |
| drizzle-zod "to generate Zod schemas shared with the dashboard" | AD-11 deliberately keeps drizzle-zod internal and hand-writes `contracts`. That is a deviation from the stack file, and the stack file says deviations must be recorded with a reason. | low | Add a one-line deviation note to AD-11: contracts are decoupled from the DB shape on purpose. |
| Managed video service (via addendum §A) | The spine leaves ffmpeg workers open. See the §2 row on A / C.9. | medium | Record the deviation or restrict it. |
| Open decision "background jobs/queues (webhooks, analytics events)" | Webhooks go through pg-boss, but analytics events do not (see the §2 row on B.3). | high | Record the decision in AD-10. |
| Player built with Vite library mode | Two artifacts (stub and loader) plus lazy chunks. Content hashing and the immutable-URL rule are not stated. | low | Covered by 1.13. |
| "TanStack Query hooks generated per contract" (AD-11) | The generator is not named, so stories may hand-write hooks. | low | Name the approach: a small codegen script from the contract registry, or a typed `defineEndpoint` helper. |
