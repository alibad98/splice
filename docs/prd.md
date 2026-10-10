# Slips (سليبس) Product Requirements Document (PRD)

**Version:** 0.2 | **Date:** 10 Oct 2026 | **Scope:** MVP (Phase 1) in detail; Phases 2-3 as epic outlines
**Companion documents:** `docs/prd-addendum.md` (technical detail, architect notes, rejected alternatives), `docs/tech-stack.md` (chosen stack), `docs/Slips_SRS_v0.1.md` (detailed reference)

> **Precedence.** For the MVP, this PRD is the single source of truth; where it differs from the SRS, the PRD wins. The SRS remains the detailed reference for later phases. SRS requirement IDs are cited in brackets (for example [FR-CON-05]) so readers can trace each requirement back.

**How to read the tags**
- **[ASSUMPTION]** inferred, not yet confirmed by the product owner; listed again in §9.
- **[TBD: owner]** a value that is still missing; the owner named must supply it.
- **[NEEDS LEGAL]** depends on legal advice (PDPL and related); must be confirmed by counsel before launch.

### Change log
| Version | Date | Description | Author |
|---|---|---|---|
| 0.1 | 10 Oct 2026 | Initial BMAD PRD derived from SRS v0.1 | Product owner |
| 0.2 | 10 Oct 2026 | Applied validation findings and owner decisions C1, C4, C6, C8 | Product owner (with PM agent) |

---

## 1. Goals and Background Context

### 1.1 Goals
1. Ship a Salla App Store app that lets merchants publish **Stories and Reels** in their storefront.
2. Let shoppers **add to cart from inside the content** without leaving the experience.
3. Show merchants **attributed orders and revenue** under a strict, conservative definition (§1.5, FR13), so the app proves its own ROI in numbers merchants can check against their Salla orders.
4. Keep the storefront player **lightweight**: initial payload ≤ 50 KB gzip (~20 KB core), and **no layout shift caused by Slips** on pages where content is shown; when no content is eligible, Slips reserves no space (NFR1).
5. Support **Arabic (RTL) and English (LTR)** throughout.
6. Reach a pilot-ready MVP by **[TBD: product owner, Q-19]** and use the pilot to validate willingness to pay before funding Phases 2-3.

### 1.2 Background
Salla merchants rely heavily on mobile shoppers, and short-form video drives purchase decisions. The main competitor on the Salla App Store, Na3na3, offers shoppable video (Reels) only (source: Salla App Store listing reviewed for SRS §8, Oct 2026). For the MVP, Slips differentiates on three things it can deliver at launch: **Stories as well as Reels**, **scheduling and page-level visibility rules**, and **attribution to real orders and revenue**. AI-generated Reels and audience insights are later-phase differentiators (Epics 8-9) and are not part of the MVP pitch.

### 1.3 Success Metrics & MVP Exit Criteria

The MVP is "done" and Phase 2 full development may start only when **all** exit criteria are met.

**Exit criteria**
| # | Criterion | Measured by |
|---|---|---|
| E1 | Slips is approved and listed on the Salla App Store. | Salla listing live |
| E2 | Player initial payload within budget (NFR1: ≤ 50 KB gzip) and **zero measured layout shift (CLS)** caused by Slips on **at least 3 representative Salla themes**. | CI budget check (Story 1.2); storefront measurement (Story 5.7) |
| E3 | Attributed orders reconcile with Salla order data **within ±3%** on pilot stores. Reconciliation = Slips' attributed orders and attributed revenue compared with an independent recomputation from Salla order data (orders containing cart-tagged line items, using the FR13 rules). | Reconciliation report (Story 7.6) |
| E4 | **10 pilot merchants live**, each with published content and **≥ 1 attributed order**. | Admin view (Story 7.8) |
| E5 | **No open critical or high security findings.** | Security review (Story 7.5, launch task L-4) |

**Counter-metrics** (watched so that hitting the targets does not hide harm)
| Counter-metric | Target |
|---|---|
| Storefront Core Web Vitals (LCP, INP, CLS) with Slips installed vs without, measured on pilot stores | Not worse with Slips installed (Story 5.7) |
| 30-day uninstall rate | Tracked from launch; target < 20% [ASSUMPTION] |

### 1.4 Non-Goals for the MVP
- No team members or roles: **one merchant account per store** (RBAC is Phase 2) [FR-AUTH-06, FR-SET-03/05, NFR-SEC-04].
- No AI content generation, Audience page, best-time-to-post, notifications, CSV export, social import (see §8).
- No product variant picker inside the player; products with required options use the FR23 fallback.
- No theme colour/font matching in the player; Slips uses its own neutral styling (theme matching is FR-INJ-08, Phase 2).
- No configurable out-of-stock behaviour; the basic form applies (FR16).
- No multiple products per content item; one linked product per item [FR-BUY-03 deferred].
- No view-through or click-through attribution credit (FR13).
- No platforms other than Salla (pending Q-07).
- Reporting currency is the store's base currency; no currency conversion.

### 1.5 Glossary and Metric Definitions

These definitions apply to every screen, story and test. Screens that show a metric must use these names and formulas.

| Term | Definition |
|---|---|
| **Content item** | One Story or one Reel created by a merchant: title, format, linked product, CTA, one or more media items, placement rules and schedule. |
| **Story** | Format: short, tappable, multi-slide content (images and/or short clips), opened from a story ring or bar. |
| **Reel** | Format: a vertical, full-screen, swipeable video feed, one video at a time. |
| **Format** | Story or Reel. |
| **Layout** | How content is embedded on a page: product-page strip, home/category carousel, or full-screen Reels viewer (FR29). |
| **Placement** | A page type where content may appear: Home, Category or Product, optionally narrowed to one category or product (target ID). A content item's placements are its **visibility rules**; the two terms mean the same thing. For plan limits, the number of placements a store uses = the number of distinct page types with published content [ASSUMPTION, pending Q-04]. |
| **Active content item** | A content item in status Published or Scheduled. Counts toward plan limits [ASSUMPTION, pending Q-04]. |
| **Injector** | The small loader script on the storefront that checks for eligible content and loads the player. |
| **Player** | The storefront UI that renders Stories and Reels (loaded by the injector). |
| **Injector key (store key)** | A **public** identifier for a store, embedded in storefront pages. It is not a secret (FR9, NFR3). |
| **Viewer ID** | A pseudonymous, random identifier stored in the shopper's browser; never linked to name, phone or email. |
| **Impression** | The player component (ring, strip or carousel) becomes visible in the viewport. |
| **View** | A shopper opens a content item and its first slide or video starts showing. Counted at most once per content item per viewer per 30 minutes [ASSUMPTION]. |
| **Unique viewer** | A distinct viewer ID with at least one view in the selected date range. |
| **Completion** | The shopper reaches the end of the last slide (Story) or the end of the video (Reel). |
| **Completion rate** | Completions ÷ views. |
| **Product click** | A tap on the product card or its secondary action (open product page / open cart). |
| **CTR** | Product clicks ÷ views. The SRS term "Engagement rate" on the Overview is the same metric and is labelled **CTR** everywhere [ASSUMPTION; resolves SRS Appendix B item 2]. |
| **Slips add to cart** | An add-to-cart started from the CTA inside Slips content and **confirmed as successful by Salla**. It is tagged (cart-tagged) for attribution. |
| **Cart-tagged line item** | An order line item whose product was added to the cart through a Slips add to cart. |
| **Attributed order** | A Salla order with at least one credited, cart-tagged line item, placed within the attribution window (FR13). |
| **Attributed revenue** | The sum of credited cart-tagged line items only, net of cancellations and refunds; never the whole order (FR13). |
| **Attribution window** | Days between a Slips add to cart and the order. Default 7, merchant-configurable 1-14. |
| **Funnel** | Views → product clicks → Slips adds to cart → attributed orders, with counts and **step-to-step** conversion rates (each step ÷ previous step) [FR-ANA-06; resolves SRS Appendix B item 4]. |
| **% change** | (Value this period − value previous period of equal length) ÷ value previous period. Shown as "—" when the previous value is 0. |

**Headline KPIs**
- **Overview (4 KPIs):** Views, CTR, Product clicks, Attributed revenue (store currency); each with % change [FR-DASH-02].
- **Analytics page (4 KPIs):** Views, Unique viewers, Product clicks, Attributed orders; each with % change [FR-ANA-04].
- **Consistency rule:** each credited line item belongs to exactly one content item, so per-content attributed revenue always sums to the total attributed revenue for the same range [resolves SRS Appendix B item 1].

### 1.6 User Journeys [ASSUMPTION: protagonists and details to be confirmed by the product owner]

