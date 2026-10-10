# Slips PRD Addendum

**Companion to:** `docs/prd.md` v0.2 (10 Oct 2026)
**Purpose:** holds technical detail moved out of the PRD, notes for the architect, and alternatives that were considered and rejected. The PRD states *what* the product must do; this file records *how we currently think* it could be done and *why* some options were dropped. Nothing here overrides the PRD. The chosen stack is in `docs/tech-stack.md`; where this file and `tech-stack.md` differ, `tech-stack.md` is the default and the architect records any deviation.

---

## A. Technical detail moved from PRD v0.1 §4

These were "Technical Assumptions" in PRD v0.1. They are inputs for the architect, not requirements.

- **Repository:** monorepo (Turborepo) with `apps/dashboard` (Next.js), `apps/api` (NestJS), `packages/player` (Preact, built with Vite library mode) and shared packages (DB schema, Zod schemas, types). See `tech-stack.md`.
- **Language:** TypeScript end to end.
- **Data:** PostgreSQL with Drizzle ORM for application data. Analytics starts in Postgres (partitioned tables plus rollups, see §B.3), with a columnar store (for example ClickHouse) only if needed later.
- **Background work:** a queue for media processing, product/order sync, reconciliation, schedule boundaries and event ingestion. The queue technology is an open architecture decision (`tech-stack.md`, "Open decisions").
- **Video:** use a managed video service (candidates in v0.1: Mux or Cloudflare Stream) rather than building a transcoding pipeline. The choice is blocked by data residency (PRD Q-05) and by cost per minute stored/delivered (PRD NFR11, Q-04).
- **Media delivery:** object storage plus CDN for uploads, renditions, posters and the player bundle.
- **Salla integration:** OAuth, webhooks, product and order APIs, theme/snippet injection, app billing. All of it is verified at the Epic 1 gate (PRD §6, gate table G1-G8).
- **Testing:** unit and integration tests; automated tests for attribution rules (PRD FR13), tenant isolation, webhook idempotency and event integrity; browser tests (for example Playwright) for key flows, the layout-shift check and the player size budget.
- **Hosting:** managed cloud; region blocked by Q-05. Until Q-05 closes, staging holds only test-store or synthetic data (PRD Story 1.1).
- **Removed reasoning:** v0.1 justified Next.js with "the demo is Vercel-hosted". That is not a reason for a stack choice and was dropped; the stack comes from `tech-stack.md`.

---

## B. Notes for the architect

### B.1 Layout shift: showing content only when eligible without shifting the page (review C5)

**The conflict.** The PRD requires (NFR1) that Slips causes no layout shift where content is shown, and reserves no space when no content is eligible, the API fails or the key is invalid. The player cannot know whether there is eligible content until the content API answers, and an undefined `<slips-player>` custom element has no size. So "reserve space up front" leaves an empty hole when there is nothing to show, and "insert on response" shifts the page.

**Options to evaluate (pick one per layout, record as an architecture decision):**
1. **Eligibility known before render.** If Salla's injection mechanism lets Slips output markup or a size hint server-side (or a per-store, per-page eligibility manifest that is small and cached at the CDN and loaded early), size can be reserved only when content exists. Depends on G1 findings (Story 1.5 AC3).
2. **Non-shifting placements.** Overlays, a floating bubble, or a story ring inside space the theme already reserves; or inserting content only when its slot is below the viewport (shifts of elements outside the viewport do not count toward CLS). Shifts within 500 ms of a user input are also excluded by the CLS definition, which helps for tap-to-open viewers.
3. **Merchant-placed fixed-height container.** The merchant adds a container of known height where content will appear. Simple and shift-free, but it leaves empty space if content later becomes ineligible, which contradicts NFR1's "no space when no content" unless the container collapses only while off-screen.
4. **Full-screen viewer** (Stories and Reels opened from a ring or cover) is mounted on `document.body` as an overlay and never shifts layout.

**Test definition (from PRD NFR1 and Story 1.2):** no layout-shift entries attributable to Slips elements, on ≥ 3 representative themes, in four scenarios: content present, no content, API timeout, invalid key. Add a "CLS-safe placeholder" decision to `tech-stack.md` once chosen.

### B.2 Player byte budget (review H19)

