# Validation Report — Slips PRD v0.1

- **PRD:** `docs/prd.md`
- **Rubric:** `.claude/skills/bmad-prd/assets/prd-validation-checklist.md`
- **Run at:** 2026-10-10
- **Grade:** Poor

## Overall verdict

The PRD gets the sequencing and most of the detail right. Epic 1 is a real de-risking spike: it puts the Salla install → inject → add-to-cart → order-webhook loop ahead of anything else. Most stories have testable ACs, and the performance and privacy NFRs come with real thresholds. What is at risk is the thesis itself. The PRD bets everything on "the app proves its own ROI", but it never defines what an attributed order is (click vs view, gross vs net of cancellations). It also has no success metrics or launch exit criteria, and it quietly drops roughly a third of the SRS's MVP non-functional baseline while still naming the SRS as "source of truth for detail". For a launch-stakes PRD, it is not ready to green-light build until it settles attribution semantics, carries over the SRS exit criteria, makes an honest scope reconciliation against SRS §10.1, and puts owners and deadlines on the launch-blocking open questions (Q-04 pricing, Q-05 residency).

The two extra reviewers make the picture worse, not different. The adversarial review raises the bar from "not ready to green-light" to "not ready to hand to UX, architecture, or story sharding". It adds critical defects the rubric did not surface: add-to-cart ships without product variants; "zero layout shift" cannot coexist with async, gracefully-failing rendering; PDPL is one bullet while order webhooks bring shopper PII into the attribution store; and the injector key is a public identifier dressed up as a secret, which also makes event ingestion spoofable. The SRS/stack consistency review confirms the silent de-scoping item by item (FR-NOT-03, NFR-OBS-02 admin console, NFR-COMP, NFR-DATA, NFR-COST, PERF-06/07, SCAL-01). It also shows that PRD §4 is stale against `docs/tech-stack.md`, which leaves several architecture-shaping needs (a CLS-safe Web Component, CDN purge vs scheduling, analytics partitioning, tenant isolation) with no home.

After deduplication the three reviews come to **66 distinct findings: 8 critical, 20 high, 26 medium, 12 low.** The raw total was 100: rubric 28, adversarial 35, and SRS/stack 37 (its 35 findings plus two implementation-detail notes).

## Themes

- **The PRD is a lossy compression of the SRS with no precedence rule.** It names the SRS as "source of truth" but silently drops MVP NFRs, Must FRs, open questions, assumption tags and Phase 2/3 IDs, and it weakens others in place. — C8, H2, H3, H4, H5, M1, M13, M17, M18, M19, M21, L3, L7, L8, L9
- **The ROI thesis is neither defined nor measured, and it can be gamed.** There are no success or counter-metrics, attribution semantics are under-specified and bias toward over-crediting, metric formulas come after the screens that show them, events can be spoofed, and the revenue basis and differentiation claim are not grounded. — C1, C4, H15, H17, M2, M15
- **The build plan rests on unverified Salla platform capabilities with no go/no-go gate.** This covers injection, cart add for products with variants, order tagging, the install model, webhook lifecycle and the store time zone. — C2, C3, C7, H13, L5
- **Trust, privacy and security are underspecified for a product that handles shopper PII and public endpoints.** — C6, C7, H6, H11, H17, M8, M9, M14, M18, M25
- **The storefront player's constraints conflict with each other and with the stack.** Zero CLS vs async/graceful failure, a byte budget vs adaptive video, WCAG AA vs autoplaying Stories, RTL, and Shadow DOM theming, fonts and overlays all pull against each other. — C5, H7, H19, M5, M10, M20, M23, L10
- **The commercial model and its operating limits are undefined.** Pricing and plans are open, enforcement can't be tested, cost and abuse caps are missing, upload and processing thresholds are absent, the launch-blocking Qs have no owner, and MVP scope is padded. — H1, H8, H9, H10, M7
- **Downstream agents lack the structural inputs they need.** There are no user journeys, no glossary, no non-goals and no status model. Layouts have no config home, placement ordering is missing, bounds are vague, and specs rest on the live demo and unresolved cross-refs. — H16, H18, H20, M3, M4, M6, M16, L1, L2, L4, L11
- **Delivery sequencing and the architecture boundary are muddled.** Stories are oversized or not dev work, dependencies are broken, architecture comes after scaffolding, §4 is stale against tech-stack.md, and caching, analytics-scale and preview design gaps go with it. — H12, H14, M11, M12, M22, M24, M26, L6, L12

## Dimension verdicts

- Decision-readiness — thin
- Substance over theater — adequate
- Strategic coherence — thin
- Done-ness clarity — adequate
- Scope honesty — thin
- Downstream usability — adequate
- Shape fit — thin

## Findings by severity

Reviewer keys: **Rubric/<dimension>** = `review-rubric.md`; **Adv** = `review-adversarial-general.md`; **SRS** = `review-srs-stack-consistency.md`. Severity is the highest any reviewer gave.

### Critical (8)