**UJ1. Noura onboards and publishes her first Story.** Noura owns an abaya store on Salla. She installs Slips from the Salla App Store and lands in the dashboard already connected ("Connected to Salla: Noura Abayas"). An onboarding checklist shows four steps: store connected ✓, products synced ✓ (done automatically), injector installed, first content created. She creates a Story, uploads three clips from her phone, links a best-selling abaya, keeps the "Add to cart" CTA and sets the placement to Home. The live preview shows what shoppers will see. She turns on auto-publish; a few minutes later the clips pass processing and the Story goes live. She opens Store Preview, then her real storefront, and sees the story ring on her home page.

**UJ2. Faisal buys from a Reel on his phone.** Faisal browses Noura's store on Android Chrome. Below the hero banner a Reels carousel appears without pushing the page around. He taps a Reel; it opens full screen and plays muted. He unmutes, watches, and taps "Add to cart" on the product card. A confirmation appears and he keeps swiping. Two days later he returns to the store and checks out. Because the abaya was added from inside Slips and the order came within 7 days, that line item is credited to the Reel.

**UJ3. Noura checks her ROI.** Two weeks later Noura opens Analytics. She sees 3,000 views, the funnel to attributed orders, and the attributed revenue per content item, with "7-day window, add-to-cart only" shown next to each figure. A tooltip explains that only products added to cart from Slips content count, and that refunds are subtracted. She opens her Salla orders, finds the orders listed under the Reel, and the amounts match the line items. She archives a low-performing Story and duplicates the best Reel for a new product.

---

## 2. Requirements (MVP)

### 2.1 Functional

- **FR1** Install from the Salla App Store and authenticate via Salla OAuth; tokens are stored encrypted and refreshed automatically. The dashboard shows "Connected to Salla" with the store name. [FR-AUTH-01, 02, 04]
- **FR2** Handle app install and uninstall events. On uninstall: the storefront stops showing Slips content (the content API returns an empty result for that store key), billing-related processing stops, and the retention policy applies (30-day grace period during which a reinstall restores content and settings, then permanent deletion; NFR10). [FR-AUTH-05, NFR-DATA-01]
- **FR3** Sync products (name, image, category, price including sale price, availability, and whether the product has required options/variants) from Salla via webhooks plus a manual sync; show the last sync time. Availability has three states: Available, Low, Out of stock (Low threshold [TBD: product owner, Q-15]). [FR-PRD-01, 02, 03, 06]
- **FR4** Create Stories and Reels with title, format, linked product, CTA, and multiple images/videos by upload or external link. The CTA has a label (for example "Order now"), an action (add to cart / open product / open link) and an optional style from a preset list. "Open link" accepts only URLs on the store's own domain [ASSUMPTION; protects against phishing and open redirects]. [FR-CON-04 to 07, 13]
- **FR5** Validate uploads (type, size, duration, resolution), transcode videos into multiple renditions (for example 1080p/720p/480p), generate posters, and run a quality check; optional auto-publish after a pass. MVP upload limits are global, not per plan; the exact thresholds and quality-check criteria are [TBD: Architect with product owner, Q-13]. External links are always fetched and processed like uploads; Slips never hotlinks third-party media [ASSUMPTION]. [FR-CON-08 to 10; changed: per-plan limits deferred]
- **FR6** List content with status filters (All, Published, Scheduled, Drafts) and counts; edit, duplicate, archive, delete. Status rules follow FR22. [FR-CON-01, 02, 11]
- **FR7** Live vertical preview while editing content, rendered by the same player that runs on the storefront (preview mode, cart actions simulated). [FR-CON-12]
- **FR8** Define placements (home, category, product page; optional target ID), layout per placement (FR29), and scheduled start and optional end. Content without a placement cannot be published. Schedules use the store's time zone (from Salla if available, otherwise Asia/Riyadh with a merchant setting; confirmed at the Epic 1 gate). [FR-VIS-01 to 04, FR-CON-17]
- **FR9** The injector loads using the store's injector key, a **public store identifier**, and renders only content eligible for the current page (page type, target ID, schedule, status). [FR-INJ-01]
- **FR10** The player supports Story mode and Reels mode, muted autoplay, lazy loading, adaptive rendition, RTL/LTR following the storefront language, and respects browser autoplay, data-saver and reduced-motion settings. If Slips is unreachable or the key is invalid, the storefront stays fully functional with nothing visible from Slips. [FR-INJ-02 to 07, 09]
- **FR11** Product card (image, name, the price the cart will charge, CTA). Tapping "Add to cart" adds the product to the Salla cart without leaving the content, with visual confirmation; errors (out of stock, API failure) show a localized message and keep the shopper in the experience. A secondary action opens the product page or the cart. Every Slips add to cart is tagged for attribution using the mechanism chosen at the Epic 1 gate. [FR-BUY-01, 02, 04, 05, 06]
- **FR12** Capture events: impression, view, quartile progress, completion, slide advance, product click, add to cart. (Share is not in the MVP.) [FR-ANA-01]
- **FR13** Attribute Salla orders to Slips content using these rules. **This replaces the SRS FR-ANA-03 assumption** (last-touch with click credit, whole order). [FR-ANA-02; FR-ANA-03 replaced]
  1. **What earns credit:** only a product the shopper added to the cart from inside Slips content (a Slips add to cart, confirmed by Salla and tagged). Views and clicks alone never earn credit; they stay funnel metrics.
  2. **What is credited:** only the cart-tagged line items of the order, never the whole order. Shipping is excluded. Treatment of VAT and order-level discounts is [TBD: product owner, Q-14].
  3. **Window:** the order must be placed within the attribution window after the Slips add to cart. Default 7 days; the merchant can set 1-14 days. A changed window applies to orders placed after the change [ASSUMPTION]. The window in force is shown next to every attributed figure.
  4. **One credit per line item:** if the same product was added more than once (from Slips, or from Slips and elsewhere), the order line item is credited once, for its full ordered quantity [ASSUMPTION].
  5. **Several content items:** if several content items added the same product, the most recent Slips add to cart before the order gets the credit.
  6. **Mixed orders:** line items not cart-tagged are ignored; the order still counts as attributed if at least one line item is credited.
  7. **Order after the window:** no credit; the add to cart still appears in the funnel.
  8. **Cancellations and refunds:** a cancelled order loses all credit and stops counting as attributed. A partial refund subtracts the refunded amount of credited line items; if nothing credited remains, the order stops counting as attributed. Changes apply when the order update arrives (webhook or reconciliation, FR25).
  9. **Integrity:** only add-to-cart events that pass FR26 checks count.
- **FR14** Analytics page: the four Analytics KPIs (§1.5) with % change; date ranges Last 7 days, Last 30 days, This month, custom; funnel with counts and step-to-step rates; per-content performance (views, completion rate, CTR, attributed revenue); in-app tooltips defining every metric; an attribution methodology page. [FR-ANA-04 to 06, 08, 11]
- **FR15** Overview dashboard: the four Overview KPIs (§1.5) with % change; 7-day chart; latest content (title, last activity, views, CTR, status) with All/Published/Drafts filter and a link to the full list; empty-state banner "Create your first story". [FR-DASH-02 to 05]
- **FR16** Products page with category, price, linked-content count, attributed orders and availability (Available/Low/Out of stock), filtering by category and search by name. Basic out-of-stock handling: the CTA is disabled and shows "Out of stock". When a merchant links an out-of-stock product, the form warns them [resolves SRS Appendix B item 3]. [FR-PRD-03, 04, FR-PRD-05 basic form, FR-VIS-07]
- **FR17** Settings: Salla connection tab (status, store name and URL, reconnect, disconnect); injector tab (store key shown in full with copy, regenerate, installation guide, default display options); attribution window (1-14 days); dashboard language. Regenerate issues a new key and purges the storefront cache; the old key stops working after an overlap period [TBD: Architect] and the merchant is told whether reinstalling the snippet is needed (depends on the install model chosen at the Epic 1 gate). Changes are saved explicitly with a "Changes saved" confirmation. [FR-SET-01, 02, 04, 06, 07; changed: key not masked]
- **FR18** Store preview page with a Stories/Reels toggle, the in-content product card and "Order now", and installation instructions, using the real player in preview mode. A "Preview store" button is available on every dashboard page. [FR-PRV-01, 03]
- **FR19** Salla app billing: react to subscription events (start, renew, upgrade, downgrade, cancel, expire); enforce plan limits on active content items and placements at publish time and in the storefront API; show plan and usage with warnings at 80% and 100%; on downgrade or expiry, deactivate (never delete) content above the limit with a notice and a grace period; support a free trial if configured in Salla. Plan names, prices, limits, grace length and deactivation order are [TBD: product owner, Q-04]. [FR-BIL-01 to 05]

