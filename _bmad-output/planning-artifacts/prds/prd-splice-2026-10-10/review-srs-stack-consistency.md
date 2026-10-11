# Review: PRD vs SRS vs Tech Stack Consistency (Slips)

**Reviewed:** `docs/prd.md` (v0.1, 10 Oct 2026), `docs/Slips_SRS_v0.1.md` (v0.1, 7 Oct 2026), `docs/tech-stack.md`
**Date:** 10 Oct 2026
**Scope:** (1) SRS MVP requirements dropped or weakened, (2) bad or misleading SRS ID references, (3) PRD vs SRS contradictions, (4) PRD vs stack conflicts and stack gaps, (5) implementation detail in the PRD that belongs in architecture.

## Verdict

The PRD follows the SRS functional scope for the MVP closely. Every bracketed ID it cites exists in the SRS, and the epic/story breakdown is coherent. It is **not yet a faithful derivative**, though. SRS §10.1 says MVP includes "All of Section 5" and FR-NOT-03, but the PRD silently drops a whole support requirement (FR-NOT-03), the internal admin console (NFR-OBS-02), the compatibility NFRs (NFR-COMP-01 to 03), data retention (NFR-DATA-01 to 03), cost/abuse control (NFR-COST-01/02), and several performance, scalability and availability targets. Several Must FRs (FR-AUTH-03, FR-AUTH-04, FR-CON-03, FR-CON-13, FR-CON-17) are never cited and are only partly covered by stories. Embedding layouts have no merchant-facing configuration story. The player budget is worded ambiguously ("player's gzip size") in a way that clashes with SRS on-demand modules and with adaptive video playback. Section 4 of the PRD is stale against `tech-stack.md`. The stack doc does not address several architecture-shaping PRD needs: zero CLS with an async-loaded Shadow DOM Web Component, theme-color inheritance across the shadow boundary, CDN caching vs. scheduled publishing, the public-but-"secret" injector key, queues and partitioning for analytics in Postgres/Drizzle, the admin console, and dashboard preview reuse of the player. No finding blocks the PRD outright. The high findings should be fixed before UX and architecture work starts, because they change screens, NFR acceptance and the monorepo layout.

**Counts:** Critical 0 · High 9 · Medium 15 · Low 11

---

## High

### H1. FR-NOT-03 (support entry point) dropped entirely
- **Location:** PRD §2 Functional (no FR), §3 UI Design Goals, Epic 7. SRS FR-NOT-03 (M), included in MVP via SRS §10.1 "Support | FR-NOT-03".
- **Problem:** SRS requires "A 'Need help? Contact support' entry point shall be available on every page." The PRD has no FR, story or UI goal for it. It is part of the app shell (every page) and is likely to be checked in Salla review. Related open question Q-10 (support model, languages, hours, SLAs) is also missing from PRD §7.
- **Fix:** Add `FR20 Support entry point on every dashboard page [FR-NOT-03]`, add an AC to Story 7.1 or a new Story 7.x, list it in §3 Key screens/shell, and add Q-10 to §7.

### H2. Section 5 NFRs silently dropped despite "All of Section 5" in MVP
- **Location:** PRD §2 Non-Functional (NFR1-NFR8). SRS §10.0 rule 2 ("Non-functional requirements apply from the MVP") and §10.1 "Non-functional | All of Section 5".
- **Problem:** These SRS NFRs have no PRD NFR, citation or story:
  - **NFR-COMP-01** theme compatibility matrix; **NFR-COMP-02** browser matrix ("iOS Safari (last 3), Android Chrome (last 3), Samsung Internet, desktop … last 2"); **NFR-COMP-03** no global-namespace pollution / style isolation. Story 5.2 AC2 narrows support to "iOS Safari and Android Chrome", which drops Samsung Internet and desktop.
  - **NFR-DATA-01** 30-day post-uninstall grace then delete; **NFR-DATA-02** raw event retention (~13 months); **NFR-DATA-03** merchant export/deletion requests. The PRD only says "apply the retention policy" (FR2) and "retention rules implemented" (Story 7.5 AC2).
  - **NFR-COST-01/02** per-store metering of storage/bandwidth and abuse throttling.
  - **NFR-REL-01** automatic retry of failed media jobs (Story 3.4 has a failure state but no retry).
  - **NFR-PERF-06** 60-second video processed within 5 minutes P95; **NFR-PERF-07** no meaningful Core Web Vitals regression vs a baseline store.
  - **NFR-SCAL-01** ~5,000 concurrently active stores and 10x seasonal peaks.