**C1 · [Rubric/Strategic coherence; Rubric/Substance over theater; Adv C1]** — No success metrics, no counter-metrics, no definition of "launch" (§1 Goals; whole PRD; Story 7.6 AC2)
The thesis is "the app proves its own ROI", yet nothing measures whether it held, and nothing defines "ready to launch". "Quickly", "proves its own ROI" and "fund Phases 2-3 from pilot revenue" have no numbers, owners or time box. The SRS §10.1 exit criteria (±3% reconciliation, ~10 pilots with an attributed order each, three themes, no open critical/high security findings) were not carried over. Without counter-metrics, the team can hit "attributed revenue up" while hurting store Core Web Vitals, conversion, merchant trust or uninstall rate, and nobody will notice.
Fix: Add a Success Metrics section. Cover thesis metrics (activation to first published content within N days, % of stores with ≥1 attributed order in 30 days, trial-to-paid, 30/60-day retention, uninstall rate, attributed revenue per store) and counter-metrics (storefront LCP/INP/CLS delta vs baseline, add-to-cart error rate, attribution-dispute rate). Import the SRS exit criteria with every [TBD] filled, and give the "quickly" goal a date.

**C2 · [Adv C2; Rubric/Decision-readiness]** — The whole MVP depends on unverified Salla capabilities, and the spike has no go/no-go gate (§4; Story 1.5; Story 1.6 AC3; §7 Q-01; §8)
Injection into every theme, third-party add-to-cart (guest shoppers included), an order tag echoed back by the webhook, metered billing with trials, and a storefront consent state are all assumptions. Epics 2–7 are still written as if every one of them works. "Flagged to the PM" is a notification, not a decision.
Fix: Turn Epic 1 into a gate with written pass/fail criteria per capability and a pre-agreed fallback for each one. For injection: a manual snippet, a theme app block, or no-go. For cart: an SDK call, a redirect to the product page, or no-go. For attribution: an order note, a thank-you-page beacon, coupon/UTM, or demoting FR13 to "assisted". Do not shard Epics 2–7 until the gate passes, then re-baseline §2 from `docs/spike-findings.md`.

**C3 · [Adv C3]** — In-content add to cart ships in the MVP, but product variants/options do not (FR11; Story 5.4 AC1–AC2; FR3; SRS FR-PRD-07/08 deferred)
Many Salla catalogs (fashion, cosmetics shades, sizes) have required options. There is no option picker and no variant sync. "Tapping adds to the Salla cart" will fail, add a variant the shopper didn't pick, or show a mismatched price or stock level. The core purchase flow breaks for the very merchants most likely to use short-form video.
Fix: Bring a minimal option selector and per-variant sync into the MVP, or downgrade the CTA to "View options" for products with required options and never call add-to-cart for them. Either way, sync whether a product has options/variants in FR3 and add a multi-option test fixture.

**C4 · [Adv C4; Rubric/Strategic coherence]** — Attribution is under-defined and biased toward over-crediting Slips, so the ROI headline can be gamed (Goal 3; FR13; Story 6.2 AC1–AC2; Story 1.6; Story 7.6 AC2)
"Last-touch" means nothing when Slips sees only its own touches. In practice it becomes "any Slips touch within 7 days", which claims credit for organic purchases. Undefined: what counts as a touch (view vs click), whole order vs Slips line items, VAT/shipping/discounts, cancellation and refund reversal, and which content item gets credit when several touched the order. "Configurable" has no bounds, so a sales demo can set 90 days. Bot filtering is deferred, so the funnel is inflated from day one. The Story 7.6 reconciliation is circular, because Salla holds no attribution ground truth, and Story 6.2 AC2 lists edge cases with no expected outcomes.
Fix: Add an attribution spec block. Count as "attributed" only orders that contain a product added to the cart via Slips, and report click-through orders as "assisted". Credit Slips line items only, excluding VAT and shipping. Cap the window (e.g. 1–14 days) and show it on every figure. Reverse attribution on cancel or refund. Bring basic bot and duplicate filtering into the MVP. Define reconciliation as "attributed order IDs exist in Salla with matching line items, ≥ 99%" plus a manual audit, give expected outcomes for each edge case, and add a holdout test to Phase 2.

**C5 · [Adv C5; SRS H6]** — "Zero layout shift" contradicts "fails gracefully", "renders only eligible content" and an async Shadow DOM Web Component (Goal 4; NFR1; FR9; FR10; Story 5.1 AC1–AC2; Story 5.5 AC1; Story 1.2 AC2)
Until the content API answers, the player can't know whether there is eligible content. If it reserves space up front, an empty hole shows when there is no content, the API fails or the key is invalid, which is a visible break. If it inserts on response, the layout shifts. An undefined `<slips-player>` has no size, so space can only be reserved by markup or CSS injected before the script runs, and that depends on Q-01. The SRS "three representative themes" criterion was dropped.
Fix: Decide the mechanism: server-side eligibility via injection, non-shifting placements only (overlay, bubble, below the fold), or a fixed-height merchant container. Add a Story 1.5 AC on pre-script size reservation. Rewrite the AC as "CLS contribution = 0.00 on ≥ 3 reference themes for content present, no content, API timeout, invalid key". Add a CLS-safe placeholder decision to `tech-stack.md`.