**Added in v0.2** (new IDs; existing FR1-FR19 keep their numbers)
- **FR20** A "Need help? Contact support" entry point is available on every dashboard page. Channel, hours and languages per Q-10. [FR-NOT-03]
- **FR21** Onboarding checklist on first install: connect store, sync products, install the injector, create the first content; each step shows done/not done. [FR-AUTH-03]
- **FR22** Content status model [FR-CON-03; statuses ASSUMPTION]:
  - Statuses: **Draft, Processing, Failed, Scheduled, Published, Archived, Deactivated** (Deactivated = switched off by a plan limit, FR19). There is no separate "Ready" status: content that passes processing without auto-publish returns to Draft.
  - Only Published content within its schedule is shown on the storefront.
  - Active content items (Published, Scheduled) count toward plan limits.
  - Tabs: All (every status), Published, Scheduled, Drafts (Draft, Processing, Failed). Archived and Deactivated items appear under All with a status chip.
  - Auto-publish on content with no placement leaves it in Draft with the reason shown.
- **FR23** Products with required options (size, colour, etc.): until the Epic 1 gate confirms that options can be selected and added through Salla, the CTA on these products reads "View options" and opens the product page instead of adding to cart. These clicks count as product clicks but cannot earn attribution credit. [ASSUMPTION pending the spike, Q-11; full variant support is FR-PRD-08, Phase 2]
- **FR24** Freshness and caching: storefront content reflects publish, unpublish, archive and schedule start/end within one minute of the change or schedule boundary; product price and stock changes in Salla reach the storefront within 2 minutes at P95 (1 minute sync + 1 minute cache) [ASSUMPTION]. When a shopper adds to cart, Salla's price governs; if it differs from the card, the card updates to Salla's price. [FR-PRD-06, NFR-SCAL-02]
- **FR25** Integration lifecycle [ASSUMPTION: derived from review H13]:
  - A periodic reconciliation (at least daily) back-fills products and orders whose webhooks were missed.
  - Out-of-order webhooks never overwrite newer data (the latest update wins).
  - Token refresh happens once at a time per store (no parallel refresh races).
  - If Salla access is lost (token revoked or refresh fails), the store shows a **Disconnected** state in the dashboard with a reconnect action; sync pauses.
  - Reinstall within the grace period restores content and settings (FR2).
  - If a linked product is deleted in Salla, its content is removed from the storefront and flagged to the merchant ("Linked product deleted").
- **FR26** Event integrity: the event endpoint accepts events only for a valid store key from that store's own storefront domain; events carry a unique ID and duplicates are dropped; per-store and per-viewer rate limits apply; basic bot and implausible-activity heuristics filter counts. Only Slips adds to cart confirmed by Salla can earn attribution credit. [NFR-SEC-07; basic part of FR-ANA-12 brought into MVP]
- **FR27** Slips Admin view (internal): support staff can look up a store and see its connection status, sync state and last sync, processing jobs and failures, plan and usage, and pilot status (published content, attributed orders). Access is restricted to Slips staff with separate internal sign-in. [NFR-OBS-02, SRS §2.3 "Slips Admin"]
- **FR28** Dashboard access: the merchant opens the dashboard from Salla (or a direct link) and is signed in through their Salla account; MVP has **one merchant account per store** and no team members. Sessions expire after inactivity [TBD: Architect] and the merchant can sign out. The exact re-entry mechanism (embedded in Salla or separate tab) is confirmed at the Epic 1 gate. [ASSUMPTION]
- **FR29** Layouts and display options: the merchant chooses a layout for each placement: product-page strip (below images or a custom position), home/category carousel (boxed or full width), or full-screen Reels viewer (opened from a strip or carousel). Stories show as a ring or bar; Reels show as a carousel or strip of covers that opens the full-screen viewer [ASSUMPTION: format × layout matrix]. Default display options are set in Settings (FR17). [FR-INJ-10, FR-SET-02]
- **FR30** When several published items match the same placement, show them most recently published first, up to a per-placement cap [TBD: product owner, Q-15]. [replaces FR-VIS-06 for MVP; priority ordering is Phase 2]

### 2.2 Non-Functional
- **NFR1** Storefront performance budget [NFR-PERF-01 to 03; PERF-02 changed]:
  - **Initial payload** (all JS and CSS the injector loads before first render) ≤ **50 KB gzip**; core loader target **~20 KB gzip** (CI warns above it). On-demand modules (for example adaptive video playback) are excluded from the initial budget but each has its own cap [TBD: Architect]. Media files are excluded.
  - **No layout shift caused by Slips** on pages where content is shown; when no content is eligible (or Slips is unreachable, or the key is invalid), Slips reserves no space. Tested as: no layout-shift entries attributable to Slips elements, on ≥ 3 representative themes, in four scenarios: content present, no content, API timeout, invalid key.
  - Non-blocking: loads asynchronously and defers heavy work until interaction or viewport entry.
  - Enforced in CI.
  - *Note for the architect:* the mechanism that achieves zero shift while showing content only when eligible is an open design question; see `prd-addendum.md` §B.1.
- **NFR2** First video frame ≤ 2 s after the shopper opens the player, on a "Fast 4G" network profile and a mid-range Android device [ASSUMPTION: test profile]; dashboard interactive ≤ 3 s on broadband; analytics queries ≤ 2 s P95 for a 30-day range. [NFR-PERF-04, 05]
- **NFR3** Security [NFR-SEC-01, 02 (changed), 03, 05, 06, 07]:
  - TLS 1.2+ for all traffic; all data encrypted at rest, backups included.
  - Salla access and refresh tokens and any other real secrets stay server-side, encrypted; never written to logs; OAuth scopes limited to what the MVP needs; token access is logged.
  - The **injector key is a public store identifier, not a secret**: it is not masked or encrypted. Protection comes from server-side validation of every storefront API call and event: origin/store binding, rate limits and bot heuristics (FR26).
  - Strict tenant isolation: a merchant can only access their own store's data, with automated tests.
  - Salla webhooks verified (signature/secret) and processed idempotently.
  - OWASP Top 10 coverage, including XSS in merchant text and links, SSRF in external-link fetching, and unsafe uploads (type checked by file content, image metadata such as GPS stripped, SVG rejected, malware scan before publish).
  - **Access model:** one merchant account per store (FR28). Role-based access control [NFR-SEC-04] is deferred to Phase 2.
- **NFR4** Privacy (PDPL) [NFR-PRIV-01 to 04, NFR-DATA-03]:
  - **a. Analytics events:** pseudonymous viewer IDs only; no name, phone, email or address in events; IP addresses used only transiently for rate limiting and bot checks, not stored with events [ASSUMPTION].
  - **b. Shopper PII minimisation:** from order data, store only what attribution needs: order ID, status, timestamps, line items (product, quantity, amounts), currency, and the cart tag. Shopper name, phone, email and address are never stored or logged. Where a shopper identifier is unavoidable for matching, store only a salted hash or pseudonymous ID.
  - **c. Consent:** tracking honours the store's consent state where Salla exposes one; the default when no signal exists is [NEEDS LEGAL] (Q-18).
  - **d. Retention limits:** each data class (raw events, aggregates, order attribution records, media, logs, backups) has a retention period (NFR10) [NEEDS LEGAL for periods].
  - **e. Merchant export and deletion:** merchants can request an export (machine-readable) and deletion of their data; on uninstall, data is deleted after the grace period (NFR10). Media is removed from storage and CDN. Response time for requests [NEEDS LEGAL].
  - **f. Processing records:** Slips keeps a record of processing activities (data categories, purposes, retention, sub-processors, storage locations). Slips' role as processor for merchants' shopper data, the data processing agreement (DPA) and the breach-notification procedure [NEEDS LEGAL].
  - **g.** A Privacy Policy and Data Processing terms are published and linked in the app listing [NFR-PRIV-04].
  - **h.** Storage location follows the data residency decision (Q-05).