- **Fix:** Add NFR9 Compatibility [NFR-COMP-01 to 03], NFR10 Data retention [NFR-DATA-01 to 03], NFR11 Cost and abuse control [NFR-COST-01, 02], and extend NFR1/NFR2/NFR7 with PERF-06, PERF-07, SCAL-01 and REL-01. Correct Story 5.2 AC2 to reference the NFR-COMP-02 matrix. Give these NFRs explicit ACs in Story 1.2 (CWV baseline), Story 3.4 (processing SLA, retry) and Story 7.5 (retention jobs, export/deletion handling).

### H3. Internal admin console (NFR-OBS-02) dropped, and the stack has no place for it
- **Location:** PRD NFR8 cites "[NFR-OBS, …]" but the text covers only "Logging, metrics, alerting". SRS NFR-OBS-02: "An internal admin console shall allow support staff to look up a store, its sync state, jobs, and plan usage." SRS §2.3 user class "Slips Admin (internal)". `tech-stack.md` repo layout has only `apps/dashboard`, `apps/api` and `packages/player`.
- **Problem:** This is a whole user class and UI surface, with its own auth model (internal staff, not Salla OAuth). Dropping it removes a story set and leaves the architecture without an admin app or route group. NFR-OBS-01 "tracing" and the named signals (queue depth, Salla API failures, injector error rates) are also missing.
- **Fix:** Add an NFR or FR for the admin console and a story in Epic 7. In `tech-stack.md`, decide between `apps/admin` and an admin route group in `apps/dashboard` with separate auth. Expand NFR8 to list the NFR-OBS-01 signals, including tracing and injector error-rate reporting from the player.

### H4. Embedding layout and display options have no merchant-facing configuration (FR-INJ-10, FR-SET-02)
- **Location:** PRD Story 5.5 AC2 "Layout is selected per placement"; Story 4.1 (placement has no layout field); FR17 / Story 7.1 AC2 (Injector tab without "default display options"). SRS FR-INJ-10 ("product-page strip (below images or custom position), a home/category carousel (boxed or full width), and a full-screen Reels experience"), FR-SET-02 ("…installation guide, and default display options").
- **Problem:** No story says where or how a merchant picks the layout, the position ("below images or custom position") or the width ("boxed or full width"). The SRS sub-options are dropped. UX will have no screen for it, and the data model (VisibilityRule has no layout field in SRS §6) will miss it.
- **Fix:** Add ACs to Story 4.1 (layout and options per placement) and Story 7.1 (default display options). Note the data-model addition for the architect.

### H5. Player budget wording conflicts with the SRS and with adaptive video
- **Location:** PRD Goals "target ≤ 50 KB initial, ~20 KB core"; NFR1 "Injector initial payload ≤ 50 KB"; Story 1.2 AC1 "CI fails if the player's gzip size exceeds 50 KB". SRS NFR-PERF-01 "initial payload ≤ 50 KB (target ~20 KB gzip for the core loader), with additional modules loaded on demand"; SRS §8 "must match the claim" (competitor ~20 KB). `tech-stack.md` "Budget from the PRD".
- **Problem:** (a) Story 1.2 measures the whole "player" instead of the initial payload. This forbids on-demand modules that the SRS explicitly allows, and FR-INJ-06 adaptive rendition will need them. If the managed video service in PRD §4 delivers HLS, Android Chrome and desktop browsers need an MSE player such as hls.js, which alone is in the tens of KB gzip and cannot fit inside a 50 KB total next to Preact, i18n strings and UI. (b) The ~20 KB core target, which is the competitive-parity number, has no CI gate. (c) The SRS does not say whether "50 KB" is gzip or raw; the PRD assumes gzip without stating it. (d) `tech-stack.md` cites the PRD as the budget source, but the SRS is the stated source of truth.
- **Fix:** Reword Story 1.2 AC1: "CI fails if the initial (eagerly loaded) player payload exceeds 50 KB gzip. CI warns if the core loader exceeds 20 KB gzip. Lazily loaded chunks have their own per-chunk budgets." In `tech-stack.md`, note Vite code-splitting for the player, an explicit decision on adaptive streaming (progressive MP4 renditions chosen by the player vs HLS with a lazily loaded MSE library), and cite the SRS NFR-PERF-01 as the budget source.