**C6 · [Adv C6; SRS M15]** — PDPL is reduced to one bullet while the product ingests shopper PII and data residency is undecided (NFR4; Story 6.1 AC2; Story 6.2; Story 7.5 AC2; §4 Q-05; Story 1.1 AC3; Story 7.6)
Order webhooks carry names, phones, emails and addresses, so the attribution store holds PII by default. Joining a session to an order re-identifies the shopper. "Consent-aware" names no consent source and no default for when there is no signal. Q-05 is "pending" while pilots will process real Saudi shopper data, and if it requires in-region storage, the managed video service, the CDN and hosting may all be invalid. Retention, export/deletion, controller/processor roles, a DPA, breach notification and DSRs are absent.
Fix: Add a Data & Privacy block covering order-data minimization, lawful basis and consent defaults, retention per data class, merchant export/delete, Slips-as-processor with a DPA, and a breach runbook. Make Q-05 a blocker for any pilot or production data, and add it to `tech-stack.md` as a hosting/video/CDN constraint. Make legal sign-off a gate before Story 7.6.

**C7 · [Adv C7; SRS H7; Rubric/Decision-readiness]** — The injector-key model is incoherent: a public identifier is treated as a secret, and the install model is undecided (FR9; FR17; FR18; NFR3; Story 4.3 AC1; Story 5.1; Story 7.1 AC2; FR2/Story 1.4 AC3)
The key ships in every storefront page and serves as the CDN cache key. Masking and encrypting it is security theater, and a reversibly encrypted key can't be indexed on the hot path anyway. "Copy" plus an "installation guide" implies a manual paste, which contradicts Story 5.1 "one script" and the app-install injection in Story 1.5. The install model (auto vs manual) is never stated as a decision, even though it drives onboarding friction and activation. "Regenerate (old key invalidated)" instantly blanks a hand-installed storefront and needs a CDN purge. After uninstall, "deactivate" can only mean serving a no-op.
Fix: Reclassify the key as a public store identifier stored in a hashed or plain lookup column. Protect the APIs with origin checks, signed short-lived tokens and rate limits. Define one install path from the spike outcome and say what the merchant must do. Define regenerate as "rotate with an N-hour overlap plus a CDN purge" and uninstall as "the server returns an empty response". Keep Salla access tokens encrypted.

**C8 · [Rubric/Scope honesty; SRS H2; Adv H6]** — Silent NFR de-scoping contradicts the SRS phasing rule "All of Section 5" (§2 Non-Functional; SRS §10.0 rule 2, §10.1)
Missing with no citation or story: NFR-COMP-01..03 (theme and browser matrix, style isolation; Story 5.2 AC2 drops Samsung Internet and desktop), NFR-DATA-01..03 (grace period, ~13-month raw retention, merchant export/deletion, a PDPL obligation), NFR-COST-01/02, NFR-REL-01 (media-job retry), NFR-PERF-06 (≤ 5 min processing P95), NFR-PERF-07 (CWV impact), NFR-SCAL-01 (5,000 stores, 10× Ramadan/White Friday peaks) and NFR-AVAIL-02. All of these are launch-relevant for Salla review and PDPL.
Fix: Restore them as NFR9 Compatibility, NFR10 Data retention, NFR11 Cost/abuse, and extend NFR1/2/7 with PERF-06/07, SCAL-01 and REL-01, each with ACs in Stories 1.2, 3.4 and 7.5. Alternatively, list them in a Deferred table with a reason.

### High (20)

**H1 · [Rubric/Decision-readiness]** — Launch-blocking open questions have no owner, deadline or "blocks" link (§7 Q-04, Q-05)
Q-04 gates FR19, Story 7.2 and the Story 7.6 listing. Q-05 gates §4 hosting and Story 7.5. They sit at the same weight as the Phase 2 questions, so nobody can tell whether they must close before Epic 7.
Fix: For each Q, add an owner, a needed-by epic or story, and a default to assume if it stays unresolved (e.g. "KSA region unless counsel says otherwise").

**H2 · [Rubric/Scope honesty; SRS H8; Adv H6]** — SRS MVP Must FRs dropped or uncited (§2 Functional; FR4–FR8; SRS FR-AUTH-03/04, FR-CON-03/13/17, FR-SET-06)
The onboarding checklist appears only in Story 6.4 AC2, with no steps listed. FR-AUTH-04 appears only in Story 1.3 AC3. There is no status model, and Story 3.4 invents "Ready". The CTA actions (add to cart / open product / open link) are never enumerated. FR-CON-17 is uncited, and FR-SET-06 has no AC.
Fix: Cite each one or explicitly de-scope it. Add the four checklist steps to an early story, a status-model FR (replacing "Ready" or recording an SRS change), and the three CTA actions plus optional style to FR4/Story 3.2.

