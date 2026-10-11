# Adversarial Review: Slips PRD v0.1 (`docs/prd.md`)

**Reviewer stance:** adversarial, general. **Date:** 2026-10-10. **Inputs read:** `docs/prd.md`, `docs/Slips_SRS_v0.1.md` (to check traceability), `docs/tech-stack.md`.

## Verdict

This PRD is not ready to hand to UX, architecture, or story sharding. It is a compressed index of the SRS that keeps the feature list but drops the parts that make a launch survivable: it has no success metrics or counter-metrics, it builds seven epics on Salla capabilities that are explicitly unverified while giving the spike no go/no-go gate, and its central value claim ("attributed orders and revenue, so the app proves its own ROI") rests on an attribution definition that is under-specified, self-inflating, and spoofable through a public injector key with bot filtering deferred to Phase 2. Several requirements contradict each other in ways that will surface as soon as someone designs or builds them: zero layout shift vs. graceful failure, WCAG 2.1 AA vs. deferred captions, add-to-cart in MVP vs. variants in Phase 2, and a "secret" injector key that has to sit in public storefront HTML. PDPL handling is reduced to one bullet while the app ingests order webhooks full of shopper PII and the data residency decision is still open. Fix the critical items below before any downstream agent starts. Otherwise architecture will be designed around assumptions the spike may disprove, and the stories will pass their acceptance criteria while the product fails in the field.

**Counts:** Critical 7 | High 11 | Medium 11 | Low 6 | Total 35

---

## Critical

### C1. No success metrics, no counter-metrics, no definition of "launch"
- **Location:** §1 Goals; whole document (there is no Success Metrics section). The SRS §10.1 "Exit criteria" were not carried over.
- **Problem:** The goals cannot be tested. "Reach a pilot-ready MVP **quickly**", "so the app **proves its own ROI**" and "fund Phases 2-3 from pilot revenue" have no numbers, no owners and no time box. The SRS exit criteria (Salla listing, ±3% reconciliation, at least [TBD ~10] pilots each with an attributed order, budget met on three themes, no open critical/high security findings) are missing from the PRD, so nothing defines "done" for the MVP. There are no counter-metrics, so the team can hit "attributed revenue up" while hurting store Core Web Vitals, store conversion, merchant trust or uninstall rate, and nobody will notice.
- **Fix:** Add a §1.x "Success metrics" table with: activation (install → first published content within N days, target %), weekly active merchants, pilot count and paid conversion, merchant 30/60-day retention and uninstall rate, and attributed revenue per store. Add explicit counter-metrics: storefront LCP/INP/CLS delta vs. a baseline (NFR-PERF-07, also dropped), the add-to-cart error rate, attribution dispute rate, and the share of attributed revenue coming from orders with no Slips product in them. Copy the SRS exit criteria in and fill in every [TBD].

### C2. The whole MVP depends on unverified Salla capabilities, and the spike has no go/no-go gate
- **Location:** §4 "Every item must be verified in Epic 1 against current Salla docs"; Story 1.5; Story 1.6 AC3 "any change to FR13 is flagged to the PM"; §7 Q-01; §8 "Architect agent: after Epic 1 findings".
- **Problem:** The PRD admits that injection, cart actions, attribution tagging, webhooks and billing are assumptions. Even so, Epics 2-7 and FR9-FR14/FR19 are written as if every one of them works. Nothing says what happens if they don't. Specific unverified assumptions:
  - That an App Store app can inject a script into **every** theme (official Twilight themes, legacy themes and custom themes) without the merchant editing code. The "installation guide" in FR17/FR18 suggests it can't.
  - That a third-party script can add to cart through a supported API, and that it works for guest shoppers.
  - That a cart or order can carry a custom tag (Story 1.6 AC1 "tags the session") **and that the order webhook echoes it back** (AC2). If it doesn't, FR13 falls back to fuzzy browser-side matching, which changes privacy, accuracy and architecture.
  - That Salla app billing supports metered/limit-based plans, upgrade/downgrade events, and trials (FR19, Story 7.2 AC4).
  - That Salla exposes a storefront consent state (NFR4 "consent-aware").
  
  "Flagged to the PM" is a notification, not a decision.