- **NFR5** All user-facing strings externalized in Arabic and English; correct RTL/LTR and mixed-direction text; dates, numbers and currency formatted per locale using the store's base currency [NFR-LOC-01 to 03]. The player's RTL gesture and layout rules come from the UX spec (§10).
- **NFR6** Accessibility: dashboard meets WCAG 2.1 AA. Player: keyboard operation, visible focus, pause control for auto-advancing Stories and playing video, button alternatives to swipe gestures, and reduced-motion support. Whether the player can claim AA without captions (FR-CON-16 is Phase 2) is open (Q-12). [NFR-A11Y-01]
- **NFR7** Availability: storefront-facing services 99.9% monthly, dashboard 99.5% monthly; measured as the share of successful content-API responses at the edge, successful event submissions, and successful dashboard requests, excluding announced maintenance [ASSUMPTION: SLI definitions]. Event submission tolerates temporary backend outages through client-side retry and queuing. Storefront content API is CDN-cached with invalidation within one minute (FR24). [NFR-AVAIL-01, 02, NFR-SCAL-02]
- **NFR8** Operations: logging, metrics, tracing and alerting for API errors, queue depth, processing failures, Salla API failures and injector error rates; the injector is versioned with gradual rollout and rollback; databases backed up daily with point-in-time recovery and a restore test at least quarterly. [NFR-OBS-01, NFR-MNT-01, NFR-BKP-01; NFR-OBS-02 is FR27]

**Added in v0.2** (new IDs; existing NFR1-NFR8 keep their numbers)
- **NFR9** Compatibility [NFR-COMP-01 to 03]:
  - Works with Salla's official themes and common custom themes; a compatibility matrix is maintained, with at least 3 representative themes tested before launch.
  - Player supports iOS Safari (last 3 major versions), Android Chrome (last 3), **Samsung Internet**, and **desktop browsers** (Chrome, Safari, Edge, Firefox; last 2 versions). Dashboard supports the same desktop browsers, responsive from tablet up.
  - The injector does not pollute the global namespace or conflict with theme CSS/JS (style isolation).
- **NFR10** Data retention [NFR-DATA-01 to 03]:
  - After uninstall, merchant content and settings are kept for **30 days** [ASSUMPTION, from SRS] so a reinstall restores them, then permanently deleted.
  - Raw analytics events are kept for [TBD: product owner with legal, Q-16; SRS example 13 months], then aggregated or deleted.
  - Merchants can request export and deletion of their data (NFR4.e).
- **NFR11** Cost and abuse control [NFR-COST-01, 02]:
  - Storage and video delivery (bandwidth/minutes) are metered per store.
  - Abusive upload behaviour (volume or rate far above normal) is detected and throttled.
  - Per-plan cost caps and what happens when a store hits one are part of Q-04.
- **NFR12** Failed media processing jobs are retried automatically [TBD: Architect, retry count and backoff], then shown to the merchant as Failed with a reason and a retry action. [NFR-REL-01]
- **NFR13** Media processing for a 60-second video completes within **5 minutes at P95** (excluding queue spikes). The injector does not make the store's Core Web Vitals worse, measured against the same store without Slips (counter-metric, §1.3). [NFR-PERF-06, 07]
- **NFR14** Scale: the platform supports [TBD: product owner, Q-17; SRS example 5,000] concurrently active stores and absorbs **seasonal peaks of 10× normal traffic** (Ramadan, White Friday, National Day sales), verified by a load test before launch. [NFR-SCAL-01]

---

## 3. User Interface Design Goals

- **Visual reference:** the demo (`slips-sage.vercel.app`) is a visual reference, not the specification; this PRD and the UX spec govern. A snapshot of the demo is stored in the repo (launch task L-6). Known demo issues are resolved by SRS Appendix B items 1-4 as noted in §1.5 and FR16; item 5 (Visibility rules screen) is hidden in the MVP.
- **Shell:** right-side navigation in RTL (Overview, Videos & Stories, Products, Analytics; Settings at the bottom); store identity and connection status at the top; "Preview store" button and "Need help? Contact support" entry point on every page (FR18, FR20).
- **Key screens:** Overview, Videos & Stories (the content list), New/Edit Content, Products, Analytics (with methodology page), Settings, Store Preview. Audience arrives in Phase 2.
- **Accessibility:** per NFR6.
- **Branding:** Slips identity. The storefront player uses neutral Slips styling; matching store theme colours and fonts is Phase 2 (FR-INJ-08).
- **Platforms:** responsive web dashboard; mobile-first storefront player (NFR9).
- **Localization:** Arabic default (RTL), English (LTR); full mirroring.

---

## 4. Technical Assumptions

The chosen stack is in `docs/tech-stack.md`. Technical detail that used to sit here, notes for the architect, and rejected alternatives are in `docs/prd-addendum.md`. The PRD states capabilities and constraints only. Salla capabilities the product depends on are verified at the Epic 1 gate (§6, Epic 1).

---

## 5. Epic List (MVP)

| # | Epic | Outcome |
|---|---|---|
| 1 | **Foundation & Salla Go/No-Go Gate** | Repo, CI, performance budget, observability, and a documented go/no-go decision on every Salla capability the MVP depends on |
| 2 | **Product Catalog Sync** | Products and stock stay in sync with Salla, including missed webhooks and disconnection; Products page works |
| 3 | **Content Creation & Media** | Merchants create, process, preview, and manage Stories and Reels |
| 4 | **Visibility, Scheduling & Publishing** | Content appears on the right pages at the right time, and stays fresh |
| 5 | **Storefront Player & In-Content Purchase** | Shoppers watch and add to cart from the storefront, on every supported browser and theme |
| 6 | **Analytics, Attribution & Dashboard** | Trustworthy events, funnel, attributed orders and revenue, KPIs |
| 7 | **Settings, Billing, Support, Admin & Launch Readiness** | Plans enforced, preview, support, admin view, data rights, security, exit criteria verified |

**Later phases (outline only):**
- **Epic 8 (Phase 2):** AI Reels Levels 1-2 [FR-AI-01, 02, 03, 05 to 09]; Audience insights [FR-AUD-01 to 06]; best time to post, compare/sort, CSV export, full bot filtering [FR-ANA-07, 09, 10, 12]; team roles [FR-AUTH-06, FR-SET-03, 05, NFR-SEC-04]; slide reorder and captions [FR-CON-14, 16]; Visibility rules screen and priority ordering [FR-VIS-05, 06]; configurable stock behaviour, product "Open" view, **product variants** [FR-PRD-05, 07, 08]; theme matching [FR-INJ-08]; per-content device preview [FR-PRV-04]; notifications [FR-NOT-01, 02]; self-service data export/deletion [FR-SET-08].
- **Epic 9 (Phase 3):** AI scripts and AI opt-out [FR-AI-04, 10]; social import [FR-CON-15]; multi-product timed tags [FR-BUY-03]; coupons [FR-BUY-07]; preview extras [FR-PRV-02]; full theme customization; A/B testing [FR-EXP-01 to 04]; interactive elements [FR-INT-01 to 04]; advanced reporting [FR-RPT-01 to 04].

---

## 6. Epic Details and Stories

**Story format:** *As a [user], I want [capability], so that [value].*
**Sizing rule:** a story has at most 5 ACs, touches one deployable surface (dashboard, API, or player), and has no dependency on an outside party. Work that fails this rule is split (for example 6.2a/6.2b) or moved to the launch tasks (§6.8).
**Definition of Done (every story):** user-facing strings in Arabic and English; screens checked in RTL and LTR; dashboard UI keyboard-operable with visible focus; data access tenant-scoped with a test; metrics use the §1.5 definitions.
**Sequencing:** Stories 1.1, 1.2 and 1.7 are scaffolding and may start before the architecture document exists; they follow `docs/tech-stack.md` and are adjusted if the architecture changes. Spike stories 1.3-1.6b run in parallel with the architecture work. Stories in Epics 2-7 are not sharded for development until the Epic 1 gate (Story 1.6b) is passed and the PRD is re-baselined.

### Epic 1: Foundation & Salla Go/No-Go Gate

**Goal:** remove the largest technical risks first, give every later epic a working base, and end with a written go/no-go decision.

**Gate criteria** (verified in Stories 1.3-1.6a, decided in Story 1.6b)
| # | Capability | Pass criterion | Fallback if it fails |
|---|---|---|---|
| G1 | Storefront injection | The injector loads on home, category and product pages of ≥ 3 representative themes without the merchant editing theme code; it can read page type, product/category ID and storefront language; the store's CSP does not block it. | Manual snippet pasted by the merchant with a guided install (FR17 guide); if neither works: **no-go**. |
| G2 | Add to cart, simple products | From the injected player, a product is added to the Salla cart for guest and signed-in shoppers, with a success/failure response. | Open the product page with the product pre-selected (CTA becomes "View product"); attribution falls back per G4. If no reliable cart path at all: **no-go** on in-content purchase. |
| G3 | Add to cart, products with required options | An option/variant can be chosen and added through a supported Salla API. | Keep FR23 ("View options" opens the product page). |
| G4 | Cart tagging echoed in orders | A tag set at add-to-cart time can be read back from the resulting order (webhook or order API) and linked to line items. | Order note/custom field; or a thank-you-page beacon with documented accuracy loss; if none works, FR13 is demoted to "assisted orders" (reported, not called attributed) and the product owner re-decides E3. |
| G5 | Install and billing model | App install, uninstall and subscription events (start, renew, upgrade, downgrade, cancel, expire; trial) arrive as documented; app billing supports the planned plan structure. | Manual plan assignment by Slips Admin for the pilot; billing story deferred until supported. |
| G6 | Webhook lifecycle | Product, stock and order (created/updated/cancelled/refunded) webhooks are signed, can be verified, and redeliveries/ordering behave as documented. | Periodic reconciliation polling (FR25) carries freshness; FR24 bounds are relaxed and re-stated. |
| G7 | Store time zone | The store's time zone is available from Salla. | Asia/Riyadh default with a merchant setting (FR8). |
| G8 | Dashboard re-entry and consent signal | The merchant can reach the dashboard from Salla signed in; Salla exposes (or does not expose) a storefront consent state. | Separate login link via Salla OAuth; consent default per Q-18. |