**H3 · [SRS H1; Rubric/Scope honesty; Adv H6]** — FR-NOT-03 (support entry point on every page) dropped entirely (§2; §3; Epic 7)
This is part of the app shell and likely checked in Salla review. The related Q-10 (support model, SLAs) is also missing.
Fix: Add FR20 [FR-NOT-03], a story or AC in Epic 7, a §3 shell entry, and Q-10 in §7.

**H4 · [Adv H6; Rubric/Downstream usability; Rubric/Scope honesty]** — Two "sources of truth": PRD/SRS precedence undefined (header "Source of truth for detail")
When the PRD omits or alters SRS content, downstream agents get conflicting instructions, for example funnel rates (FR-ANA-06) vs the open Appendix B item 4.
Fix: State the rule ("PRD governs MVP scope; SRS governs detail for cited IDs only", or the reverse). The adversarial reviewer recommends making the PRD the single source of truth for the MVP, with a traceability table that includes or excludes every SRS MVP ID.

**H5 · [SRS H3; Rubric/Shape fit; Adv H6]** — Internal admin console (NFR-OBS-02) and the "Slips Admin" user class dropped; NFR8 observability has no story (NFR8; SRS §2.3; `tech-stack.md` layout)
Pilot onboarding and launch support need to look up store sync, jobs and plan usage. The repo layout has no admin app, and NFR-OBS-01 tracing and the named signals are missing.
Fix: Add an admin-console requirement and story (with separate internal auth), decide between `apps/admin` and a route group, and expand NFR8 with the NFR-OBS-01 signals. Alternatively, declare it a non-goal with a pilot workaround such as direct DB access.

**H6 · [Adv H1; Rubric/Scope honesty; SRS M2]** — How the merchant reaches the dashboard is unspecified, and RBAC is cited while roles are deferred (FR1; Story 1.3 AC3; NFR3 "[NFR-SEC-01 to 07]"; §5 Epic 8)
Re-entry after install (embedded iframe, SSO or separate login), staff access, sessions, logout and multi-store merchants are undefined. NFR3 claims NFR-SEC-04 RBAC coverage that is out of MVP scope.
Fix: Add a dashboard-auth FR. Cite NFR-SEC-01..03 and 05..07, and state "MVP: single Owner role; NFR-SEC-04 from Phase 2" as a non-goal and risk acceptance.

**H7 · [Adv H2]** — The WCAG 2.1 AA target contradicts deferred captions and autoplaying, time-based Stories (NFR6; Story 7.4 AC2; FR10; Story 5.2; SRS FR-CON-16)
Captions (SC 1.2.2, Level A), pause and timing control (2.2.1/2.2.2) and gesture alternatives (2.5.1) are all missing. "Target" is not a requirement. As written, the MVP fails its own AA claim.
Fix: Bring captions (VTT) and pause/keyboard/button alternatives into the MVP, or downgrade the claim to "AA for the dashboard; player exceptions listed". Add ACs for pause, a focus trap with Escape, swipe alternatives and `prefers-reduced-motion`.

**H8 · [Adv H3; Rubric/Strategic coherence]** — Billing and plan enforcement can't be tested; the "fund from pilot revenue" goal has no mechanics (FR19; Story 7.2 AC1–AC4; §7 Q-04; Goal 6)
"Placement" is undefined, and so are the grace length, the deactivation order on downgrade, where limits are enforced and what happens to scheduled content that exceeds a limit. "Trial works if configured" can't be tested.
Fix: Close Q-04 before Epic 7 is sharded, or state an MVP pricing hypothesis or demote the goal to "validate willingness to pay". Define "active content" and "placement". Specify the deactivation order, the grace length, and enforcement at publish time plus in the storefront. Split Story 7.2.

**H9 · [Adv H4]** — Cost and abuse controls were dropped while the product serves video at scale (§4; FR5; SRS NFR-COST-01/02, FR-CON-08)
Managed video bills per minute stored and delivered. Autoplaying Reels on high-traffic stores during White Friday or Ramadan can cost more than a basic plan brings in.
Fix: Add per-store metering, a hard cost cap per plan with a degradation behavior (poster-only or lower renditions), and a cost model per plan before pricing.

**H10 · [Rubric/Done-ness clarity; SRS L5; Adv H4]** — Undefined thresholds on upload, processing and quality-check paths (FR5; Story 3.3 AC1; Story 3.4 AC2)
"Unsupported type/size/duration is rejected" and "run a quality check" name no limits. Resolution is dropped from validation, NFR-PERF-06 is dropped, and per-plan upload limits conflict with the MVP plan rule.
Fix: List the formats, max size, duration and resolution, the quality-check criteria and a processing-time bound, and state that MVP upload limits are global.

**H11 · [Adv H5]** — Content moderation, copyright and takedown are absent (FR4; FR5; Story 3.3; SRS Q-09; SRS FR-CON-13)
Slips serves merchant video from its own CDN, so copyrighted music, prohibited content and phishing CTA links become Slips's liability. An arbitrary "open link" CTA invites open-redirect abuse.
Fix: Restore Q-09. Require terms of use, an abuse-report channel, an admin takedown with CDN invalidation within 1 minute, and CTA links restricted to the store's domain or an allowlist.