- **Fix:** Turn Epic 1 into a gate with written pass/fail criteria for each capability and a named fallback for each failure: injection → manual snippet, theme app block, or no-go; cart → SDK call, redirect to product page, or no-go; attribution tag → order note/custom field, or client-side thank-you-page beacon with a documented accuracy hit, or demote FR13 to "assisted" metrics. State that Epics 2-7 are not sharded until the gate passes, and that §2 is re-baselined from `docs/spike-findings.md`.

### C3. In-content add to cart ships in the MVP, but product variants/options do not
- **Location:** FR11, Story 5.4 AC1-AC2; SRS §10.2 defers FR-PRD-07/08 (variants) to Phase 2; FR3 syncs only "name, image, category, price, availability".
- **Problem:** A large share of Salla catalogs (fashion, cosmetics shades, sizes) have required options. The product card has no option picker, and the sync doesn't import options or per-variant stock/price. For those products, "tapping adds to the Salla cart" will fail, add a default variant the shopper didn't pick, or show a price/stock that doesn't match the variant. This is the core purchase flow, and it breaks for the very merchants most likely to use short-form video.
- **Fix:** Either (a) bring a minimal option selector and per-variant sync into the MVP, or (b) require that products with required options downgrade the primary CTA to "View options" (open the product page) and never call add-to-cart, and add an AC that covers it. Either way, sync option/variant presence in FR3 and add a test fixture for multi-option products.

### C4. Attribution is under-defined and biased toward over-crediting Slips, so the ROI headline can be gamed
- **Location:** Goal 3; FR13 "last-touch, default 7-day window, configurable"; Story 6.2; Story 7.6 AC2 "reconciled against Salla order data within agreed tolerance"; SRS FR-ANA-03 (click-through counts) and FR-ANA-12 (bot filtering deferred to Phase 2).
- **Problem:**
  - "Last-touch" means nothing when Slips sees only its own touches. In practice it becomes "any Slips touch within 7 days", which claims credit for organic purchases.
  - The SRS rule credits an order that merely "follows a Slips product click". A shopper who taps a card, leaves, and buys a week later through search counts as Slips revenue.
  - Nothing says whether attributed revenue is the **whole order** or only the Slips-touched line items, or whether shipping, VAT, discounts and refunds are included. When content items compete for the same order, nothing says which one gets credit.
  - "Configurable" has no bounds. A merchant (or a sales demo) can set 90 days and inflate the numbers.
  - Bot and duplicate filtering is deferred, so views, CTR and the funnel are inflated from day one.
  - The reconciliation in Story 7.6 is circular. Salla has no attribution ground truth, so you can only confirm that the attributed orders exist, not that the attribution is right, and the "agreed tolerance" is undefined.
- **Fix:** Specify the model in the PRD, not later. Count only orders that contain a product added to the cart via Slips as "attributed"; report click-through orders separately as "assisted". Credit only the Slips line-item value (excluding shipping and VAT), with a stated rule for the full order value if you want it as a secondary figure. Cap the window (for example 1-14 days), show it on every revenue figure, and say which content gets credit when several touched the order. Reverse attribution on cancellation or refund. Bring basic bot and duplicate filtering into the MVP. Define reconciliation as "the attributed order IDs exist in Salla with matching line items and status; target ≥ 99%", plus a manual audit sample on pilot stores. Add a holdout or incrementality experiment to the Phase 2 backlog and name it as the counter to inflated ROI.