### H6. Zero layout shift with an async-loaded Shadow DOM Web Component is unaddressed
- **Location:** PRD NFR1 "no layout shift; non-blocking"; Story 5.1 AC1 "Loader is async"; Story 5.5 AC1 "All three layouts reserve space". SRS NFR-PERF-02 and exit criterion "zero measured layout shift on at least three representative themes". `tech-stack.md` "Mounted as a Web Component (`<slips-player>`) with Shadow DOM".
- **Problem:** Until the async script defines `<slips-player>`, the host element is an unknown inline element with no size. Space can only be reserved if the injected markup or theme CSS sets the dimensions before the script runs (for example, a sized wrapper or `slips-player:not(:defined){…}` in light-DOM CSS). Whether the app can inject that depends on the Salla snippet mechanism (Q-01). Neither the PRD nor the stack doc names this constraint. The PRD also drops the "three representative themes" condition from the exit criteria.
- **Fix:** Add to Story 1.5 AC: "Determine whether markup and CSS for size reservation can be injected before the player script runs." Add "on at least three representative themes" to Story 1.2 AC2 or Story 7.6. In `tech-stack.md` open decisions, add "CLS-safe placeholder strategy for the Web Component (light-DOM sizing before definition)".

### H7. Injector key is treated as a secret but is public by design
- **Location:** PRD FR17 "injector key (masked, copy, regenerate)"; NFR3 "encrypted tokens/keys"; Story 4.3 AC1 "keyed by injector key"; Story 7.1 AC2 "regenerate (old key invalidated)". SRS NFR-SEC-02 "injector keys shall be stored encrypted"; FR-SET-04 "prompt for re-installation".
- **Problem:** The key ships in every storefront page and is used as a CDN cache key, so it is public. If it is stored with reversible encryption it cannot be indexed for lookup on the hot content API path. Regeneration also needs CDN purge and theme re-installation; if Salla's snippet mechanism injects the key automatically, "prompt for re-installation" may not apply. The PRD inherits this tension without flagging it, and the stack doc does not cover it.
- **Fix:** Add an open item for the architect: decide whether the injector key is a public store identifier (masked only for UX) or a secret, and how it is stored (for example, a hashed lookup column). Add a CDN purge AC to Story 7.1 AC2. Keep Salla access tokens encrypted, since those are real secrets.

### H8. Must FRs never cited and only partly covered (FR-AUTH-03, FR-AUTH-04, FR-CON-03, FR-CON-13, FR-CON-17)
- **Location:** PRD §2 Functional. SRS §10.1 includes FR-AUTH-01 to 05 and FR-CON-01 to 13 plus FR-CON-17.
- **Problem:**
  - **FR-AUTH-03** onboarding checklist ("connect store, sync products, install the injector, create the first content") appears only as "onboarding checklist" in Story 6.4 AC2 (Epic 6). The steps are not listed, and it is far from the install flow.
  - **FR-AUTH-04** appears only in Story 1.3 AC3, with no FR.
  - **FR-CON-03** statuses "Draft, Scheduled, Published, plus Archived and Processing/Failed". The PRD never defines the status model, and Story 3.4 AC2 invents "Ready", which is not an SRS status.
  - **FR-CON-13** CTA "action (add to cart / open product / open link), and, optionally, style". FR4 says only "CTA", and Story 3.2 says "CTA label and action" without enumerating actions. "Open link" needs URL validation (NFR-SEC-05).
  - **FR-CON-17** is covered by FR8 but not cited, so traceability tools will miss it.
- **Fix:** Add FR-AUTH-03/04 to FR1 or a new FR, with the four checklist steps in an Epic 1 or Epic 3 story. Add a status-model FR [FR-CON-03] and replace "Ready" with an SRS status or record it as an SRS change. Expand FR4 or Story 3.2 with the three CTA actions and optional style [FR-CON-13]. Cite FR-CON-17 in FR8.

