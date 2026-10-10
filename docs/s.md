# Slips (سليبس) Product Requirements Document (PRD)

**Version:** 0.1 (BMAD input) | **Date:** 10 Oct 2026 | **Scope:** MVP (Phase 1) in detail; Phases 2-3 as epic outlines
**Source of truth for detail:** `docs/Slips_SRS_v0.1.md` (requirement IDs such as FR-CON-05 are referenced in brackets)

---

## 1. Goals and Background Context

### Goals
- Ship a Salla App Store app that lets merchants publish **Stories and Reels** in their storefront.
- Let shoppers **add to cart from inside the content** without leaving the experience.
- Show merchants **attributed orders and revenue**, so the app proves its own ROI.
- Keep the storefront player **lightweight** (target ≤ 50 KB initial, ~20 KB core) with zero layout shift.
- Support **Arabic (RTL) and English (LTR)** throughout.
- Reach a pilot-ready MVP quickly, then fund Phases 2-3 from pilot revenue.

### Background
Salla merchants rely heavily on mobile shoppers, and short-form video drives purchase decisions. An existing competitor (Na3na3) offers shoppable video only. Slips differentiates with Stories + Reels, scheduling and visibility rules, order-level attribution, and (later) AI-generated Reels and audience insights.

### Change log
| Date | Version | Description | Author |
|---|---|---|---|
| 10 Oct 2026 | 0.1 | Initial BMAD PRD derived from SRS v0.1 | Product owner |

---

## 2. Requirements (MVP)

### Functional
- **FR1** Install from the Salla App Store and authenticate via Salla OAuth; tokens stored encrypted and refreshed automatically. [FR-AUTH-01, 02]
- **FR2** Handle app install and uninstall events; on uninstall, deactivate the injector and apply the retention policy. [FR-AUTH-05]
- **FR3** Sync products (name, image, category, price, availability) from Salla via webhooks plus manual sync; show last sync time. [FR-PRD-01, 02]
- **FR4** Create Stories and Reels with title, format, linked product, CTA, and multiple images/videos by upload or external link. [FR-CON-04 to 07]
- **FR5** Validate uploads, transcode videos into multiple renditions, generate posters, and run a quality check; optional auto-publish after a pass. [FR-CON-08 to 10]
- **FR6** List content with status filters (All, Published, Scheduled, Drafts); edit, duplicate, archive, delete. [FR-CON-01, 02, 11]
- **FR7** Live vertical preview while editing content. [FR-CON-12]
- **FR8** Define visibility rules (home, category, product page; optional target ID) and scheduled start/end. [FR-VIS-01 to 04]
- **FR9** The storefront injector loads via the store's injector key and renders only eligible content for the current page. [FR-INJ-01]
- **FR10** The player supports Story mode and Reels mode, muted autoplay, lazy loading, adaptive rendition, RTL/LTR, and fails gracefully. [FR-INJ-02 to 07, 09, 10]
- **FR11** Product card with CTA; tapping adds to the Salla cart without leaving the content; every add-to-cart is tagged for attribution. [FR-BUY-01, 02, 04, 05, 06]
- **FR12** Capture events (impression, view, progress, completion, slide advance, product click, add to cart). [FR-ANA-01]
- **FR13** Attribute Salla orders to Slips interactions (last-touch, default 7-day window, configurable). [FR-ANA-02, 03]
- **FR14** Analytics page: KPIs, date ranges, funnel (view → click → cart → order), per-content performance with attributed revenue. [FR-ANA-04 to 06, 08, 11]
- **FR15** Overview dashboard with four KPIs, 7-day chart, recent content, and an empty-state CTA. [FR-DASH-02 to 05]
- **FR16** Products page with linked-content count, attributed orders, and availability; basic out-of-stock handling (CTA disabled, "Out of stock"). [FR-PRD-03, 04, 06, FR-VIS-07]
- **FR17** Settings: Salla connection, injector key (masked, copy, regenerate), installation guide, dashboard language. [FR-SET-01, 02, 04, 06, 07]
- **FR18** Store preview page with Stories/Reels toggle and installation instructions. [FR-PRV-01, 03]
- **FR19** Salla app billing with plan enforcement (content and placement limits), usage display, warnings at 80%/100%, deactivate-not-delete on downgrade. [FR-BIL-01 to 05]