### C5. "Zero layout shift" contradicts "fails gracefully" and "renders only eligible content"
- **Location:** Goal 4 "zero layout shift"; NFR1; FR9; FR10 "fails gracefully"; Story 5.1 AC2 "nothing visible breaks"; Story 5.5 AC1 "All three layouts reserve space"; Story 1.2 AC2 "fails on any measurable shift".
- **Problem:** Until the content API answers, the player can't know whether there is eligible content for a page. It has two options. It can reserve space up front, and then show an empty hole when there's no content, the API fails, or the key is invalid. That is a visible break, and it breaks Story 5.1 AC2. Or it can insert on response, which shifts the layout and breaks NFR1. Nothing in the PRD resolves this, and both UX and architecture need the answer on day one.
- **Fix:** Decide the mechanism and write it down. Options: (a) render eligibility server-side into the page through the injection mechanism, if Salla allows it; (b) only use placements that don't shift layout (overlay or floating story bubble, or placement below the fold, where CLS doesn't count until the user scrolls); (c) a merchant-placed container with a fixed height that collapses only on user interaction. Rewrite the AC as "CLS contribution = 0.00 measured on N reference themes for these cases: content present, no content, API timeout, invalid key".

### C6. PDPL is reduced to one bullet while the product ingests shopper PII and residency is undecided
- **Location:** NFR4; Story 6.1 AC2 "no personal data"; Story 6.2 (order webhooks); Story 7.5 AC2; §4 "data residency decision pending (Q-05)"; Story 1.1 AC3 (staging deploy); Story 7.6 (real pilot stores).
- **Problem:**
  - Salla order webhooks carry customer names, phones, emails and addresses. The PRD says events contain no personal data but says nothing about **orders**, so the attribution store will hold PII by default.
  - Matching a pseudonymous session to an order is linkage that can re-identify the shopper. Pseudonymity disappears the moment the join succeeds.
  - "Consent-aware tracking" names no consent source and no default for when no consent signal exists (common on Salla storefronts). Nothing says what is collected when consent is refused, or how that affects attribution numbers.
  - Q-05 (residency, which brings in PDPL cross-border transfer rules) is "pending", yet pilots will process real Saudi shopper data. Vercel-style hosting is assumed in §4.
  - Retention (SRS NFR-DATA-01/02, both with [TBD]/[Assumption]) and merchant export/deletion (NFR-DATA-03) are missing from the PRD. Story 7.5 AC2 says only "retention rules implemented".
  - Nothing covers the controller/processor roles, a DPA, breach-notification duty, IP addresses in logs, or shopper data-subject requests routed through the merchant.
- **Fix:** Add a "Data & Privacy" requirements block. Order data minimization (store order ID, line items and totals; drop or never persist shopper identity fields). Lawful basis and consent defaults, including behavior when no signal exists. Retention periods for raw events, aggregates, orders, media, logs and post-uninstall data. Merchant export/delete. Slips as processor plus a DPA. Breach-notification runbook. Make Q-05 a blocker for any production or pilot data, not "pending". Get legal sign-off as a gate before Story 7.6.

### C7. The injector-key model is incoherent: a public identifier is treated as a secret
- **Location:** FR9 "loads via the store's injector key"; FR17 "injector key (masked, copy, regenerate)"; NFR3 "encrypted tokens/keys"; Story 7.1 AC2 "regenerate (old key invalidated)"; Story 5.1 AC1; Story 4.3 AC1 "keyed by injector key"; FR2/Story 1.4 AC3 "uninstall deactivates the injector".
- **Problem:** Any key the storefront script uses is visible in page source to every visitor. Masking and encrypting it is security theater, and it makes people believe the key protects something.
  - If it does protect the event-ingestion and content APIs, anyone can copy it, read content and post fake events (see H11).
  - "Copy" plus an "installation guide" implies the merchant pastes the key into the theme. That contradicts Story 5.1 "one script to enable Slips" and the app-install injection being verified in Story 1.5.
  - "Regenerate (old key invalidated)" instantly blanks a storefront where the key was pasted by hand.
  - After uninstall, Slips may no longer have API access to remove a manually installed snippet, so "deactivate the injector" can only mean serving a no-op server-side.
- **Fix:** Reclassify the key as a public store identifier. Remove "masked/encrypted" for it. Protect the APIs with origin/referrer checks, signed short-lived tokens issued per page load where the platform allows it, and rate limits per store and per IP. Define one install path from the spike outcome: automatic, or a manual snippet with a fallback. Define regenerate as "rotate with an N-hour overlap", and define uninstall as "the server returns an empty, non-rendering response for that store".