**H12 · [Adv H7; SRS H9]** — Scheduling, CDN caching and price/stock freshness don't fit together (Story 4.2 AC1; Story 4.3 AC2; Story 3.6 AC2; Story 2.2 AC1; FR11; FR16)
A scheduled start or end has no triggering write, so cached content stays stale. Product changes must purge every linked item. Time budgets stack to 2+ minutes of unstated staleness, and the card price can differ from the cart price. The stack doc defers queues and the CDN.
Fix: Require a scheduler that emits invalidation at schedule boundaries and product-driven purges. Fetch price and stock live, or state a staleness bound. Write an end-to-end AC: "Salla change → storefront ≤ 2 min P95". Make the scheduler/queue and CDN purge required capabilities in `tech-stack.md`.

**H13 · [Adv H8; Rubric/Done-ness clarity]** — Webhook and integration lifecycle edge cases are missing, including deleted products (FR2; FR3; Story 1.3 AC2; Story 1.4; Stories 2.1–2.2; Story 6.2 AC2)
Missing: backfill for missed webhooks, out-of-order delivery, single-flight token refresh, a disconnected state, reinstall semantics, and order-status changes after attribution as a requirement. Story 2.2 AC2 routes deleted products to FR16, which covers only out-of-stock.
Fix: Add FRs for nightly reconciliation, event ordering, single-flight refresh, a disconnected state with merchant alert, reinstall semantics, attribution reversal, and deleted-product handling (auto-unpublish plus a merchant notice).

**H14 · [Adv H9]** — Several stories are too big for one dev session or are not dev work at all (§6; Stories 1.6, 5.2, 5.3, 6.2, 7.2, 7.4, 7.5, 7.6)
"Salla review passed" and "pilot merchants onboarded" are business outcomes. Story 7.5 bundles legal work, 7.4 is a cross-cutting audit, and 6.2 packs the hardest logic in the product into three ACs.
Fix: Turn 7.6 into milestones. Split 7.5 into dev and legal tasks, 6.2 into ingestion/matching/reversal/methodology, and 5.2/5.3 into core, gestures + RTL, and renditions. Move i18n and a11y into each story's DoD.

**H15 · [Adv H10; Rubric/Done-ness clarity; SRS L7]** — Metric definitions come after the screens that show them, and the four KPIs are unnamed (Story 3.1 AC1; Story 6.3 AC2; Story 6.4 AC1; FR15; Story 6.5)
Epic 3 shows views and clicks before Epic 6 defines them. The funnel rate basis and "Engagement" vs "CTR" are unresolved, and FR-DASH-02 % change and the FR-DASH-04 columns are dropped. UX can't design these screens and QA can't test them.
Fix: Put exact metric formulas into the PRD now (view, unique viewer, completion, CTR denominator, funnel rates). Name the four KPIs with % change and list the columns. Make Story 6.5 a prerequisite.

**H16 · [Rubric/Downstream usability]** — No glossary while core terms drift (whole PRD; Story 6.5 AC1)
"Placement" vs "visibility rules", "injector" vs "player" vs "loader" vs "script", and the drifting status sets will produce inconsistent data models and UI copy.
Fix: Add a Glossary before §2 defining Content item, Story, Reel, Format, Layout, Placement, Visibility rule, Injector, Player, Injector key, View, Unique viewer, CTR, Engagement, Completion, Touch, Attributed order and Attributed revenue.

**H17 · [Adv H11]** — Event ingestion can be spoofed, and everything downstream inherits the inflation (Story 6.1 AC1, AC3; FR12)
The beacon is public and keyed by a public identifier. A competitor, a bot or the merchant can inflate views and clicks or fake add-to-cart events to feed attribution. Client retries without idempotency keys double-count, and "validated" is undefined.
Fix: Require idempotency IDs, server-side dedup, per-session plausibility checks and origin checks. Accept add-to-cart for attribution only when it is backed by a confirmable Salla cart state. Bring FR-ANA-12 into the MVP.

**H18 · [SRS H4; Rubric/Done-ness clarity; SRS L3]** — Embedding layout and display options have no merchant-facing configuration (Story 5.5 AC2; Story 4.1; FR10; FR17/Story 7.1 AC2; SRS FR-INJ-10, FR-SET-02)
No story says where a merchant picks the layout, position or width. FR10 cites FR-INJ-10 without stating it, and the format × layout relationship is unstated.
Fix: Add layout and options to the placement rule (FR8/Story 4.1) and default display options to Story 7.1. Give the format × layout matrix, state the three layouts in FR10, and flag the data-model addition for the architect.

**H19 · [SRS H5; Adv M1]** — The player byte budget is ambiguous, mis-scoped and measured unreliably (Goal 4; NFR1; NFR2; Story 1.2 AC1–AC2; SRS NFR-PERF-01)
Story 1.2 gates the whole player, which forbids the on-demand modules the SRS allows. HLS on Android/desktop needs an MSE library that can't fit. Also: the ~20 KB core has no gate, gzip vs brotli and the scope of "initial" are unstated, "any measurable shift" will be flaky, "typical 4G" is undefined, and merchant CSP is not considered.
Fix: Gate the initial (eager) payload at 50 KB gzip, warn at 20 KB core, and set per-chunk budgets. Decide progressive MP4 vs lazily loaded HLS. Measure CLS as a delta on named themes, define the network profile and device, and add a CSP check to the spike.