### Non-Functional
- **NFR1** Injector initial payload ≤ 50 KB; no layout shift; non-blocking; enforced in CI. [NFR-PERF-01 to 03]
- **NFR2** First video frame ≤ 2 s on typical 4G; dashboard interactive ≤ 3 s; analytics queries ≤ 2 s P95. [NFR-PERF-04, 05]
- **NFR3** TLS everywhere, encrypted tokens/keys, strict tenant isolation, verified and idempotent webhooks, upload validation and scanning, rate limiting, OWASP Top 10 coverage. [NFR-SEC-01 to 07]
- **NFR4** PDPL-aligned privacy: pseudonymous analytics IDs, no personal data in events, consent-aware tracking. [NFR-PRIV-01 to 04]
- **NFR5** All user-facing strings externalized in Arabic and English; correct RTL/LTR and mixed-direction text. [NFR-LOC-01 to 03]
- **NFR6** WCAG 2.1 AA target; reduced-motion support. [NFR-A11Y-01]
- **NFR7** Storefront services 99.9% availability; CDN-cached content API with invalidation ≤ 1 minute. [NFR-AVAIL, NFR-SCAL-02]
- **NFR8** Logging, metrics, alerting, daily backups, versioned injector with rollback. [NFR-OBS, NFR-MNT, NFR-BKP]

---

## 3. User Interface Design Goals

- **Overall feel:** clean, modern, merchant-friendly dashboard matching the demo (`slips-sage.vercel.app`): right-side navigation in RTL, KPI cards, tables with status chips, live preview panel.
- **Key screens:** Overview, Videos & Stories, New/Edit Content, Products, Analytics, Settings, Store Preview. (Audience arrives in Phase 2.)
- **Accessibility:** WCAG 2.1 AA.
- **Branding:** Slips identity; storefront player inherits basic store theme colors.
- **Platforms:** responsive web dashboard; mobile-first storefront player.
- **Localization:** Arabic default (RTL), English (LTR); full mirroring.

---

## 4. Technical Assumptions (to be confirmed by the Architect agent and the Epic 1 spike)

- **Repository:** monorepo (dashboard, player, API, shared packages).
- **Candidate stack [Assumption]:** TypeScript end to end; Next.js for the dashboard (the demo is Vercel-hosted); a small, separately built vanilla/Preact player bundle for the injector; PostgreSQL for application data; an analytics-friendly store (Postgres partitions initially, ClickHouse later if needed); queue for media and sync jobs; object storage plus CDN.
- **Video:** use a managed video service (for example Mux or Cloudflare Stream) rather than a custom transcoding pipeline.
- **Salla integration:** OAuth, webhooks, product and order APIs, theme/snippet injection, app billing. **Every item must be verified in Epic 1 against current Salla docs.**
- **Testing:** unit and integration tests; automated tests for attribution logic, tenant isolation, and webhook idempotency; Playwright for key flows and player performance budgets.
- **Hosting:** managed cloud; data residency decision pending (Q-05).

---

## 5. Epic List (MVP)

| # | Epic | Outcome |
|---|---|---|
| 1 | **Foundation & Salla Spike** | Repo, CI, performance budget, and a proven Salla install → sync → inject → add-to-cart → order-webhook loop on a test store |
| 2 | **Product Catalog Sync** | Products and stock stay in sync with Salla; Products page works |
| 3 | **Content Creation & Media** | Merchants create, process, preview, and manage Stories and Reels |
| 4 | **Visibility, Scheduling & Publishing** | Content appears on the right pages at the right time |
| 5 | **Storefront Player & In-Content Purchase** | Shoppers watch and add to cart from the storefront |
| 6 | **Analytics, Attribution & Dashboard** | Events, funnel, attributed orders, KPIs |
| 7 | **Settings, Billing, Preview & Launch Readiness** | Plans enforced, preview, i18n and a11y hardening, security review, Salla submission |