---

## High

### H1. How the merchant reaches the dashboard and who may access it is unspecified; RBAC is quietly dropped
- **Location:** FR1; Story 1.3 AC3; §5 Epic 8 "team roles" deferred; SRS §10.1 "Non-functional: All of Section 5" includes NFR-SEC-04 (RBAC).
- **Problem:** After OAuth install, how does the merchant sign in again? Through an embedded app inside the Salla admin (iframe, third-party cookie issues), SSO from Salla, or a separate Slips login? Can store staff (Salla employee accounts) reach it? The SRS demands RBAC in the MVP and the PRD defers roles, which contradicts it. Session handling, logout and multi-store merchants are also missing.
- **Fix:** Add an FR for dashboard authentication: the entry mechanism, session lifetime, re-authentication, and mapping a Salla user to a Slips user. State explicitly "MVP: single Owner role; NFR-SEC-04 deferred", and record that as a risk acceptance.

### H2. The WCAG 2.1 AA target contradicts the deferred captions and the autoplaying, time-based Stories
- **Location:** NFR6 "WCAG 2.1 AA target"; Story 7.4 AC2; FR10 "muted autoplay"; Story 5.2 "tap to advance, progress bar"; SRS FR-CON-16 (captions) deferred to Phase 2.
- **Problem:** Prerecorded video with audio needs captions (SC 1.2.2, Level A). Auto-advancing timed Stories need pause/stop and timing control (SC 2.2.1, 2.2.2). Swipe-only navigation needs a non-gesture alternative (SC 2.5.1). And "Target" is not a requirement. As written, the MVP fails its own AA claim.
- **Fix:** Either bring captions (at minimum uploaded VTT) and pause/keyboard/button alternatives into the MVP, or downgrade the claim to "AA for the dashboard; player exceptions listed". Add player ACs for pause, a focus trap with Escape to close, button alternatives to swipes, and respect for `prefers-reduced-motion`, which should disable autoplay and auto-advance.

### H3. Billing and plan enforcement can't be tested: plans, limits, and "placement" are undefined
- **Location:** FR19; Story 7.2 AC1-AC4; §7 Q-04 "Final plan names and prices"; Goal 6 "fund Phases 2-3 from pilot revenue".
- **Problem:** Story 7.2 enforces limits that don't exist yet. "Placements" is never defined: per page type, per target ID, or per layout instance? The grace period length is missing. Nothing says **which** content gets deactivated on downgrade (oldest, lowest-performing, or merchant's choice). Nothing says whether limits apply in the storefront API or only in the dashboard. Nothing says what happens to scheduled content that would exceed the limit when it goes live. "Trial works if configured" can't be tested. The revenue goal depends on all of this.
- **Fix:** Close Q-04 before Epic 7 is sharded. Define "active content" and "placement" in a glossary. Specify the deactivation order (merchant chooses during the grace period, default least-recently-published), the grace length, and enforcement at publish time plus a storefront-side check. Split Story 7.2 into event handling, limit enforcement, and the usage/warnings UI.

### H4. Cost and abuse controls were dropped while the product serves video at scale
- **Location:** §4 "managed video service (for example Mux or Cloudflare Stream)"; FR5; NFR list (SRS NFR-COST-01/02 missing); SRS FR-CON-08 "Limits per plan (Section 7)", which is not in the PRD.
- **Problem:** Managed video bills per minute stored and delivered. Muted autoplay in a Reels feed on high-traffic Saudi stores during White Friday or Ramadan (SRS NFR-SCAL-01: 10× peaks, also dropped) can cost more than a basic plan brings in. Upload size and duration limits per plan aren't in the PRD, so Story 3.3 AC1 "unsupported type/size/duration is rejected" has no thresholds.
- **Fix:** Add NFRs for per-store metering of storage, transcode minutes and delivered minutes, a hard cost cap per plan with a degradation behavior (poster-only or lower renditions), upload limits as numbers, and a cost model per plan before pricing (Q-04).