### H9. CDN caching vs scheduled publishing, stock changes and archive
- **Location:** PRD Story 4.2 AC1 "goes live at the set time"; Story 4.3 AC2 "invalidated within one minute of changes"; Story 3.6 AC2 "removed from the storefront immediately (cache invalidated ≤ 1 minute)"; FR16 / Story 2.2 (stock). SRS NFR-SCAL-02, FR-PRD-06 "always reflect the latest synced data". `tech-stack.md` lists no scheduler, queue or CDN.
- **Problem:** Scheduled start/end is a time-based change with no triggering write, so event-driven invalidation alone will serve stale content past the start or end time. Product price and stock webhooks must also purge content-API entries for every content item linked to that product. The PRD says "within one minute of changes" but does not specify scheduled transitions or product-driven purges. The stack doc defers queues and jobs entirely ("Open decisions … background jobs/queues").
- **Fix:** Add ACs: "Scheduled start/end transitions take effect within one minute," and "product price/stock changes invalidate the cached content of linked items within one minute." In `tech-stack.md`, move "job scheduler/queue" and "CDN with purge API" from open decisions to explicitly required capabilities.

---

## Medium

### M1. Data retention and uninstall: FR2 weakens FR-AUTH-05
- **Location:** PRD FR2 [FR-AUTH-05]. SRS FR-AUTH-05 "…stop billing-related processing, and apply the data-retention policy (Section 5.4)".
- **Problem:** "Stop billing-related processing" is dropped, and the retention policy (30 days, then delete) is undefined in the PRD. Story 1.4 AC3 covers only deactivation.
- **Fix:** Restate FR2 in full. Add an AC: "Uninstall starts a 30-day grace period [NFR-DATA-01]; reinstall within the period restores data; after it, data is purged."

### M2. NFR3 cites NFR-SEC-04 (RBAC), which the MVP cannot satisfy
- **Location:** PRD NFR3 "[NFR-SEC-01 to 07]". SRS NFR-SEC-04 "Role-based access control … (Section 3.12)". Team roles (FR-SET-03/05, FR-AUTH-06) are deferred to Phase 2 (SRS §10.1 "Explicitly deferred: … team roles").
- **Problem:** The citation claims RBAC coverage that is out of MVP scope. This is an SRS-internal tension that the PRD hides instead of resolving.
- **Fix:** Cite "NFR-SEC-01 to 03, 05 to 07" and add a note: "NFR-SEC-04 applies from Phase 2 when roles ship. MVP is a single-owner account." Or define an MVP single-role baseline explicitly.

### M3. NFR3 weakens at-rest encryption
- **Location:** PRD NFR3 "TLS everywhere, encrypted tokens/keys". SRS NFR-SEC-01 "TLS 1.2+; data at rest shall be encrypted".
- **Problem:** The TLS minimum version and encryption of all data at rest (database, object storage, backups) are lost.
- **Fix:** Use the SRS wording.

### M4. Out-of-stock behavior cites the wrong requirement
- **Location:** PRD FR16 "basic out-of-stock handling (CTA disabled, 'Out of stock') … [… FR-VIS-07]"; Stories 2.2 AC2 and 4.3 AC3 "per FR16". SRS §10.1 "FR-PRD-05 in **basic form**".
- **Problem:** FR-VIS-07 only delegates to FR-PRD-05, and FR-PRD-05 is the requirement actually implemented in basic form. Low-stock "Few left" and the Products page "Available / Low / Out of stock" (FR-PRD-03) are also dropped. FR16 says only "availability", and Story 2.3 flags only out-of-stock.
- **Fix:** Cite "FR-PRD-05 (basic form), FR-VIS-07". Add the three-state availability to Story 2.3 AC1. Note SRS Appendix B item 3 (guidance on promoting unavailable products) as an open UX item.

### M5. FR-INJ-04 and FR-INJ-07 weakened
- **Location:** PRD FR10 "muted autoplay … RTL/LTR"; Stories 5.2 and 5.3. SRS FR-INJ-04 "respect device and browser settings (autoplay, data saver, reduced motion)"; FR-INJ-07 "follow the storefront language".
- **Problem:** Data saver and reduced motion are dropped from player behavior. Reduced motion appears only in the general a11y NFR6. There is no AC for detecting the storefront language.
- **Fix:** Add ACs to Story 5.3 for data saver and reduced motion and to Story 5.2/5.3 for storefront language detection.