**Later phases (outline only):**
- **Epic 8 (Phase 2):** AI Reels (Levels 1-2), Audience insights, best-time-to-post, team roles, notifications, variants, CSV export.
- **Epic 9 (Phase 3):** AI scripts, social import, A/B testing, interactive stickers and coupons, advanced reporting.

---

## 6. Epic Details and Stories

Story format: *As a [user], I want [capability], so that [value].* Stories are sized to be completable by one dev agent in one focused session.

### Epic 1: Foundation & Salla Spike

**Goal:** remove the largest technical risks first and give every later epic a working base.

**Story 1.1: Project scaffolding and CI**
As a developer, I want a monorepo with linting, tests, and CI, so that every change is checked automatically.
- AC1: Monorepo contains dashboard, player, API, and shared packages.
- AC2: CI runs lint, type-check, and tests on every pull request.
- AC3: A deployable "hello" version of dashboard and API exists in a staging environment.

**Story 1.2: Player performance budget in CI**
As a developer, I want the player bundle size checked in CI, so that it never exceeds the budget.
- AC1: CI fails if the player's gzip size exceeds 50 KB.
- AC2: A baseline layout-shift test (Playwright) fails on any measurable shift.

**Story 1.3: Salla OAuth install flow**
As a merchant, I want to install Slips from Salla and be signed in, so that I can start using it.
- AC1: Installing on a test store completes OAuth and creates a Store record.
- AC2: Access and refresh tokens are stored encrypted; refresh works automatically.
- AC3: The dashboard shows "Connected to Salla" with the store name.

**Story 1.4: Webhook receiver**
As the system, I want to receive and verify Salla webhooks, so that events are trusted and processed once.
- AC1: Signature/secret verification rejects invalid requests.
- AC2: Duplicate deliveries are processed idempotently.
- AC3: Install and uninstall events update the Store status; uninstall deactivates the injector.

**Story 1.5: Injector proof of concept**
As the team, we want to load a script into a test store's theme, so that we know the injection approach works.
- AC1: A test script loads on home, category, and product pages of a Salla test store.
- AC2: The script can read the page type and the product/category ID.
- AC3: Findings (what Salla allows, limits, quirks) are written to `docs/spike-findings.md`.

**Story 1.6: Add-to-cart and order-attribution proof of concept**
As the team, we want to add a product to the cart from the injected script and see the order later, so that attribution is feasible.
- AC1: The script adds a product to the Salla cart and tags the session.
- AC2: A test order triggers a webhook that can be matched to the tag.
- AC3: Limits and a recommended attribution method are documented in `docs/spike-findings.md`; any change to FR13 is flagged to the PM.

### Epic 2: Product Catalog Sync

**Story 2.1: Initial and manual product sync**
As a merchant, I want my products imported, so that I can link them to content.
- AC1: First install triggers a full import of products with images, category, price, availability.
- AC2: A "Sync products" button re-runs the import and updates the "last sync" time.
- AC3: Failures show a clear error and are retried.

**Story 2.2: Real-time product updates**
As a merchant, I want product changes in Salla reflected automatically, so that shoppers see current prices and stock.
- AC1: Product created/updated/stock webhooks update the local catalog within one minute.
- AC2: Deleted products are marked unavailable and linked content is handled per FR16.

**Story 2.3: Products page**
As a merchant, I want a list of my products with content and sales info, so that I can see which products are promoted.
- AC1: Table shows name, category, price, linked content count, attributed orders, availability.
- AC2: Filtering by category and search by name work.
- AC3: Out-of-stock products are visibly flagged.

### Epic 3: Content Creation & Media

**Story 3.1: Content data model and list page**
As a merchant, I want to see all my content with status and basic stats, so that I can manage it.
- AC1: Table with title/type, placement, status, views, clicks, actions.
- AC2: Tabs All/Published/Scheduled/Drafts show correct counts.
- AC3: Empty state prompts creating the first content.

**Story 3.2: Create content form (metadata and CTA)**
As a merchant, I want to enter title, format, product, and CTA, so that the content is shoppable.
- AC1: Format choice (Story/Reels), product selector (from synced products), CTA label and action.
- AC2: Validation messages are shown in the active language.
- AC3: Saving creates a draft.