### H5. Content moderation, copyright and takedown are absent
- **Location:** FR4, FR5 "quality check"; Story 3.3; SRS Q-09 "Who moderates content and handles abuse reports?", which the PRD drops from §7; CTA action "open link" (SRS FR-CON-13).
- **Problem:** Slips hosts and serves merchant video from its own CDN. Copyrighted music in Reels, prohibited content under Saudi media rules, and phishing links in CTAs all become Slips's liability. The "quality check" is undefined: is it technical (resolution or bitrate) or content-related? An "open link" CTA to an arbitrary URL invites open-redirect and phishing abuse.
- **Fix:** Add Q-09 back. Add a minimum requirement: terms of use, an abuse-report channel, an admin takedown that invalidates the CDN within 1 minute, and restricting CTA links to the store's own domain (or an allowlist). Define "quality check" as specific technical checks with thresholds.

### H6. SRS MVP requirements were silently dropped, and there are two "sources of truth"
- **Location:** Header "Source of truth for detail: `docs/Slips_SRS_v0.1.md`"; §2 mappings.
- **Problem:** SRS §10.1 puts these in the MVP, but no PRD FR or story covers them:
  - FR-NOT-03 (support entry point on every page, M).
  - FR-AUTH-03 (onboarding checklist; Story 6.4 AC2 only mentions it).
  - FR-AUTH-04 is partial.
  - FR-CON-03 (Archived, Processing/Failed statuses).
  - FR-CON-13 (CTA actions: add to cart / open product / open link).
  - FR-SET-06 (explicit save with confirmation).
  - NFR-PERF-06 (processing ≤ 5 min P95) and NFR-PERF-07 (Core Web Vitals impact).
  - NFR-SCAL-01, NFR-COMP-01..03 (theme and browser matrix, Shadow DOM), NFR-REL-01, NFR-OBS-02 (admin console), NFR-COST, NFR-DATA-01..03, NFR-AVAIL-02.
  
  NFR8 (logging, backups, versioned injector with rollback) has no story at all. With two sources of truth, the PRD gives no rule for which wins when they conflict, for example step-to-step funnel rates (FR-ANA-06) vs. the open Appendix B item 4.
- **Fix:** Make the PRD the single source of truth for the MVP: include or explicitly exclude every SRS MVP ID, and add a traceability table. Add stories for the observability/backup/injector-rollback work, the support entry point, the admin console, and data export/deletion.

### H7. Scheduling, caching and price freshness don't fit together
- **Location:** Story 4.2 AC1 "goes live at the set time"; Story 4.3 AC2 "invalidated within one minute of changes"; NFR7; Story 2.2 AC1 "within one minute"; FR11 product card price.
- **Problem:** A scheduled start or end is not a "change" event, so nothing triggers invalidation and a scheduled item can stay invisible, or stay live past its end, for a full CDN TTL. If price and stock are cached in the content API, the card can show a price different from the cart price, which raises consumer-protection and trust problems. The time budgets also stack: a webhook within 1 min, then invalidation within 1 min, means staleness up to 2+ min, never stated.
- **Fix:** Require a scheduler that emits invalidation at schedule boundaries (or make the time a cache key / use short TTLs around boundaries). Fetch price and stock live from Salla on the client at card open, or state an explicit staleness bound with "price confirmed in cart" UX. Write the AC as an end-to-end bound: "Salla change → visible in storefront ≤ 2 min P95".

### H8. Webhook and integration lifecycle edge cases are missing
- **Location:** FR2, FR3, Story 1.3 AC2 "refresh works automatically", Story 1.4, Story 2.1, Story 2.2, Story 6.2 AC2.
- **Problem:**
  - No reconciliation or backfill for missed webhooks. Webhooks get dropped, and the only fix is a manual sync.
  - No handling of out-of-order delivery (an update arriving before the create).
  - No race protection on token refresh. If refresh tokens are single-use, two concurrent refreshes can lock a store out permanently.
  - Nothing defines behavior when a token is revoked or refresh fails ("disconnected" state, merchant notification).
  - Reinstall within the retention period (restore or start fresh?) is undefined.
  - Order **status changes after attribution** (cancel, refund, partial refund, edit) appear only as a test case in Story 6.2 AC2 and are not a requirement.
  - Story 2.2 AC2 sends deleted products to "FR16", which covers only out-of-stock. Published content linked to a deleted product is undefined.