**Story 1.1: Project scaffolding and CI**
As a developer, I want a monorepo with linting, tests, and CI, so that every change is checked automatically.
- AC1: Repository layout follows `docs/tech-stack.md`.
- AC2: CI runs lint, type-check, and tests on every pull request.
- AC3: A deployable "hello" version of dashboard and API exists in a staging environment that holds only test-store or synthetic data until Q-05 is decided.

**Story 1.2: Player performance budget in CI**
As a developer, I want the player's size and layout behaviour checked in CI, so that it never breaks the budget.
- AC1: CI fails if the initial payload (NFR1) exceeds 50 KB gzip, and warns if the core loader exceeds ~20 KB gzip.
- AC2: Each on-demand module has its own size check against its cap.
- AC3: An automated layout-shift test fails if any layout-shift entry is attributable to Slips elements, in the four NFR1 scenarios (content present, no content, API timeout, invalid key) on a reference page.

**Story 1.3: Salla OAuth install flow and dashboard access**
As a merchant, I want to install Slips from Salla and be signed in, so that I can start using it.
- AC1: Installing on a test store completes OAuth and creates a Store record.
- AC2: Access and refresh tokens are stored encrypted and never logged; refresh is automatic and happens once at a time per store.
- AC3: The dashboard shows "Connected to Salla" with the store name.
- AC4: Opening the app again from Salla signs the merchant in (G8 recorded); sessions expire after inactivity and the merchant can sign out.

**Story 1.4: Webhook receiver**
As the system, I want to receive and verify Salla webhooks, so that events are trusted and processed once.
- AC1: Signature/secret verification rejects invalid requests.
- AC2: Duplicate deliveries are processed idempotently; an older event never overwrites newer data.
- AC3: Install and uninstall events update the Store status; after uninstall the content API returns an empty result for that store key.
- AC4: Observed webhook behaviour (G5, G6) is recorded in `docs/spike-findings.md`.

**Story 1.5: Injector proof of concept**
As the team, we want to load a script into a test store's theme, so that we know the injection approach works.
- AC1: A test script loads on home, category, and product pages on ≥ 3 representative themes.
- AC2: The script can read the page type, the product/category ID and the storefront language.
- AC3: The team records whether space can be reserved before the script runs (input to NFR1 / addendum §B.1) and whether store CSP blocks loading.
- AC4: Findings for G1 and G7 are written to `docs/spike-findings.md`.

**Story 1.6a: Add-to-cart and tagging proof of concept**
As the team, we want to add a product to the cart from the injected script and see the order later, so that we know attribution is feasible.
- AC1: The script adds a simple product to the Salla cart for a guest and a signed-in shopper and reads the result.
- AC2: The team tries adding a product with required options and records whether options can be selected (G3).
- AC3: A test order shows whether the tag is echoed in the order webhook or API and can be linked to line items (G4).
- AC4: Findings for G2-G4 are written to `docs/spike-findings.md`.

**Story 1.6b: Go/no-go gate decision**
As the product owner, I want a documented decision on every Salla capability, so that the team builds only on what works.
- AC1: `docs/spike-findings.md` lists G1-G8 with pass/fail, evidence, and the fallback chosen for each fail.
- AC2: The document ends with a go/no-go decision signed off by the product owner.
- AC3: If any capability failed, the affected requirements (for example FR11, FR13, FR17, FR23) are updated in this PRD before Epics 2-7 are sharded.
- AC4: Q-01 and Q-11 are closed in §7.

**Story 1.7: Observability baseline**
As the team, I want logs, metrics and alerts from day one, so that we can see and fix problems during the spike and pilot.
- AC1: API errors, webhook failures, Salla API failures and queue depth are logged and graphed.
- AC2: Alerts fire on error-rate spikes and failed webhook processing.
- AC3: Each request carries a trace ID across API and background jobs.

### Epic 2: Product Catalog Sync

**Story 2.1: Initial and manual product sync** (depends on 1.3)
As a merchant, I want my products imported, so that I can link them to content.
- AC1: First install triggers a full import of products with images, category, price (including sale price), availability, and whether the product has required options.
- AC2: A "Sync products" button re-runs the import and updates the "last sync" time.
- AC3: Failures are retried automatically with backoff [TBD: Architect]; if they still fail, a localized error with a "Retry" action is shown.

**Story 2.2: Real-time product updates** (depends on 1.4, 2.1)
As a merchant, I want product changes in Salla reflected automatically, so that shoppers see current prices and stock.
- AC1: Product created/updated/stock webhooks update the local catalog within one minute.
- AC2: Product changes refresh the storefront content that links to them (FR24).
- AC3: Deleted products are handled per FR25.

**Story 2.3: Products page** (depends on 2.1)
As a merchant, I want a list of my products with content and sales info, so that I can see which products are promoted.
- AC1: Table shows name, category, price, linked content count, attributed orders, availability (Available/Low/Out of stock).
- AC2: Filtering by category and search by name work.
- AC3: Out-of-stock products show an "Out of stock" status chip.
- AC4: The attributed orders column shows "—" until Epic 6 attribution is live.

**Story 2.4: Reconciliation and missed webhooks** (depends on 2.2)
As a merchant, I want my catalog to self-correct, so that missed updates never leave wrong prices or stock on my store.
- AC1: A reconciliation run at least daily detects and fixes products that differ from Salla.
- AC2: Products deleted in Salla are removed from the storefront and flagged "Linked product deleted" on their content.
- AC3: Reconciliation results (changes found) are logged.

**Story 2.5: Disconnected state and reinstall** (depends on 1.3, 1.4)
As a merchant, I want to know when Slips loses access to my store, so that I can fix it quickly.
- AC1: When token refresh fails or access is revoked, the dashboard shows a "Disconnected" banner with a reconnect action and sync pauses.
- AC2: Reconnecting resumes sync and clears the banner.
- AC3: Reinstalling within the 30-day grace period restores content and settings (NFR10).

### Epic 3: Content Creation & Media

**Story 3.1: Content data model and list page**
As a merchant, I want to see all my content with status and basic stats, so that I can manage it.
- AC1: Table with title/type, placement, status, views, clicks, actions; views and clicks show "—" until Story 6.1a is live.
- AC2: Statuses and transitions follow FR22; tabs All/Published/Scheduled/Drafts show correct counts.
- AC3: Empty state prompts creating the first content.