**H20 · [Rubric/Shape fit]** — No user journeys for a multi-stakeholder, consumer-facing product (whole PRD; §3 screens only)
The UX agent has nothing to build onboarding, empty states or the shopper's watch → card → cart → continue flow from. The activation journey exists only implicitly across six epics.
Fix: Add 3–4 UJs with named protagonists: Merchant Owner first-week activation, Content Staff scheduling a campaign, a mobile Shopper through add-to-cart, and Merchant Owner verifying attributed revenue.

### Medium (26)

**M1 · [Rubric/Decision-readiness ×2; SRS M7; Adv L3]** — Open-questions list truncated and stale (§7; SRS §9.3)
Q-07 (multi-platform, which affects the integration layer), Q-08 (non-video slides), Q-09 (moderation) and Q-10 (support model) are dropped. Q-06 is rhetorical, since Epic 9 already answers it.
Fix: Carry over Q-07 to Q-10 with owners and due dates (Q-07 needs a platform-adapter-seam yes/no) and mark Q-06 resolved.

**M2 · [Rubric/Substance over theater; Adv L1]** — Differentiation claim unverified and partly out of scope (§1 Background)
"Na3na3 offers shoppable video only" has no source, the MVP wedge is not testable, and "(later) AI" is not MVP.
Fix: Cite the source and date. Name one or two MVP-deliverable differentiators with evidence (attribution credibility, player weight), and drop "later AI" from the pitch.

**M3 · [Rubric/Done-ness clarity]** — Behavior when multiple items match a placement is undefined (FR8; FR9; Story 4.3 AC1)
Fix: State the MVP ordering rule (e.g. most-recent-first) and a per-placement cap.

**M4 · [Rubric/Done-ness clarity; Adv L6]** — Vague bounds and weak AC wording (FR10; Story 2.1 AC3; Story 2.3 AC3; Story 3.3 AC1; Story 5.2 AC2; Story 5.3 AC2; Story 1.2 AC2; NFR2; Story 7.2 AC3; Story 7.5 AC2)
"Fails gracefully", "clear error", "retried" (no count or backoff), "visibly flagged", unversioned browsers, "typical 4G", "grace period" and "retention rules implemented" all lack bounds.
Fix: Inline the numbers, most of which exist in the SRS: error copy keys, retry policy, browser/version matrix, grace length, retention periods.

**M5 · [Rubric/Scope honesty; SRS M10]** — "Inherits basic store theme colors" pulls deferred FR-INJ-08 into the MVP and conflicts with Shadow DOM (§3)
Shadow DOM blocks theme rules, so only CSS custom properties cross the boundary.
Fix: Mark it as a non-goal for MVP, or make it an explicit FR with a custom-property mechanism documented in `tech-stack.md`.

**M6 · [Rubric/Scope honesty]** — No Non-Goals section or Assumptions index (whole PRD)
Silent assumptions are not ruled out: one user per store, SAR only, no moderation, one product per content. The SRS `[Assumption]` tags were lost in FR2, FR6 and FR16.
Fix: Add a Non-Goals list and an Assumptions index.

**M7 · [Adv M2]** — Scope creep and duplicate features in the MVP (Story 3.5 vs Story 7.3/FR18; Story 3.3 AC3; FR5; FR6; FR13; Story 7.2 AC4; Story 6.3 AC1)
Two preview systems is twice the work for the same answer. External links, auto-publish, a configurable window and a trial each add edge cases to a launch that is already gated on a spike.
Fix: Merge 7.3 into 3.5 or use a real-storefront preview token. Cut the optional features unless pilots demand them.

**M8 · [Adv M3]** — External media links have two behaviors and no rules (Story 3.3 AC3)
"Stored as references" means hotlinking, which bypasses transcoding, the budget, moderation and CSP.
Fix: Always ingest with SSRF protection and limits, or remove external links from the MVP.

**M9 · [Adv M4]** — Upload security details are missing (Story 3.3 AC1–AC2; NFR3)
Fix: Allowed MIME types with magic-byte checks, EXIF/GPS stripping, an SVG ban, tenant-scoped expiring direct-upload URLs, and scan-before-publish with a quarantine state.

**M10 · [Adv M5]** — The RTL interaction model for the player is undefined (NFR5; §3; Stories 5.2–5.3)
Tap edges, progress fill, ring order, swipe direction, numerals, SAR formatting (NFR-LOC-02 dropped) and bidi are left to each developer's guess.
Fix: Add an RTL gesture → action table, a numeral/currency policy and bidi isolation rules as a required UX input.