- **Fix:** Add FRs for a nightly reconciliation sync, ordering by event timestamp/version, single-flight token refresh, a disconnected state with merchant alert, reinstall semantics, order-status-driven attribution reversal, and deleted-product handling (auto-unpublish plus a merchant notice).

### H9. Several stories are too big for "one dev agent in one session" or can't be completed by development work
- **Location:** §6 sizing claim; Stories 1.6, 5.2, 5.3, 6.2, 7.2, 7.4, 7.5, 7.6.
- **Problem:**
  - Story 7.6 AC3 "Salla review passed" and AC2 "pilot merchants onboarded" are business outcomes that depend on outside parties.
  - Story 7.5 AC2 "Privacy policy and data-processing terms are published" is legal work. AC3 "No open critical/high findings" is unbounded.
  - Story 7.4 is a cross-cutting audit of every screen.
  - Story 6.2 is the hardest logic in the product, packed into three ACs.
  - Stories 5.2 and 5.3 each cover gesture handling, media, cross-browser support and RTL.
  - Story 1.6 depends on Salla test-store order flows.
- **Fix:** Split them. 7.6 becomes checklists/milestones, not dev stories. 7.5 splits into security test suites (dev) and legal deliverables (non-dev tasks). 6.2 splits into order ingestion, matching, reversal, and the methodology page. 5.2/5.3 split into a core player, gestures + RTL, and renditions/lazy-load. Put i18n/a11y checks into each story's Definition of Done instead of a late pass.

### H10. Metric definitions come after the screens that display them; Appendix B conflicts carry into stories
- **Location:** Story 3.1 AC1 "views, clicks" (Epic 3); Story 6.4 AC1 "Four KPI cards" (unnamed); FR15; Story 6.3 AC2 "counts and rates" (rate basis undefined); Story 6.5 (glossary, built last).
- **Problem:** Epic 3 displays views and clicks before Epic 6 defines or collects them. The four Overview KPIs are never named. The funnel rate basis (total views vs. step-to-step, SRS Appendix B item 4) is unresolved. "Engagement" vs. "CTR" (Appendix B item 2) is still open. UX can't design these screens and QA can't test them.
- **Fix:** Put the metric glossary into the PRD now, with exact formulas: what counts as a view (≥ X s or ≥ Y% visible?), unique viewer (scope and duration), completion, CTR denominator, and funnel rates (show both). Name the four KPIs. Make Story 6.5 a prerequisite, not a closer.

### H11. Event ingestion can be spoofed, and everything downstream inherits the inflation
- **Location:** Story 6.1 AC1 "rate limiting and client-side retry", AC3 "validated and tenant-scoped"; FR12; C7 (public key).
- **Problem:** The beacon endpoint is public and keyed by a public identifier. A competitor, a bot, or the merchant can inflate views and clicks, or fake add-to-cart events to feed attribution. Client-side retry without idempotency keys will double-count. "Validated" is not defined.
- **Fix:** Require an event idempotency ID, server-side dedup, a per-session plausibility check (rates, sequence order), and origin checks. Accept add-to-cart as an attribution input only when it is backed by a cart state that can be confirmed through Salla. Bring FR-ANA-12 into the MVP.

---

## Medium

### M1. The performance budget is ambiguous and measured unreliably
- **Location:** Goal 4 "≤ 50 KB initial, ~20 KB core"; NFR1; Story 1.2; NFR2 "typical 4G".
- **Problem:** The goal doesn't say gzip or brotli (Story 1.2 says gzip). "Initial" doesn't say whether it includes CSS, fonts, the first API JSON or poster images. The ~20 KB core target has no check. "Fails on any measurable shift" will be flaky because themes shift on their own. "Typical 4G" has no throughput or latency profile. The SRS exit criterion of "three representative themes" was dropped. Merchant store CSP or other script blockers aren't considered.
- **Fix:** Define the budget as compressed bytes of every request before first user interaction, with the core loader ≤ 20 KB checked in CI. Measure CLS as a delta against a baseline run on named themes, with a threshold of 0.00. Define the network profile (for example 9 Mbps/170 ms RTT) and the device. Add a CSP compatibility check to the spike.