**Story 3.2: Create content form (metadata and CTA)** (depends on 2.1)
As a merchant, I want to enter title, format, product, and CTA, so that the content is shoppable.
- AC1: Format choice (Story/Reel) and product selector (from synced products), with a warning when the product is out of stock.
- AC2: CTA label, action (add to cart / open product / open link limited to the store's domain) and optional preset style; products with required options get the FR23 CTA.
- AC3: Validation messages are shown in the active language.
- AC4: Saving creates a Draft.

**Story 3.3: Media upload and validation** (thresholds from Q-13)
As a merchant, I want to upload several images or videos at once, so that I can build a Story quickly.
- AC1: Multi-file upload with progress; files outside the global type/size/duration/resolution limits are rejected with a message naming the limit.
- AC2: File type is checked from content, not just the extension; SVG is rejected; image metadata such as GPS location is stripped.
- AC3: Files are malware-scanned before they can be published; upload links are scoped to the store and expire.
- AC4: External media links are fetched with SSRF protection and then processed like uploads (never hotlinked).

**Story 3.4a: Video processing** (depends on 3.3)
As a merchant, I want uploaded videos processed automatically, so that they play well on any connection.
- AC1: Videos get multiple renditions and a poster.
- AC2: Status shows Processing while work runs.
- AC3: A 60-second video completes within 5 minutes at P95 (NFR13), checked in a staging test.

**Story 3.4b: Quality check, retries and auto-publish** (depends on 3.4a, 4.1)
As a merchant, I want clear results from processing, so that I know when my content is ready.
- AC1: A quality check [criteria per Q-13] marks failures with a reason.
- AC2: Failed jobs retry automatically (NFR12); after the last retry, status is Failed with a reason and a "Retry" action.
- AC3: With auto-publish on, passing content becomes Published (subject to placement and schedule); without a placement it stays Draft with the reason shown.
- AC4: Without auto-publish, passing content returns to Draft.

**Story 3.5: Live preview panel** (depends on 5.2a, 5.3a)
As a merchant, I want a vertical preview while editing, so that I see what shoppers will see.
- AC1: Preview uses the storefront player in preview mode; cart actions are simulated.
- AC2: Preview updates as media order, title, and CTA change.
- AC3: Preview works in RTL and LTR.

**Story 3.6: Edit, duplicate, archive, delete**
As a merchant, I want to modify and clean up content, so that my library stays organized.
- AC1: Each action works from the list; delete asks for confirmation.
- AC2: Archived or deleted content disappears from the storefront within one minute.

### Epic 4: Visibility, Scheduling & Publishing

**Story 4.1: Placement rules and layout** (depends on 3.2)
As a merchant, I want to choose where and how content appears, so that it fits the right pages.
- AC1: Choose home, category, or product page; optional target category/product selector.
- AC2: Choose the layout for each placement (FR29), defaulting to the Settings default.
- AC3: Content without a placement cannot be published.

**Story 4.2: Scheduling**
As a merchant, I want to schedule start and end times, so that campaigns run automatically.
- AC1: Scheduled content shows "Scheduled" and goes live at the set time in the store's time zone (G7 outcome).
- AC2: Optional end time unpublishes automatically.

**Story 4.3: Published-content API and cache**
As the player, I want a fast API for eligible content, so that pages load quickly.
- AC1: Returns only Published, in-schedule content matching page type and target ID for a valid store key; an unknown or uninstalled store key returns an empty result.
- AC2: Responses are cacheable at the CDN and refreshed within one minute of changes.
- AC3: Multiple matches are ordered most recently published first, up to the per-placement cap (FR30).
- AC4: Out-of-stock products are returned with their status so the player can disable the CTA (FR16).
- AC5: Plan limits are enforced: deactivated content is never returned (FR19).

**Story 4.4: Schedule boundaries and product-driven refresh** (depends on 4.2, 4.3, 2.2)
As a merchant, I want my storefront to change exactly when I planned, so that campaigns start and stop on time.
- AC1: Schedule start and end reach the storefront within one minute of the boundary, with no merchant action.
- AC2: Product price or stock changes reach the storefront within 2 minutes at P95 (FR24).
- AC3: An automated test covers a start, an end, and a price change.

### Epic 5: Storefront Player & In-Content Purchase

**Story 5.1: Injector loader** (depends on 1.5, 4.3)
As a merchant, I want one script to enable Slips on my store, so that setup is simple.
- AC1: Loader is async, within the NFR1 budget, and reads the store key.
- AC2: If the API fails, times out or the key is invalid, nothing visible appears and no space is reserved.
- AC3: Player styles are isolated from the store theme, and the loader adds nothing to the global namespace beyond one documented name.

**Story 5.2a: Story mode core**
As a shopper, I want to tap through stories, so that I can browse quickly.
- AC1: Story ring/bar opens the viewer; tap to advance; progress bar; close.
- AC2: Video slides start muted.
- AC3: A pause control (and press-and-hold) stops auto-advance.

**Story 5.2b: Story gestures, RTL and accessibility** (depends on 5.2a)
As a shopper, I want Stories to behave naturally in my language and with my device settings, so that they feel native.
- AC1: Tap zones, progress direction and swipe follow the UX RTL/LTR rules.
- AC2: Keyboard: arrows move between slides, Escape closes, focus stays inside the open viewer and returns afterwards.
- AC3: Every swipe action has a button alternative.
- AC4: With reduced motion on, transitions are not animated and auto-advance waits for the shopper.

**Story 5.3a: Reels mode core**
As a shopper, I want to swipe through full-screen videos, so that discovery feels natural.
- AC1: Vertical swipe feed, one video at a time, mute control, muted autoplay.
- AC2: Videos lazy-load; nothing heavy loads before the component is near the viewport.
- AC3: With data saver on or autoplay blocked, a poster with a play button is shown instead of autoplay.
- AC4: Keyboard and button alternatives exist for next/previous and close.

**Story 5.3b: Adaptive renditions and first frame** (depends on 5.3a, 3.4a)
As a shopper, I want videos to start fast on my connection, so that I don't wait.
- AC1: The player picks a rendition based on network quality.
- AC2: First frame appears within 2 s on the NFR2 test profile.
- AC3: Any extra playback module loads on demand and stays within its own size cap.

**Story 5.4: Product card and add to cart** (depends on 1.6b, 5.2a or 5.3a)
As a shopper, I want to add the product to my cart from the video, so that I can buy fast.
- AC1: Product card shows image, name, the price the cart will charge, and the CTA.
- AC2: Add to cart works without leaving the content, with visual confirmation; errors are localized and keep the shopper in the viewer.
- AC3: Each successful add to cart is tagged using the G4 mechanism recorded in `docs/spike-findings.md`.
- AC4: For products with required options, the CTA reads "View options" and opens the product page (FR23); out-of-stock products show a disabled "Out of stock" CTA.
- AC5: A secondary action opens the product page or the cart.

**Story 5.5: Embedding layouts** (depends on 4.1, 5.1)
As a merchant, I want content shown as a product-page strip, home/category carousel, or full-screen Reels, so that I can choose what fits.
- AC1: All three layouts render per the placement's layout setting (FR29).
- AC2: All three layouts pass the NFR1 layout-shift test in all four scenarios.
- AC3: The player follows the storefront language (Arabic RTL / English LTR).

**Story 5.6: Browser and theme compatibility**
As the team, I want the player tested across the supported browsers and themes, so that no shopper gets a broken store.
- AC1: Automated player tests run on the NFR9 browser matrix, including Samsung Internet and desktop browsers.
- AC2: The theme compatibility matrix covers ≥ 3 representative themes and is stored in the repo.
- AC3: Failures block release of the player.

**Story 5.7: Storefront impact measurement**
As the product owner, I want proof that Slips does not slow stores down, so that we meet E2 and the counter-metric.
- AC1: A repeatable test measures LCP, INP and CLS with and without Slips on ≥ 3 representative themes.
- AC2: The same measurement can be run on pilot stores (with merchant permission).
- AC3: Results are saved as a report used for exit criteria E2 and the Core Web Vitals counter-metric.

### Epic 6: Analytics, Attribution & Dashboard

Story 6.5 (metric definitions) is done first in this epic, because 6.3 and 6.4a display its metrics.

**Story 6.1a: Event ingestion**
As the system, I want to collect player events reliably, so that analytics are trustworthy.
- AC1: The player sends batched events, including when the page is closed, with client-side retry when the backend is unavailable.
- AC2: Events cover the FR12 list, including quartile progress.
- AC3: Events use pseudonymous viewer IDs only and never contain personal data (NFR4.a).
- AC4: Events are validated against a schema and stored per store.

**Story 6.1b: Event integrity** (depends on 6.1a)
As a merchant, I want my numbers protected from fake traffic, so that I can trust them.
- AC1: Events for an unknown store key, or from a domain that is not the store's, are rejected.
- AC2: Each event has a unique ID; duplicates (including retries) are dropped.
- AC3: Per-store and per-viewer rate limits and basic bot heuristics apply; rejected events are counted in an internal metric.
- AC4: Add-to-cart events count for attribution only when Salla confirmed the add (FR26).

**Story 6.2a: Order ingestion and PII minimisation** (depends on 1.4, 1.6b)
As the system, I want order data stored with only what attribution needs, so that we protect shoppers' privacy.
- AC1: Order created, updated, cancelled and refunded events are ingested idempotently; reconciliation back-fills missed orders (FR25).
- AC2: Only the NFR4.b fields are stored; shopper name, phone, email and address are never stored or logged.
- AC3: Any shopper identifier needed for matching is stored only as a salted hash or pseudonymous ID.

**Story 6.2b: Attribution matching** (depends on 6.1b, 6.2a)
As a merchant, I want orders linked to my content under clear rules, so that I see real revenue.
- AC1: Only cart-tagged line items with a Slips add to cart within the window are credited; views and clicks never earn credit (FR13 rules 1-3).
- AC2: Same product added twice → the line item is credited once, for its full ordered quantity; several content items added the same product → the most recent add gets the credit.
- AC3: Order after the window → no credit; mixed order → only tagged line items count; the order counts as attributed if at least one line item is credited.
- AC4: Each credited line item is linked to exactly one content item, so per-content revenue sums to the total.
- AC5: Automated tests cover every case above with expected amounts.

**Story 6.2c: Reversals and attribution window setting** (depends on 6.2b)
As a merchant, I want refunds and cancellations reflected, so that my numbers stay honest.
- AC1: A cancelled order loses all credit and stops counting as attributed.
- AC2: A partial refund subtracts the refunded amount of credited line items; if nothing credited remains, the order stops counting.
- AC3: The window setting (1-14 days, default 7) applies to orders placed after a change.
- AC4: Automated tests cover cancel, full refund and partial refund with expected amounts.

**Story 6.3: Analytics page** (depends on 6.5, 6.2b)
As a merchant, I want KPIs, a funnel, and per-content results, so that I know what works.
- AC1: The four Analytics KPIs (§1.5) with % change; date ranges Last 7 days, Last 30 days, This month, custom.
- AC2: Funnel shows views → product clicks → Slips adds to cart → attributed orders with counts and step-to-step rates.
- AC3: Per-content table shows views, completion rate, CTR, attributed revenue; tooltips give each definition.
- AC4: Every attributed figure shows the window in force and links to a methodology page explaining the FR13 rules.

**Story 6.4a: Overview dashboard** (depends on 6.5)
As a merchant, I want a quick summary on login, so that I see my results at a glance.
- AC1: Four Overview KPI cards (Views, CTR, Product clicks, Attributed revenue) with % change.
- AC2: 7-day performance chart.
- AC3: Latest content list (title, last activity, views, CTR, status) with All/Published/Drafts filter and a link to the full list.

**Story 6.4b: Onboarding checklist and empty state**
As a new merchant, I want a short checklist, so that I know how to get my first content live.
- AC1: Checklist shows connect store, sync products, install the injector, create the first content, each with done/not done.
- AC2: Steps complete automatically when the underlying action happens.
- AC3: Stores with no content see a "Create your first story" banner.

**Story 6.5: Metric definitions and consistency**
As a product owner, I want consistent metric names and numbers, so that merchants trust the data.
- AC1: All metrics are computed as defined in §1.5, with shared definitions used by every screen.
- AC2: Tests show dashboard totals equal the sum of per-content totals for the same range (resolves SRS Appendix B item 1).
- AC3: "Engagement rate" is labelled CTR everywhere (Appendix B item 2).

### Epic 7: Settings, Billing, Support, Admin & Launch Readiness

**Story 7.1a: Connection, language and saving**
As a merchant, I want to manage my Salla connection and language, so that I stay in control.
- AC1: Salla connection tab shows status, store name and URL, with reconnect and disconnect (disconnect asks for confirmation).
- AC2: Language switch (Arabic/English) persists.
- AC3: Settings changes are saved explicitly and confirmed with "Changes saved".

**Story 7.1b: Injector, display and attribution settings**
As a merchant, I want to manage my store key, default display and attribution window, so that Slips fits my store.
- AC1: Injector tab shows the store key in full with copy (it is public; no masking) and the installation guide.
- AC2: Regenerate issues a new key, purges the storefront cache, keeps the old key working for the overlap period, and tells the merchant what to do (FR17).
- AC3: Default display options (layout and position per page type) can be set.
- AC4: The attribution window can be set from 1 to 14 days (default 7).

**Story 7.2a: Subscription events** (depends on G5)
As the business, I want subscriptions handled through Salla, so that merchants can pay and upgrade easily.
- AC1: Subscription events (start, renew, upgrade, downgrade, cancel, expire) update the store's plan.
- AC2: A free trial works when configured in Salla.
- AC3: Events are processed idempotently and logged.

**Story 7.2b: Limits and usage** (depends on 7.2a, Q-04)
As a merchant, I want to see my usage and limits, so that I know when to upgrade.
- AC1: Limits on active content items and placements are enforced at publish time with a clear message.
- AC2: Plan and usage are shown, with warnings at 80% and 100%.

**Story 7.2c: Downgrade and expiry** (depends on 7.2b, Q-04)
As a merchant, I want my content kept safe when my plan changes, so that I don't lose work.
- AC1: On downgrade or expiry, content above the limit becomes Deactivated (never deleted) in the order set by Q-04, after the grace period.
- AC2: The merchant is notified in the dashboard before and when content is deactivated.
- AC3: Upgrading again lets the merchant reactivate content.

**Story 7.3: Store preview page** (depends on 3.5)
As a merchant, I want to preview Stories and Reels on a simulated store, so that I can see the result before going live.
- AC1: Toggle Stories/Reels with the in-content product card and "Order now", rendered by the real player in preview mode.
- AC2: Installation instructions are linked from here and from Settings.
- AC3: A "Preview store" button is available on every dashboard page.

**Story 7.4: Final internationalization and accessibility check**
As a user, I want the app to work well in Arabic and English, so that it feels native.
- AC1: No hard-coded strings remain; all screens and the player are verified in RTL and LTR, including mixed-direction text and currency formatting.
- AC2: Keyboard navigation, focus states, contrast, alt text and reduced motion verified on key flows against NFR6.

**Story 7.5: Security test suite**
As the business, I want automated security checks before launch, so that we meet Salla's expectations and E5.
- AC1: Tenant-isolation, upload, SSRF, XSS, webhook-verification and event-spoofing tests pass.
- AC2: A check confirms no shopper PII appears in stored events, order records or logs.
- AC3: Findings from the external review (launch task L-4) are tracked to closure; none critical or high remain open.

**Story 7.6: Exit-criteria verification**
As the product owner, I want a report showing the MVP exit criteria, so that we can decide to launch and start Phase 2.
- AC1: For each pilot store, Slips' attributed orders and attributed revenue are compared with an independent recomputation from Salla order data (FR13 rules); the difference is within **±3%** (E3).
- AC2: The report shows **10 pilot merchants live**, each with published content and **≥ 1 attributed order** (E4).
- AC3: The report includes the payload budget result and **zero Slips layout shift on ≥ 3 themes** (E2, from Stories 1.2 and 5.7), and the Core Web Vitals with/without comparison.
- AC4: The report shows the 30-day uninstall rate (tracked from launch) and the security status (E5).

**Story 7.7: Support entry point**
As a merchant, I want help one click away, so that I can get unstuck.
- AC1: "Need help? Contact support" appears on every dashboard page (FR20).
- AC2: It opens the support channel chosen in Q-10, prefilled with the store ID.

**Story 7.8: Slips Admin view**
As Slips support staff, I want to look up a store, so that I can help pilot merchants quickly.
- AC1: Staff sign in separately from merchants; only Slips staff have access.
- AC2: Search by store name, URL or Salla ID shows connection status, last sync, processing jobs and failures, plan and usage.
- AC3: The view shows pilot status per store (published content, attributed orders) for E4.

**Story 7.9: Data retention, export and deletion**
As a merchant, I want my data handled as promised, so that I can trust Slips with my store.
- AC1: After uninstall, data is kept for 30 days, restored on reinstall, then permanently deleted, including media in storage and CDN.
- AC2: Raw events older than the retention period (Q-16) are aggregated or deleted automatically.
- AC3: Slips Admin can produce a machine-readable export of a store's data and delete it on request.

**Story 7.10: Cost metering and upload throttling**
As the business, I want usage measured per store, so that costs stay within plan revenue.
- AC1: Storage and video delivery are metered per store and visible in the admin view.
- AC2: Upload volume or rate far above normal is throttled with a clear message to the merchant.

**Story 7.11: Peak-load test**
As the business, I want proof the storefront survives seasonal peaks, so that a sale day does not break stores.
- AC1: A load test at 10× expected normal traffic for the NFR14 store count shows the content API and event ingestion meeting NFR2 and NFR7.
- AC2: Results and any limits found are recorded before launch.

### 6.8 Launch tasks (not dev stories)

| # | Task | Owner | Needed for |
|---|---|---|---|
| L-1 | Prepare Salla listing assets and descriptions (Arabic and English), submit the app, pass Salla review | Product owner | E1 |
| L-2 | Recruit and onboard 10 pilot merchants; agree measurement permission for Story 5.7 | Product owner | E3, E4 |
| L-3 | Publish Privacy Policy, Data Processing terms (DPA) and terms of use; link them in the listing [NEEDS LEGAL] | Product owner with legal counsel | NFR4.f-g, Salla review |
| L-4 | Legal review of PDPL points (NFR4) and an external security review | Product owner | E5, NFR4 |
| L-5 | Set up the support channel per Q-10 | Product owner | FR20 |
| L-6 | Store a snapshot of the demo (screenshots) in the repo as visual reference | UX agent | §3 |
| L-7 | Exit-criteria sign-off using the Story 7.6 report | Product owner | Phase 2 start |

---

## 7. Open Questions

| ID | Question | Owner | Deadline / trigger | Blocks |
|---|---|---|---|---|
| Q-01 | Which Salla mechanisms work for injection, cart actions, order tagging, billing, webhooks, time zone and dashboard re-entry? | Spike lead (dev) | Epic 1 gate (Story 1.6b) | Sharding of Epics 2-7; FR9, FR11, FR13, FR17, FR19, FR28 |
| Q-02 | Source of age data for the Audience page | Product owner | Before Phase 2 Audience work | Epic 8 Audience |
| Q-03 | AI scope: providers, caption/script languages, music licensing, quotas | Product owner | Before Phase 2 starts | Epic 8 AI |
| Q-04 | Plans and pricing: names, prices, limits, definition of a placement for limits, grace length, deactivation order on downgrade, trial, per-plan cost caps and behaviour at the cap | Product owner | Before Stories 7.2b/7.2c are sharded; before listing (L-1) | FR19, NFR11, Stories 7.2b-c, L-1 |
| Q-05 | Data residency: must data be stored in KSA or the region? | Product owner | Before architecture | Hosting, database region, video-service choice; pilot use of real data |
| Q-06 | Social import timing | — | **Resolved:** Phase 3 (SRS §10.3, Epic 9) | — |
| Q-07 | Will Slips support Zid, Shopify or other platforms? | Product owner | Before architecture | Whether the architecture includes a platform-adapter layer |
| Q-08 | Non-video story slides (text cards, polls, coupons) in v1? | — | **Resolved:** MVP supports image and video slides; text cards, polls and coupons are Phase 3 (FR-INT-01 to 03) | — |
| Q-09 | Who moderates content and handles abuse reports; takedown process and time; terms of use for merchant content (copyright, prohibited content) | Product owner with legal counsel | Before Salla submission (L-1) | L-3 terms; possible admin takedown in Story 7.8; CTA link policy (FR4) |
| Q-10 | Support model: channel, languages, hours, response targets | Product owner | Before Story 7.7 is built | FR20, Story 7.7, L-5 |
| Q-11 | Can required product options be selected and added via Salla? If not, confirm the FR23 "View options" behaviour | Spike lead with product owner | Epic 1 gate | FR23, Story 5.4 |
| Q-12 | Player accessibility: bring captions (FR-CON-16) into the MVP, or claim AA for the dashboard only and list player exceptions? | Product owner | Before Epic 5 stories are sharded | NFR6, Stories 5.2b, 5.3a, 3.3 |
| Q-13 | Upload limits (formats, max size, duration, resolution) and quality-check criteria | Architect with product owner | Before Story 3.3 | FR5, Stories 3.3, 3.4b |
| Q-14 | Attributed revenue: include or exclude VAT; how to apportion order-level discounts to credited line items | Product owner | Before Story 6.2b | FR13, Stories 6.2b, 6.3, E3 |
| Q-15 | Display defaults: per-placement item cap; Low-stock threshold | Product owner | Before Stories 4.3 and 2.3 | FR3, FR30 |
| Q-16 | Retention periods per data class (raw events, aggregates, order records, logs, backups) [NEEDS LEGAL] | Product owner with legal counsel | Before architecture | NFR4.d, NFR10, Story 7.9 |
| Q-17 | Scale target: number of concurrently active stores | Product owner | Before architecture | NFR14, Story 7.11 |
| Q-18 | Consent: what Salla exposes, and default tracking behaviour when no consent signal exists [NEEDS LEGAL] | Product owner with legal counsel | Epic 1 gate (G8) and before Story 6.1a | NFR4.c, Story 6.1a |
| Q-19 | MVP launch date and pilot revenue goal (Goal 6) | Product owner | Before sprint planning | Goal 6, release plan |

## 8. Scope Reconciliation with the SRS

### 8.1 Deferred from SRS
Items listed in SRS §10.1 (MVP) that are not in this PRD.

| SRS item | Reason deferred |
|---|---|
| NFR-SEC-04 role-based access control | MVP has one merchant account per store; roles arrive with team features in Phase 2. |
| NFR-A11Y-01 "captions option" (player) | Captions are FR-CON-16 (Phase 2); whether to bring them forward is Q-12. |
| FR-BIL-02 limits on AI generations, features and team seats | Those features are not in the MVP; only content and placement limits apply (SRS §10.1 plan rule). |
| FR-CON-08 per-plan upload limits | MVP uses global upload limits; per-plan limits add pricing dependencies before Q-04 closes. |
| NFR-COST-01 AI usage metering, NFR-REL-01 AI job retries | No AI in the MVP; storage, bandwidth and media-job parts are kept (NFR11, NFR12). |
| NFR-LOC-02 Hijri calendar display | Optional in the SRS; Gregorian only for the MVP. |
| SRS §4.1 configurable digit style (Western/Arabic-Indic) | Locale default formatting is enough for the MVP. |
| FR-VIS-05 "Visibility rules" link on the content page | The screen is Phase 2; the link is hidden in the MVP (SRS Appendix B item 5). |

### 8.2 Changed from SRS
| SRS item | Change in this PRD | Why |
|---|---|---|
| FR-ANA-03 attribution model | Replaced by FR13: cart-tagged line items only, window 1-14 days, refunds subtracted, no click credit | Owner decision C4; see addendum §C.1 |
| NFR-SEC-02, FR-SET-02, FR-SET-04 injector key masked/encrypted, old key invalidated | Key is a public identifier; shown in full; regenerate with overlap and cache purge (FR17, NFR3) | The key ships in every storefront page; masking gives no protection |
| NFR-PERF-02 reserve space for components | No shift when content is shown; no space reserved when no content (NFR1) | Reserved empty space is itself a visible break |
| FR-ANA-12 bot and duplicate filtering (Phase 2) | Basic dedup, origin checks and bot heuristics in the MVP (FR26) | Attribution and funnel are not trustworthy without them |
| FR-VIS-06 priority ordering (Phase 2) | MVP orders by most recently published (FR30) | Needed for any multi-item placement |
| FR-CON-03 statuses | Adds Deactivated; drops "Ready" (FR22) | Plan downgrades need a status; "Ready" duplicated Draft |

## 9. Assumptions Index
- Statuses and tab grouping (FR22); format × layout matrix (FR29).
- "Open link" CTA limited to the store's domain (FR4); external media always ingested (FR5).
- Products with required options use "View options" (FR23), pending Q-11.
- Freshness bound 2 minutes P95 for price/stock (FR24); daily reconciliation (FR25).
- Attribution: changed window applies forward; one credit per line item at full quantity (FR13).
- View counted at most once per item per viewer per 30 minutes; CTR replaces "Engagement rate" (§1.5).
- Placement counting and active-content definition for limits (§1.5), pending Q-04.
- Dashboard re-entry and sessions (FR28), pending G8.
- IP addresses not stored with events (NFR4.a); SLI definitions (NFR7); NFR2 test profile.
- 30-day post-uninstall grace (NFR10, from SRS); 30-day uninstall rate target < 20% (§1.3).
- User journeys and protagonists (§1.6).

**Key risks** (from SRS §9.2, still open): Salla injection/cart/order limits (R-01, handled by the Epic 1 gate); attribution disputes (R-02, handled by FR13 strict rules and the methodology page); player weight regressions (R-04, NFR1 in CI); PDPL non-compliance (R-05, NFR4 and legal review); seasonal spikes (R-08, NFR14 and Story 7.11). New: products with required options limit in-content purchase for fashion and cosmetics stores (FR23, Q-11).

## 10. Next Steps

- **Product owner:** close Q-05, Q-07, Q-16 and Q-17 before architecture; Q-04 before Epic 7 billing stories; review §1.6 journeys and §9 assumptions.
- **Architect agent:** produce the architecture document now, in parallel with the Epic 1 spike, using `docs/tech-stack.md` and `docs/prd-addendum.md` (notes §B); update it after the Story 1.6b gate. Scaffolding stories 1.1, 1.2 and 1.7 may run before the document is finished.
- **UX agent:** produce the front-end spec from the demo snapshot, including the player RTL/LTR gesture table, numeral and currency rules, bidi handling, onboarding and empty states, and the Disconnected and Failed states.
- **PO agent:** after the gate and the architecture, check this PRD against both and confirm stories are ready for sprint planning (the stories here are already the epic breakdown; no separate sharding is needed beyond adding technical notes).