### M6. Phase 2 and Phase 3 epic outlines omit SRS-assigned requirements
- **Location:** PRD §5 "Epic 8 (Phase 2)" and "Epic 9 (Phase 3)". SRS §10.2 and §10.3.
- **Problem:** Epic 8 omits FR-ANA-09, FR-ANA-12 (bot filtering), FR-CON-14, FR-CON-16, FR-VIS-05, FR-VIS-06, configurable FR-PRD-05, FR-PRD-07, FR-INJ-08, FR-PRV-04 and FR-SET-08. Epic 9 omits FR-AI-10, FR-BUY-03, FR-PRV-02, full theme customization and FR-INT-01 (text and image cards). "Variants" in Epic 8 is ambiguous (product variants FR-PRD-08 vs A/B variants FR-EXP).
- **Fix:** Replace the prose lists with the SRS §10.2/§10.3 ID lists, or say explicitly "see SRS §10.2 for the full list". Rename "variants" to "product variants (FR-PRD-08)".

### M7. Open questions list truncated (Q-07 to Q-10 missing; Q-06 already resolved)
- **Location:** PRD §7. SRS §9.3.
- **Problem:** Q-07 (other platforms) affects architecture: SRS §10.4 says it "requires abstracting the platform integration layer early". Q-08 (non-video story slides in v1), Q-09 (moderation and abuse) and Q-10 (support model) are also missing. Q-06 (social import timing) is already answered by SRS §10.3 (Phase 3).
- **Fix:** Add Q-07 to Q-10 and mark Q-06 as resolved (Phase 3).

### M8. PRD §4 Technical Assumptions is stale against `tech-stack.md`
- **Location:** PRD §4 "Candidate stack [Assumption]: … vanilla/Preact player … Next.js … (the demo is Vercel-hosted)"; "to be confirmed by the Architect agent and the Epic 1 spike". `tech-stack.md` sets NestJS, Drizzle, drizzle-zod, Turborepo, Vite library mode, and the Web Component with Shadow DOM as the owner's defaults.
- **Problem:** Downstream agents reading the PRD get a different and vaguer stack (no backend framework, "vanilla/Preact", no style-isolation approach). "Vercel-hosted demo" is not a reason to pick a framework.
- **Fix:** Replace the candidate-stack bullet with a pointer to `docs/tech-stack.md`. Keep only constraints in the PRD, such as "player is a separately built bundle with style isolation [NFR-COMP-03]".

### M9. Architecture sequencing conflicts with Epic 1
- **Location:** PRD §8 "Architect agent: after Epic 1 findings, produce the architecture document". Story 1.1 AC1 (monorepo layout), Story 1.2 (CI budget), Story 1.3 (Store record, token encryption).
- **Problem:** Epic 1 builds scaffolding, CI, the data model and auth before any architecture exists, and `tech-stack.md` says the architecture step defines the defaults. Spike stories (1.5, 1.6) can come before architecture; scaffolding stories (1.1 to 1.4) cannot. §8 also asks the PO to "shard it into epics and stories", but the PRD already contains them.
- **Fix:** Split the plan: architecture first (stack, monorepo, data model baseline), spikes 1.5 and 1.6 in parallel, then an architecture update after the spike findings. Clarify the PO step.

### M10. "Inherits basic store theme colors" pulls deferred FR-INJ-08 into the MVP and conflicts with Shadow DOM
- **Location:** PRD §3 "storefront player inherits basic store theme colors". SRS FR-INJ-08 (S, Phase 2 per §10.2) and "theme customization" in the §10.1 deferred list. `tech-stack.md` Shadow DOM "so Salla theme CSS and player CSS cannot affect each other".
- **Problem:** This is unannounced scope added to the MVP. Technically, Shadow DOM blocks theme rules, so only inherited properties and CSS custom properties cross the boundary. Matching colors therefore needs a deliberate mechanism, such as reading Salla theme CSS variables or computed styles.
- **Fix:** Either remove it from MVP UI goals or make it an explicit MVP decision with an FR. In `tech-stack.md`, add "theme tokens cross the shadow boundary through CSS custom properties read from the Salla theme".

### M11. Full-screen overlays, fonts and a11y inside Shadow DOM are not covered by the stack
- **Location:** PRD Stories 5.2 and 5.3 (full-screen Story/Reels), NFR5/NFR6 (Arabic, WCAG AA, focus states). `tech-stack.md` Shadow DOM mounting.
- **Problem:** Full-screen viewers mounted inside a theme container can be clipped or mispositioned by ancestor `transform`, `overflow` or `z-index` rules. `@font-face` does not work when declared inside a shadow root, which matters for Arabic fonts. Focus trapping, scroll locking and ARIA ID references across the shadow boundary need explicit handling to reach WCAG 2.1 AA.
- **Fix:** In `tech-stack.md` add: "Full-screen viewer mounts in its own top-level host on `document.body`; fonts are declared in the light DOM; a focus-trap and scroll-lock approach is chosen for Shadow DOM."