### M2. Scope creep and duplicate features in the MVP
- **Location:** Story 3.5 (live preview) vs. Story 7.3/FR18 (store preview on a "simulated store"); FR4/Story 3.3 AC3 external links; FR5 auto-publish; FR6 duplicate; FR13 configurable window; Story 7.2 AC4 trial; Story 6.3 AC1 custom ranges.
- **Problem:** Two preview systems is twice the work for the same answer. External-link media, auto-publish, a configurable window and a trial are all optional, and each adds edge cases to a launch that is already gated on a spike.
- **Fix:** Merge 7.3 into 3.5, or make 7.3 a link to the real storefront with a preview token. Cut external links, configurable windows and auto-publish from the MVP unless pilot merchants have demanded them.

### M3. External media links have two behaviors and no rules
- **Location:** Story 3.3 AC3 "fetched safely (SSRF-protected) **or** stored as references".
- **Problem:** "Stored as references" means hotlinking third-party media, which bypasses transcoding, the size budget, moderation and the CSP, and can break silently. The "or" leaves the choice to whoever builds it.
- **Fix:** One behavior: always ingest (fetch, validate, transcode) with SSRF protections and a size/time limit, and no hotlinking. Or remove external links from the MVP (see M2).

### M4. Upload security details are missing
- **Location:** Story 3.3 AC1-AC2; NFR3 "upload validation and scanning".
- **Problem:** Not specified: EXIF/GPS metadata stripping (merchants shoot at home), SVG and other active-content formats, magic-byte vs. extension checks, where scanning happens for large videos uploaded directly to the managed video service (bypassing Slips), signed upload URL scoping and expiry, and quarantine before publish.
- **Fix:** List allowed MIME types and how they're verified, strip metadata, ban SVG, use direct-upload URLs scoped to tenant and expiry, and require scan-before-publish with a defined state.

### M5. The RTL interaction model for the player is undefined
- **Location:** NFR5; §3 "full mirroring"; Story 5.2 AC2 "RTL and LTR"; Story 5.3.
- **Problem:** Nothing defines whether tapping the right edge means "next" in RTL, whether the progress-bar fill and story-ring order mirror, or the swipe direction between Stories. It also doesn't cover digits (Arabic-Indic vs. Western), SAR and currency formatting (SRS NFR-LOC-02, dropped), or bidi for English product names inside Arabic UI. Each developer will guess differently.
- **Fix:** Add an explicit RTL interaction table (gesture → action per direction), the numeral and currency policy, and bidi isolation rules. Hand it to the UX agent as a required input.

### M6. Story dependencies and ordering are broken
- **Location:** Story 3.1 (stats before Epic 6); Story 3.2 product selector (needs Epic 2); Story 3.4 AC3 "subject to visibility and schedule" (needs Epic 4); Story 4.1 AC2 vs. Story 3.4 AC3 (auto-publish of content without placement?); Story 2.2 AC2 → FR16.
- **Problem:** Agents working through epics in order will hit missing prerequisites, or will stub behavior that later contradicts the real version.
- **Fix:** Add explicit "Depends on" fields per story. Define auto-publish for content without a placement (stays Draft with a reason).

### M7. The tech assumptions contradict the owner's stack and get ahead of open decisions
- **Location:** §4 "Next.js for the dashboard (the demo is Vercel-hosted)", "vanilla/Preact", "managed cloud"; `docs/tech-stack.md` (NestJS, Preact Web Component with Shadow DOM, Turborepo); Story 1.1 AC3 staging deploy before Q-05.
- **Problem:** The PRD never mentions NestJS, Drizzle or Shadow DOM, and "the demo is Vercel-hosted" is not a reason to pick a stack. A staging environment is built before residency (Q-05) is decided, which may force a re-host later.
- **Fix:** Point §4 at `docs/tech-stack.md` as the default and delete the conflicting text. Make Q-05 an input to Story 1.1 or limit staging to synthetic data only.