**M11 · [Adv M6; SRS L11]** — Story dependencies and ordering are broken (Stories 2.3, 3.1, 3.2, 3.4 AC3, 4.1 AC2, 6.4)
Stories show Epic 6 data before it exists, the product selector needs Epic 2, publish needs Epic 4, and auto-publish without a placement is undefined.
Fix: Add "Depends on" fields, show placeholders until Epic 6 (or move the columns), and keep placement-less auto-published content in Draft with a reason.

**M12 · [Adv M7; SRS M8; SRS impl-detail]** — §4 Technical Assumptions is stale against `docs/tech-stack.md` and makes vendor/stack choices that belong in architecture (§4; Story 1.1 AC3)
NestJS, Drizzle and Shadow DOM go unmentioned. "The demo is Vercel-hosted" is not a reason to pick a stack. The Mux/Cloudflare Stream choice is a vendor decision. Staging is built before Q-05.
Fix: Point §4 at `tech-stack.md` and keep only constraints (renditions, posters, processing SLA, style isolation). Make Q-05 an input to Story 1.1, or use synthetic data in staging.

**M13 · [Adv M8; SRS L2]** — Availability and backup NFRs are undefined and weakened (NFR7; NFR8)
"Storefront services 99.9%" has no SLI, window or exclusions. The dashboard 99.5% target, PITR and quarterly restore tests were dropped.
Fix: Define SLIs per service (content API, ingestion, player render success) and restore the SRS targets.

**M14 · [Adv M9]** — Merchant token handling is under-specified (FR1; NFR3)
Fix: An NFR covering the OAuth scope list, KMS-backed encryption, no plaintext in logs, access audit logging and a revocation runbook.

**M15 · [Adv M10]** — Currency, VAT and price display are unaddressed (FR3; FR11; FR14)
Fix: Report in the store's base currency, have the card show the price the cart will charge (sale price included), and exclude VAT and shipping from revenue.

**M16 · [Adv M11]** — The content status state machine is incomplete (FR6; Story 3.4 AC2; Story 3.6; FR19)
Archived, Processing, Failed, Ready and plan-Deactivated have no tab, no transitions and no rule for which count toward limits. See also H2 (FR-CON-03).
Fix: Add a status diagram covering transitions, storefront visibility, limit counting and filter behavior.

**M17 · [SRS M1]** — FR2 weakens FR-AUTH-05 on uninstall and retention (FR2; Story 1.4 AC3)
Fix: Restate FR2 in full, including "stop billing-related processing", and add "30-day grace; reinstall restores; then purge [NFR-DATA-01]".

**M18 · [SRS M3]** — NFR3 weakens at-rest encryption (NFR3; SRS NFR-SEC-01)
Fix: Use the SRS wording: TLS 1.2+ and all data encrypted at rest, backups included.

**M19 · [SRS M4]** — Out-of-stock behavior cites the wrong requirement and drops three-state availability (FR16; Stories 2.2, 2.3, 4.3)
Fix: Cite FR-PRD-05 (basic form) and FR-VIS-07, add Available/Low/Out of stock to Story 2.3 AC1, and note Appendix B item 3.

**M20 · [SRS M5]** — FR-INJ-04/07 weakened: data saver, reduced motion and storefront-language detection have no ACs (FR10; Stories 5.2–5.3)
Fix: Add the ACs.

**M21 · [SRS M6]** — Phase 2/3 epic outlines omit SRS-assigned requirements, and "variants" is ambiguous (§5 Epics 8, 9)
Fix: Use the SRS §10.2/§10.3 ID lists, and rename the item to "product variants (FR-PRD-08)".

**M22 · [SRS M9]** — Architecture sequencing conflicts with Epic 1 (§8; Stories 1.1–1.3)
Scaffolding, the data model and auth are built before any architecture exists, and the PO "shard" step duplicates existing stories.
Fix: Do architecture first and run spikes 1.5/1.6 in parallel, then update the architecture. Clarify the PO step.

**M23 · [SRS M11]** — Full-screen overlays, fonts and a11y inside Shadow DOM are not covered (Stories 5.2–5.3; NFR5/NFR6)
Fix: Mount the full-screen viewer on `document.body`, declare fonts in the light DOM, and choose a focus-trap/scroll-lock approach.

**M24 · [SRS M12]** — Analytics at scale on Postgres/Drizzle is underspecified (NFR2; §4; Story 6.1)
Fix: Document the partitioning strategy (custom SQL migrations), daily rollups, an ingest queue and the trigger for moving to a columnar store.

**M25 · [SRS M13]** — No tenant-isolation mechanism is chosen (NFR3; Story 7.5 AC1)
Fix: Decide between Postgres RLS with a per-request store ID and a mandatory scoped repository layer.

**M26 · [SRS M14]** — Preview surfaces should reuse the real player (FR7/Story 3.5; FR18/Story 7.3)
Fix: Embed `packages/player` in preview mode with mock cart actions, and add matching ACs.

### Low (12)

**L1 · [Rubric/Substance over theater]** — Adjective UI goals (§3 "clean, modern, merchant-friendly")
Fix: Replace with "match the demo, with the deviations listed in SRS Appendix B".