**Story 3.3: Media upload and validation**
As a merchant, I want to upload several images or videos at once, so that I can build a Story quickly.
- AC1: Multi-file upload with progress; unsupported type/size/duration is rejected with a clear message.
- AC2: Files are scanned and stored securely with tenant-scoped paths.
- AC3: External media links are fetched safely (SSRF-protected) or stored as references.

**Story 3.4: Video processing and quality check**
As a merchant, I want uploaded videos processed automatically, so that they play well on any connection.
- AC1: Videos get multiple renditions and a poster via the chosen video service.
- AC2: A quality check flags failures with a reason; status shows Processing/Failed/Ready.
- AC3: With auto-publish on, passing content becomes Published (subject to visibility and schedule).

**Story 3.5: Live preview panel**
As a merchant, I want a vertical preview while editing, so that I see what shoppers will see.
- AC1: Preview updates as media order, title, and CTA change.
- AC2: Preview works in RTL and LTR.

**Story 3.6: Edit, duplicate, archive, delete**
As a merchant, I want to modify and clean up content, so that my library stays organized.
- AC1: Each action works from the list; delete asks for confirmation.
- AC2: Archived content is removed from the storefront immediately (cache invalidated ≤ 1 minute).

### Epic 4: Visibility, Scheduling & Publishing

**Story 4.1: Placement rules**
As a merchant, I want to choose where content appears, so that it fits the right pages.
- AC1: Choose home, category, or product page; optional target ID selector.
- AC2: Content without placement cannot be published.

**Story 4.2: Scheduling**
As a merchant, I want to schedule start and end times, so that campaigns run automatically.
- AC1: Scheduled content shows "Scheduled" and goes live at the set time in the store's time zone.
- AC2: Optional end time unpublishes automatically.

**Story 4.3: Published-content API and cache**
As the player, I want a fast API for eligible content, so that pages load quickly.
- AC1: Endpoint returns only Published content matching page type and ID, keyed by injector key.
- AC2: Responses are CDN-cached and invalidated within one minute of changes.
- AC3: Out-of-stock handling follows FR16.

### Epic 5: Storefront Player & In-Content Purchase

**Story 5.1: Injector loader**
As a merchant, I want one script to enable Slips on my store, so that setup is simple.
- AC1: Loader is async, within the size budget, and reads the injector key.
- AC2: If the API fails or the key is invalid, nothing visible breaks.
- AC3: Style isolation prevents conflicts with the store theme.

**Story 5.2: Story mode**
As a shopper, I want to tap through stories, so that I can browse quickly.
- AC1: Story ring/bar, tap to advance, progress bar, swipe/close.
- AC2: Works on iOS Safari and Android Chrome; RTL and LTR.

**Story 5.3: Reels mode**
As a shopper, I want to swipe through full-screen videos, so that discovery feels natural.
- AC1: Vertical swipe feed, one video at a time, mute control, muted autoplay.
- AC2: Videos lazy-load and pick a rendition based on network quality.

**Story 5.4: Product card and add to cart**
As a shopper, I want to add the product to my cart from the video, so that I can buy fast.
- AC1: Product card shows image, name, price, and CTA.
- AC2: Add to cart works without leaving the content, with visual confirmation; errors are localized.
- AC3: Each add-to-cart is tagged per Story 1.6.
- AC4: Secondary action opens the product page or cart.

**Story 5.5: Embedding layouts**
As a merchant, I want content shown as a product-page strip, home/category carousel, or full-screen Reels, so that I can choose what fits.
- AC1: All three layouts reserve space (no layout shift).
- AC2: Layout is selected per placement.

### Epic 6: Analytics, Attribution & Dashboard

**Story 6.1: Event ingestion**
As the system, I want to collect player events reliably, so that analytics are trustworthy.
- AC1: Batched beacon endpoint with rate limiting and client-side retry.
- AC2: Events use pseudonymous session IDs; no personal data.
- AC3: Events are validated and tenant-scoped.