### M8. The availability NFR has no definition or error budget
- **Location:** NFR7 "Storefront services 99.9% availability".
- **Problem:** "Storefront services" isn't defined (content API, CDN, ingestion, video delivery?), and neither is how availability is measured or what is excluded (vendor outages). The player degrades gracefully anyway, so the number that matters is the share of page views where content rendered.
- **Fix:** Define SLIs per service (content API success rate at the edge, ingestion acceptance rate, share of player renders that succeed) with targets and measurement windows.

### M9. Merchant token handling is under-specified
- **Location:** FR1 "tokens stored encrypted"; NFR3.
- **Problem:** Not stated: which OAuth scopes are requested (least privilege), key management (KMS, envelope encryption, rotation), who at Slips can decrypt (support staff), audit logging of token use, or what happens on a breach (revocation plan).
- **Fix:** Add an NFR covering the scopes list, KMS-backed encryption, no plaintext in logs, access audit logging, and a revocation runbook.

### M10. Currency, VAT and price display are unaddressed
- **Location:** FR3 "price"; FR11; FR14 "attributed revenue".
- **Problem:** Salla stores can show multiple currencies and sale prices. Nothing says whether prices include VAT, or how sale/compare-at prices display on the card. Attributed revenue has no stated currency or tax basis.
- **Fix:** State: store base currency for reporting; the card shows the price the cart will charge, including sale price; revenue excludes VAT and shipping (aligned with C4).

### M11. The content status state machine is incomplete
- **Location:** FR6 tabs "All, Published, Scheduled, Drafts"; Story 3.4 AC2 "Processing/Failed/Ready"; Story 3.6 "archive"; FR19 "deactivated" content.
- **Problem:** Archived, Processing, Failed, Ready and plan-Deactivated statuses exist but have no tab, no defined transitions, and no rule for which ones count toward plan limits.
- **Fix:** Add a status diagram (states, transitions, which states are storefront-visible and count toward limits) and the list-filter behavior for every state.

---

## Low

### L1. The competitor claim is unverified and the differentiation is thin
- **Location:** §1 Background "Na3na3 offers shoppable video only".
- **Fix:** Cite the source and date of the competitor analysis. Explain why Stories + scheduling beats a cheaper incumbent, and point to the attribution credibility work (C4) as the real differentiator.

### L2. A live demo URL is the UI specification of record
- **Location:** §3 "matching the demo (`slips-sage.vercel.app`)".
- **Problem:** The demo can change, and SRS Appendix B lists its known inconsistencies.
- **Fix:** Snapshot the demo (screenshots in the repo) and tell UX to treat it as a reference, not the spec.

### L3. Open items dropped from the SRS
- **Location:** §7 omits Q-07 (multi-platform, which affects the architecture's integration layer), Q-08 (non-video slides), and Q-09 (moderation, see H5).
- **Fix:** Carry them over with owners and due dates. Q-07 at least needs a "build a platform adapter seam: yes/no" decision for the architect.

### L4. The store time zone is assumed to be available
- **Location:** Story 4.2 AC1 "in the store's time zone".
- **Fix:** Confirm in the spike that Salla exposes it. Otherwise default to Asia/Riyadh with a merchant setting.

### L5. The story sizing claim can't be tested
- **Location:** §6 "sized to be completable by one dev agent in one focused session".
- **Fix:** Replace it with a concrete heuristic (for example ≤ 5 ACs, one deployable surface, no external-party dependency).

### L6. Weak acceptance criteria wording
- **Location:** "clear error" (Story 2.1 AC3, Story 3.3 AC1); "visibly flagged" (Story 2.3 AC3); "works on iOS Safari and Android Chrome" (Story 5.2 AC2, no versions, and Samsung Internet from SRS NFR-COMP-02 dropped); "Retried" (Story 2.1 AC3, with no count or backoff).
- **Fix:** Put concrete specs in every AC: error copy keys, retry policy (count/backoff), and a browser/version matrix.