### M12. Analytics at scale on Postgres/Drizzle is underspecified
- **Location:** PRD NFR2 "analytics queries ≤ 2 s P95"; §4 "Postgres partitions initially, ClickHouse later"; Story 6.1. SRS NFR-SCAL-01 (5,000 stores, 10x peaks), NFR-AVAIL-02, NFR-DATA-02. `tech-stack.md` "PostgreSQL … Drizzle … SQL-like queries keep the analytics … readable".
- **Problem:** High-volume event ingestion plus 30-day P95 ≤ 2 s queries needs time partitioning, rollup tables and an ingest buffer or queue. Drizzle Kit does not manage declarative partitioning natively, so custom SQL migrations would be needed. None of this is stated, and the ClickHouse escape hatch in PRD §4 is not mentioned in the stack doc.
- **Fix:** Add to `tech-stack.md`: event table partitioning strategy (custom SQL migrations alongside Drizzle), daily rollups for dashboards, an ingest queue, and the trigger for moving to a columnar store.

### M13. Tenant isolation mechanism not chosen
- **Location:** PRD NFR3 "strict tenant isolation"; Story 7.5 AC1. SRS NFR-SEC-03. `tech-stack.md` (NestJS + Drizzle, no isolation strategy).
- **Problem:** Tenant isolation has no enforcement pattern, such as Postgres RLS with a per-request store ID, or a mandatory scoped repository layer in NestJS. It is listed as a test target but has no design.
- **Fix:** Add a tenant-isolation decision to `tech-stack.md` open decisions, or make it a default.

### M14. Preview surfaces should reuse the real player
- **Location:** PRD FR7 / Story 3.5 (live vertical preview), FR18 / Story 7.3 (store preview with "Order now"). `tech-stack.md` (player is separate from the Next.js dashboard).
- **Problem:** If the dashboard reimplements the player in React, preview will drift from what shoppers see. The stack doc does not say whether `packages/player` is consumed by `apps/dashboard`, for example as a custom element in React.
- **Fix:** Add to `tech-stack.md`: "Dashboard previews embed `packages/player` (`<slips-player>`) in preview mode with mock cart actions." Add a matching AC to Stories 3.5 and 7.3.

### M15. Data residency vs hosted services
- **Location:** PRD §4 "Hosting: managed cloud; data residency decision pending (Q-05)"; "Video: … Mux or Cloudflare Stream". `tech-stack.md` (Next.js; demo on Vercel).
- **Problem:** If Q-05 requires KSA or in-region storage, the managed video service, CDN and dashboard hosting choices may all be invalid. Q-05 is not listed as a gating input in the stack doc.
- **Fix:** Add Q-05 to `tech-stack.md` open decisions as a constraint on hosting, video and CDN.

---

## Low

### L1. Non-specific ID references
- **Location:** PRD NFR7 "[NFR-AVAIL, NFR-SCAL-02]"; NFR8 "[NFR-OBS, NFR-MNT, NFR-BKP]".
- **Problem:** "NFR-AVAIL", "NFR-OBS", "NFR-MNT" and "NFR-BKP" are not SRS IDs; the SRS uses NFR-AVAIL-01/02, NFR-OBS-01/02, NFR-MNT-01 and NFR-BKP-01. Prefix citations hide what is dropped (see H3 and L2).
- **Fix:** Cite exact IDs.

### L2. Availability and backup targets weakened
- **Location:** PRD NFR7 "Storefront services 99.9%"; NFR8 "daily backups". SRS NFR-AVAIL-01 "dashboard 99.5%"; NFR-BKP-01 "point-in-time recovery; restore tested at least quarterly".
- **Fix:** Add the dashboard 99.5% target, PITR and quarterly restore tests.

### L3. FR10 cites FR-INJ-10 without stating it
- **Location:** PRD FR10 "[FR-INJ-02 to 07, 09, 10]".
- **Problem:** The FR text does not mention embedding layouts; only Story 5.5 does.
- **Fix:** Add "embeddable as product strip, carousel, or full-screen Reels" to FR10.