**L2 · [Adv L2]** — A live demo URL is the UI specification of record (§3 `slips-sage.vercel.app`)
Fix: Snapshot the demo into the repo and treat it as a reference, not the spec.

**L3 · [Rubric/Scope honesty; SRS L8]** — SRS Appendix B items 3–5 not addressed (Story 6.5 AC2)
Fix: Assign out-of-stock guidance, funnel rate basis and the Visibility rules link to stories or to open items, and hide the item-5 link in the MVP.

**L4 · [Rubric/Downstream usability]** — Cross-refs don't resolve standalone (Story 4.3 AC3; Story 2.2 AC2; Story 5.4 AC3)
Fix: Inline the tagging mechanism in Story 5.4 once spike findings land.

**L5 · [Adv L4]** — The store time zone is assumed to be available (Story 4.2 AC1)
Fix: Confirm it in the spike; otherwise default to Asia/Riyadh with a merchant setting.

**L6 · [Adv L5]** — The story sizing claim can't be tested (§6)
Fix: Replace it with a heuristic, e.g. ≤ 5 ACs, one deployable surface and no external-party dependency.

**L7 · [SRS L1]** — Non-specific SRS ID references hide what was dropped (NFR7; NFR8)
Fix: Cite exact IDs (NFR-AVAIL-01/02, NFR-OBS-01/02, NFR-MNT-01, NFR-BKP-01).

**L8 · [SRS L4]** — FR12 drops quartile progress and "share (if enabled)" (FR12)
Fix: Say "quartile progress", and include share or mark it out of MVP.

**L9 · [SRS L6]** — Settings details dropped: disconnect and explicit save with confirmation (Story 7.1 AC1; FR17)
Fix: Add both as ACs.

**L10 · [SRS L9]** — Shared Zod schemas could leak into the player bundle (`tech-stack.md`; NFR1)
Fix: Add Turborepo boundaries so `packages/player` uses type-only imports, with no runtime Zod or Drizzle.

**L11 · [SRS L10]** — Wording inconsistencies inside stories (Story 3.6 AC2; Story 2.2 AC1; Goals)
Fix: Use "within one minute" consistently, and mark PRD-originated targets and goals as such.

**L12 · [SRS impl-detail]** — Mechanisms stated where outcomes belong (Story 3.3 AC2; Story 4.3 AC1; Story 6.1 AC1; Story 1.2 AC2; Story 1.1 AC1; §4 storage/queue)
Fix: State the outcomes (isolation, cacheability, delivery on unload, automated CLS test) and reference `tech-stack.md` for the monorepo layout.

## Mechanical notes

- Glossary drift: "placement" (Story 4.1, 5.5, 7.2, FR19) vs "visibility rules" (FR8, Epic 4) vs the "Visibility rules" screen (SRS).
- Glossary drift: "injector" (FR9, NFR1) vs "player" (FR10, Story 1.2) vs "loader" (Story 5.1) vs "script" (Story 1.5, 1.6). The size budget applies to the "injector initial payload" in NFR1 but to the "player's gzip size" in Story 1.2.
- Glossary drift: content statuses are FR6 tabs "All, Published, Scheduled, Drafts", Story 3.4 "Processing/Failed/Ready" and Story 3.6 "Archived". "Ready" vs "Published" is unreconciled.
- Glossary drift: the screen name "Videos & Stories" (§3) vs the product nouns "Stories and Reels". "Engagement" vs "CTR" is acknowledged as unresolved (Story 6.5). "Tags the session" (Story 1.6 AC1) vs "tagged sessions or clicks" (Story 6.2 AC1).
- ID continuity: FR1–19, NFR1–8, Epics 1–9 and Stories 1.1–7.6 are contiguous and unique. FR16 is cited for deletion behavior it does not define (Story 2.2 AC2). §4 "Q-05" resolves to §7. SRS FR-AUTH-03/04 are implemented in Story 6.4 AC2 and Story 1.3 AC3 but not cited by any FR. FR-CON-03/13/17 and FR-NOT-03 are cited nowhere.
- Assumptions Index roundtrip: there is one inline tag ("Candidate stack [Assumption]", §4) and no index. The SRS `[Assumption]` items inherited by FR2 (30-day retention), FR6 (statuses) and FR16 (stock behavior) lost their tags.
- UJ protagonist naming: there are no UJs. Story actors are inconsistent ("the team", "the business", "the player", "As a user" in Story 7.4).
- Required sections for launch stakes: Success Metrics/counter-metrics, Non-Goals, Glossary, User Journeys and a Risks section are missing. SRS R-01–R-08 were not carried over, although R-02 and R-04 drive Epic 1 and NFR1. The change log names "Product owner" rather than a person.
- Minor: NFR2 drops the SRS qualifier "for a 30-day range" on the analytics P95. NFR7 drops the dashboard 99.5% target. Story 3.6 AC2 says "immediately" and "≤ 1 minute" in the same breath.

## Reviewer files

- `review-rubric.md`
- `review-adversarial-general.md`
- `review-srs-stack-consistency.md`