**Story 6.2: Order ingestion and attribution**
As a merchant, I want orders linked to my content, so that I see real revenue.
- AC1: Order webhooks are matched to tagged sessions or clicks inside the attribution window (default 7 days, configurable).
- AC2: Automated tests cover edge cases (multiple touches, expired window, cancelled orders).
- AC3: Attribution method is documented in-app.

**Story 6.3: Analytics page**
As a merchant, I want KPIs, a funnel, and per-content results, so that I know what works.
- AC1: KPIs with change vs previous period; date ranges 7 days, 30 days, this month, custom.
- AC2: Funnel shows view → product click → add to cart → order with counts and rates.
- AC3: Per-content table shows views, completion, CTR, attributed revenue; metric tooltips explain definitions.

**Story 6.4: Overview dashboard**
As a merchant, I want a quick summary on login, so that I see my results at a glance.
- AC1: Four KPI cards, 7-day chart, recent content with All/Published/Drafts filter.
- AC2: New stores see an onboarding checklist and "Create your first story" banner.

**Story 6.5: Metric consistency**
As a product owner, I want consistent metric names and numbers, so that merchants trust the data.
- AC1: One glossary defines View, Unique viewer, Engagement, CTR, Completion.
- AC2: Dashboard totals reconcile with per-content totals (resolves SRS Appendix B items 1 and 2).

### Epic 7: Settings, Billing, Preview & Launch Readiness

**Story 7.1: Settings pages**
As a merchant, I want to manage my connection and injector, so that I stay in control.
- AC1: Salla connection tab: status, store name/URL, reconnect.
- AC2: Injector tab: masked key with reveal/copy, regenerate (old key invalidated), installation guide.
- AC3: Language switch (Arabic/English) persists.

**Story 7.2: Plans, quotas, and Salla billing**
As the business, I want subscriptions handled through Salla, so that merchants can pay and upgrade easily.
- AC1: Subscription events (start, renew, upgrade, downgrade, cancel, expire) update the plan.
- AC2: Limits on active content and placements are enforced; usage and 80%/100% warnings are shown.
- AC3: On downgrade/expiry, excess content is deactivated (not deleted) with a grace period and notice.
- AC4: Trial period works if configured.

**Story 7.3: Store preview page**
As a merchant, I want to preview Stories and Reels on a simulated store, so that I can see the result before going live.
- AC1: Toggle Stories/Reels with the in-content product card and "Order now".
- AC2: Installation instructions are linked from here.

**Story 7.4: Internationalization and accessibility pass**
As a user, I want the app to work well in Arabic and English, so that it feels native.
- AC1: No hard-coded strings; all screens and the player verified in RTL and LTR, including mixed-direction text.
- AC2: Keyboard navigation, focus states, contrast, alt text, reduced motion verified on key flows.

**Story 7.5: Security and privacy review**
As the business, I want a security and privacy review before launch, so that we meet Salla and PDPL expectations.
- AC1: Tenant-isolation, upload, SSRF, XSS, and webhook tests pass.
- AC2: Privacy policy and data-processing terms are published; retention rules implemented.
- AC3: No open critical/high findings.

**Story 7.6: Pilot and Salla submission**
As the business, I want to submit the app and onboard pilots, so that we can launch.
- AC1: Listing assets and descriptions (Arabic and English) prepared.
- AC2: Pilot merchants onboarded; attribution reconciled against Salla order data within agreed tolerance.
- AC3: Salla review passed.

---

## 7. Open Items for the Architect / PM (from the SRS)

1. Q-01 Exact Salla mechanisms for injection, cart actions, attribution (answered by Epic 1).
2. Q-02 Audience age data source (Phase 2).
3. Q-03 AI providers, music licensing, quotas (Phase 2).
4. Q-04 Final plan names and prices.
5. Q-05 Data residency.
6. Q-06 Social import timing.

## 8. Next Steps

- **Architect agent:** after Epic 1 findings, produce the architecture document (stack, data model, event pipeline, attribution design, performance budget).
- **UX agent:** produce a front-end spec from the demo, including RTL rules and the player interaction model.
- **PO agent:** validate this PRD against the architecture, then shard it into epics and stories.