- **Initial payload** = all JS and CSS the injector fetches before first render, measured gzip. Budget ≤ 50 KB (CI fails). Core loader target ~20 KB (CI warns).
- **On-demand modules** (for example an adaptive streaming library for browsers without native HLS, the full-screen viewer, analytics batching) are excluded from the initial budget, but each has its own cap, set by the architect and checked in CI.
- **Media** (posters, video) and fonts already loaded by the theme are excluded.
- **Adaptive video choice:** native HLS works on iOS Safari; Android and desktop browsers need an MSE-based library, which is large. Compare (a) progressive MP4 renditions picked from a bandwidth estimate (small code, simpler) with (b) HLS plus a lazily loaded library only where needed. Record the decision.
- **Merchant CSP:** check during the spike (Story 1.5 AC3) that store Content-Security-Policy does not block the injector, its API calls, or media domains.
- **Shared code (review L10):** `packages/player` must use type-only imports from shared packages; no runtime Zod or Drizzle in the player bundle. Enforce with Turborepo boundaries or a lint rule.

### B.3 Analytics scale and partitioning (review M24)

- Events arrive through a queue, not written synchronously from the HTTP handler.
- Raw events in a Postgres table partitioned by time (for example monthly), created through custom SQL migrations alongside Drizzle Kit.
- Daily rollups per store and content item feed the dashboard, so the 30-day P95 ≤ 2 s target (NFR2) does not scan raw events.
- Retention (NFR10, Q-16) is applied by dropping or aggregating old partitions.
- Define the trigger for moving to a columnar store (for example: rollup queries miss NFR2 at peak load in the Story 7.11 test).
- Seasonal peaks of 10× (NFR14) apply mostly to the content API (CDN-served) and event ingestion; size the ingestion path and queue for that.

### B.4 Tenant isolation (review M25)

Choose and document one primary mechanism, with automated tests:
- Postgres row-level security with the store ID set per request/transaction, or
- A mandatory store-scoped data-access layer in NestJS that every query goes through.

Using both (RLS as a safety net behind a scoped repository) is reasonable. The Slips Admin view (PRD FR27) needs a separate, audited path that is not available to merchant sessions.

### B.5 Previews reuse the real player (reviews M7, M26)

The content editor preview (FR7, Story 3.5) and the Store Preview page (FR18, Story 7.3) should both embed `packages/player` in a preview mode with mock data and simulated cart actions (for example in an iframe), instead of a separate preview implementation. This keeps previews accurate and avoids building the player twice.

### B.6 Shadow DOM vs theme inheritance (reviews M5, M23)

- Shadow DOM isolates player styles from the theme in both directions (NFR9). Only inherited properties and CSS custom properties cross the boundary.
- MVP does **not** match theme colours or fonts (PRD §1.4). Still, expose a small set of CSS custom properties now so FR-INJ-08 (Phase 2) can be added without a rewrite.
- `@font-face` declared inside a shadow root is unreliable in some browsers; declare any player font in the light DOM, or use the system font stack.
- Mount the full-screen viewer on `document.body` (its own shadow root) to escape theme `overflow`/`z-index`/`transform` containers. Decide the focus-trap and scroll-lock approach (PRD Story 5.2b AC2).

### B.7 Injector key as a public identifier (review C7)

- Store the key as a plain, indexed lookup column; it is also the CDN cache key.
- Protect storefront APIs with origin/store-domain binding, rate limits, event IDs for dedup and bot heuristics (PRD FR26). Short-lived signed tokens issued by the content API to the event endpoint are an option if spoofing is seen in practice.
- Regenerate = issue a new key, keep the old one for an overlap period, purge the CDN. Uninstall = the content API returns an empty result for the key.
- Real secrets (Salla tokens, webhook secrets) stay server-side, encrypted (for example KMS-backed), never logged.

### B.8 Freshness: schedules, CDN and product changes (review H12)

- A scheduler must emit cache invalidation at each schedule start and end; there is no merchant write at those moments.
- Product price/stock changes must purge every cached response that includes a linked content item.
- Budget: sync ≤ 1 minute + cache ≤ 1 minute → ≤ 2 minutes P95 end to end (PRD FR24). At add-to-cart, Salla's price governs.
- Queue/scheduler and CDN purge are required capabilities; add them to `tech-stack.md`.