### L4. FR12 event list drops "share (if enabled)" and quartiles
- **Location:** PRD FR12 "progress". SRS FR-ANA-01 "quartile progress … share (if enabled)".
- **Fix:** Say "quartile progress" and either include share or mark it out of MVP.

### L5. Upload validation drops resolution
- **Location:** PRD Story 3.3 AC1 "type/size/duration". SRS FR-CON-08 "type, size, duration, resolution … Limits per plan".
- **Problem:** Resolution is missing. Plan-specific upload limits also conflict with the MVP plan rule that only content and placement limits apply (SRS §10.1); neither document resolves this.
- **Fix:** Add resolution and state that MVP upload limits are global, not per plan.

### L6. Settings details dropped
- **Location:** PRD Story 7.1 AC1 "reconnect". SRS FR-SET-01 "reconnecting or disconnecting"; FR-SET-06 "saved explicitly with a confirmation message ('Changes saved')".
- **Problem:** FR17 cites FR-SET-06, but no story has an AC for it.
- **Fix:** Add disconnect and explicit save with confirmation as ACs.

### L7. Dashboard KPI and list details
- **Location:** PRD Story 6.4 AC1. SRS FR-DASH-02 "percentage change versus the previous period" and the four named KPIs; FR-DASH-04 columns and "link to the full list".
- **Fix:** Name the four KPIs, add percentage change, and list the columns.

### L8. Appendix B items 3 to 5 unaddressed
- **Location:** PRD Story 6.5 AC2 "resolves SRS Appendix B items 1 and 2".
- **Problem:** Item 3 (out-of-stock guidance), item 4 (funnel rates relative to total views vs step-to-step) and item 5 (Visibility rules link with no screen) are not mentioned. Item 5 matters because the demo link exists but FR-VIS-05 is Phase 2.
- **Fix:** Assign each item to a story or to the open items list. For item 5, either hide the link in the MVP or note the deferral.

### L9. Shared Zod schemas must not leak into the player bundle
- **Location:** `tech-stack.md` "drizzle-zod to generate Zod schemas shared with the dashboard"; shared packages. PRD NFR1.
- **Problem:** If the player imports the shared schema or types package carelessly, Zod at runtime will consume a large share of the budget.
- **Fix:** In `tech-stack.md`, add Turborepo boundaries: `packages/player` may import type-only shared packages, with no runtime Zod or Drizzle.

### L10. Wording inconsistencies inside stories
- **Location:** Story 3.6 AC2 "removed … immediately (cache invalidated ≤ 1 minute)"; Story 2.2 AC1 "within one minute" (a new number not in the SRS); Goals "fund Phases 2-3 from pilot revenue" (not in the SRS).
- **Fix:** Use "within one minute" consistently and record new targets or assumptions as PRD-originated.

### L11. Story ordering dependencies
- **Location:** Story 2.3 AC1 (attributed orders) and Story 3.1 AC1 (views, clicks) depend on Epic 6 data. FR-AUTH-03 checklist in Story 6.4 depends on Epics 2, 3 and 5.
- **Fix:** Note that these columns show placeholders until Epic 6, or move the columns into Epic 6 stories.

---

## Implementation detail in the PRD that belongs in architecture (Section 5 of the review)

These are rated low to medium and are covered above where they cause conflicts:
- PRD §4 "use a managed video service (for example Mux or Cloudflare Stream) rather than a custom transcoding pipeline": a vendor and architecture decision (see H5, M15). **Medium.** Keep the requirement (adaptive renditions and posters within the NFR-PERF-06 SLA) and move the choice to architecture.
- PRD §4 "Postgres partitions initially, ClickHouse later if needed" and "queue for media and sync jobs": storage and queue design (see M12). **Low.**
- PRD §4 "Next.js … (the demo is Vercel-hosted)", "vanilla/Preact player": superseded by `tech-stack.md` (see M8). **Medium.**
- Story 3.3 AC2 "tenant-scoped paths"; Story 4.3 AC1 "keyed by injector key"; Story 6.1 AC1 "Batched beacon endpoint"; Story 1.2 AC2 "(Playwright)". These are mechanisms; state the outcome instead (isolation, cacheability, delivery under page unload, automated CLS test). **Low.** The beacon and CDN items originate in SRS §4.4 and NFR-SCAL-02, so they are acceptable as constraints.
- Story 1.1 AC1 "Monorepo contains dashboard, player, API, and shared packages": duplicates `tech-stack.md`. Reference it instead. **Low.**