### B.9 Webhook and integration lifecycle (review H13)

- Idempotency by event ID (or payload hash); ordering by Salla's updated timestamp/version so older events never overwrite newer data.
- Single-flight token refresh per store (lock), with the Disconnected state on failure.
- Periodic reconciliation (at least daily) for products and orders.
- Order updates (cancel, refund) re-run attribution for that order (PRD FR13 rule 8).

### B.10 Event integrity (review H17)

- Client generates a unique ID per event; server drops duplicates within a dedup window.
- Validate store key + origin; per-store and per-viewer rate limits; plausibility checks (for example a viewer producing far more events than playback time allows).
- Add-to-cart events count for attribution only if Salla confirmed the add; record the confirmation result.

### B.11 Shopper PII handling (review C6)

- Order webhooks contain shopper name, phone, email and address. Redact before persisting or logging; keep only the PRD NFR4.b fields.
- If matching needs a shopper identifier, store a salted hash; keep the salt outside the database.
- Data residency (Q-05) may restrict hosting, database region, CDN and video service. Do not finalize these until Q-05 closes.

### B.12 Other notes

- **Platform adapter (Q-07):** if other platforms are likely, put Salla-specific code behind an adapter interface from the start.
- **Admin view (FR27):** decide between `apps/admin` and a protected route group in the dashboard with separate internal sign-in.
- **Spike output:** `docs/spike-findings.md` is the single record of G1-G8 results and the go/no-go decision (Story 1.6b).

---

## C. Rejected alternatives

### C.1 SRS whole-order, last-touch attribution (SRS FR-ANA-03)
**What it was:** an order is attributed if it contains a product added via Slips **or follows a Slips product click**, within a configurable window (default 7 days), last-touch, crediting the order.
**Why rejected (owner decision C4):**
- Slips only sees its own touches, so "last touch" in practice means "any Slips touch in 7 days". That claims credit for purchases the shopper would have made anyway.
- Crediting the whole order counts unrelated items, inflating revenue.
- Click-based credit cannot be checked against Salla order data, so the ±3% reconciliation (exit criterion E3) would be circular.
- An unbounded "configurable" window can be stretched in sales demos.
**Chosen instead:** PRD FR13: only cart-tagged line items, window 1-14 days (default 7), refunds and cancellations subtracted, views and clicks never credited.

### C.2 View-through or click-through credit
Rejected for the same reasons as C.1. Views and clicks remain funnel metrics. A holdout (incrementality) test can be considered in Phase 2 if merchants ask for a broader measure.

### C.3 Treating the injector key as a secret (SRS NFR-SEC-02, FR-SET-02)
Rejected: the key is embedded in every storefront page and used as a cache key, so masking or encrypting it adds no protection, and a reversibly encrypted key cannot be looked up on the hot path. Protection comes from server-side validation (PRD NFR3, FR26).

### C.4 Always reserving space for Slips components (SRS NFR-PERF-02 as written)
Rejected: when no content is eligible or the service is down, a reserved empty box is a visible break, contradicting "fail gracefully" (FR-INJ-09). See §B.1 for options.

### C.5 Hotlinking external media
Rejected: hotlinked media bypasses transcoding, size limits, scanning, moderation and CSP checks. External links are always fetched (SSRF-protected) and processed like uploads (PRD FR5).

### C.6 Two separate preview implementations
Rejected in favour of reusing the real player in preview mode (§B.5).

### C.7 Per-plan upload limits in the MVP (SRS FR-CON-08)
Rejected for the MVP: MVP plans limit only active content and placements, and pricing (Q-04) is open. Global upload limits apply (PRD FR5, Q-13).

### C.8 Full role-based access in the MVP (SRS NFR-SEC-04)
Deferred to Phase 2 with team features. MVP has one merchant account per store (PRD FR28, NFR3).

### C.9 Custom transcoding pipeline
Rejected in favour of a managed video service, subject to Q-05 (residency) and cost (NFR11).

### C.10 Adding to cart a default variant for products with required options
Rejected: it can put the wrong size or colour in the cart or show the wrong price. Until the spike confirms an option-selection path, such products use "View options" (PRD FR23).
