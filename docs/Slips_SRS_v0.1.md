# Software Requirements Specification (SRS)

## Slips (سليبس): Interactive Stories & Reels for Salla Stores

| | |
|---|---|
| **Document version** | 0.1 (Draft) |
| **Date** | 7 October 2026 |
| **Status** | For review |
| **Basis** | Analysis of the UI demo (slips-sage.vercel.app) and the competitor listing "Na3na3 / نعناع" on the Salla App Store |
| **Format** | Structured after IEEE 830 / ISO/IEC/IEEE 29148 |

> **How to read this document.** Requirements marked **[Assumption]** were inferred from the UI or from market practice and have not been confirmed. They are collected again in Section 9 so they can be confirmed or corrected. Priority uses MoSCoW: **M** = Must (MVP), **S** = Should, **C** = Could (later phase). Priorities are relative to the phase in which a requirement ships; the phase assignment for every requirement is defined in **Section 10**.

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements of **Slips**, a Salla marketplace application that lets merchants publish interactive **Stories** and **Reels** inside their Salla storefront, link them to products, let shoppers buy from within the experience, and measure the sales they generate.

It is intended for the product owner, designers, developers, QA engineers, and anyone integrating with the Salla platform.

### 1.2 Scope
Slips consists of three parts:

1. **Merchant Dashboard**: a web application where merchants create and manage content, view analytics, and configure the app.
2. **Storefront Injector (Player)**: a lightweight script loaded in the merchant's Salla theme that renders Stories/Reels and handles shopper interactions.
3. **Backend Services**: media processing, AI Reel generation, analytics ingestion, attribution, Salla integration, and billing.

**In scope:** everything visible in the demo (Overview, Videos & Stories, New Content, Products, Analytics, Audience, Settings, Store Preview), plus the plan/billing and Salla-installation flows required for a marketplace app.

**Out of scope (this version):** native mobile apps, non-Salla platforms (Shopify, Zid, WooCommerce), a creator/influencer marketplace, and live streaming.

### 1.3 Definitions and acronyms

| Term | Meaning |
|---|---|
| **Story** | Short, tappable, multi-slide vertical content (images and/or short clips), shown as a story ring or bar |
| **Reel** | Vertical, scrollable, full-screen short video experience |
| **Injector / Player** | The JavaScript bundle loaded on the storefront that renders content |
| **CTA** | Call-to-action button (for example "Order now") |
| **Attributed order** | An order that Slips can credibly link to a view or interaction with Slips content |
| **Merchant** | A Salla store owner or staff member using the dashboard |
| **Shopper** | A visitor to the merchant's storefront |
| **PDPL** | Saudi Personal Data Protection Law |
| **RTL / LTR** | Right-to-left (Arabic) / left-to-right (English) layout |

### 1.4 References
- Slips UI demo: https://slips-sage.vercel.app (dashboard, content, products, analytics, audience, settings, preview)
- Competitor listing (Na3na3): https://apps.salla.sa/ar/app/1885461125
- Salla developer documentation (OAuth, Webhooks, Merchant API, App Snippets). **To be verified against current docs before implementation.**

### 1.5 Document overview
Section 2 describes the product in context; Section 3 lists functional requirements by module; Section 4 covers external interfaces; Section 5 non-functional requirements; Section 6 the data model; Section 7 the plan structure; Section 8 competitive positioning; Section 9 assumptions, risks and open questions; Section 10 the release phasing (MVP, Phase 2, Phase 3).

---

## 2. Overall Description

### 2.1 Product perspective
Slips is a third-party application distributed through the **Salla App Store** and installed per store. It depends on Salla for authentication, product catalog, orders, billing, and storefront theme integration. Slips does not replace the store's checkout; it shortens the path to it.

```
Shopper ──► Salla Storefront ──► Slips Injector ──► Slips Backend ◄──► Salla APIs / Webhooks
                                                         ▲
Merchant ──► Slips Dashboard ────────────────────────────┘
                                   │
                         Media pipeline · AI services · Analytics store · CDN
```

### 2.2 Product functions (summary)
- Install via Salla and authenticate with OAuth
- Sync products and stock from Salla
- Create Stories and Reels from uploaded media, external links, or **AI generation**
- Tag products, add CTAs, and define where and when content appears
- Render content on the storefront with a minimal-weight player
- Let shoppers view product cards and add to cart without leaving the content
- Track the funnel (view → product click → add to cart → order) and attribute sales
- Provide audience insights and posting-time recommendations
- Enforce plan limits and billing through Salla

### 2.3 User classes

| User | Description | Primary needs |
|---|---|---|
| **Merchant Owner** | Store owner; installs the app, picks the plan | Quick setup, ROI visibility |
| **Marketing / Content Staff** | Creates and schedules content | Easy creation, scheduling, preview |
| **Analyst / Manager** | Reviews performance | Funnel, per-content revenue, audience |
| **Shopper** | Visits the storefront (mostly mobile) | Fast, smooth viewing; easy purchase |
| **Slips Admin (internal)** | Operates the platform | Monitoring, support, quota and abuse control |

### 2.4 Operating environment
- **Dashboard:** modern evergreen browsers (Chrome, Safari, Edge, Firefox), responsive from tablet up; usable on mobile.
- **Storefront player:** mobile-first (the demo reports about 91% of views on mobile); iOS Safari and Android Chrome are the primary targets.
- **Hosting:** cloud-hosted backend with CDN delivery. Data residency to be decided (see Section 9).

### 2.5 Design and implementation constraints
- Must comply with Salla App Store policies, review process, and permission scopes.
- The injector must be delivered through the mechanism Salla permits for apps (script/snippet injection into the theme). **[Assumption: to be validated.]**
- Must support Arabic (RTL) and English (LTR).
- Must operate within Salla API rate limits.
- Pricing displayed in SAR; the Salla App Store shows prices excluding 15% VAT.

### 2.6 Assumptions and dependencies
See Section 9. The key dependencies are Salla's OAuth, webhooks, product and order APIs, subscription billing events, and theme injection.

---

## 3. Functional Requirements

### 3.1 Installation, Authentication & Onboarding (AUTH)

| ID | Requirement | Priority |
|---|---|---|
| FR-AUTH-01 | The system shall support installation from the Salla App Store and authenticate the merchant via Salla OAuth 2.0. | M |
| FR-AUTH-02 | The system shall securely store and automatically refresh Salla access tokens. | M |
| FR-AUTH-03 | On first install, the system shall run an onboarding checklist: connect store, sync products, install the injector, create the first content. | M |
| FR-AUTH-04 | The dashboard shall show a "Connected to Salla" status with the store name (as in the demo header). | M |
| FR-AUTH-05 | On app uninstall (Salla webhook), the system shall deactivate the injector for that store, stop billing-related processing, and apply the data-retention policy (Section 5.4). | M |
| FR-AUTH-06 | The system shall allow merchants to invite team members with roles (see FR-SET-05). | S |

### 3.2 Dashboard / Overview (DASH)

| ID | Requirement | Priority |
|---|---|---|
| FR-DASH-01 | The dashboard shall greet the user and show the current date. | C |
| FR-DASH-02 | The dashboard shall show four headline KPIs with percentage change versus the previous period: **Views**, **Engagement rate**, **Product clicks**, **Attributed sales (SAR)**. | M |
| FR-DASH-03 | The dashboard shall show a 7-day performance chart. | M |
| FR-DASH-04 | The dashboard shall list the latest content (title, last activity, views, engagement, status) with filters **All / Published / Drafts** and a link to the full list. | M |
| FR-DASH-05 | For merchants with no content, the dashboard shall show a call-to-action banner to "Create your first story". | M |

### 3.3 Content Management (CON)

| ID | Requirement | Priority |
|---|---|---|
| FR-CON-01 | The system shall list all content in a table with columns: title and type, placement, status, views, clicks, actions. | M |
| FR-CON-02 | The list shall support filtering by status: **All, Published, Scheduled, Drafts**, and show counts per status. | M |
| FR-CON-03 | The system shall support the content statuses **Draft, Scheduled, Published**, plus **Archived** and **Processing/Failed** **[Assumption]**. | M |
| FR-CON-04 | The merchant shall be able to create content by choosing a **display format**: **Story** or **Reels**. | M |
| FR-CON-05 | A content item shall have: title, format, linked product, content type, CTA button, media items, visibility rules, and auto-publish setting. | M |
| FR-CON-06 | The merchant shall be able to attach **multiple images and/or videos** to a single Story or Reel. | M |
| FR-CON-07 | Media may be supplied by **file upload** (multi-select, batch additions allowed) or by **external link**. | M |
| FR-CON-08 | The system shall validate uploads (type, size, duration, resolution) and show clear errors. Limits per plan (Section 7). | M |
| FR-CON-09 | The system shall process uploaded video: transcode to multiple renditions (for example 1080p / 720p / 480p), generate poster images, and run a **quality check**. | M |
| FR-CON-10 | If **auto-publish after processing** is enabled, the content shall go live automatically after a successful quality check; otherwise it remains a draft. | M |
| FR-CON-11 | The merchant shall be able to edit, duplicate, archive, and delete content. | M |
| FR-CON-12 | The create/edit page shall show a **live vertical preview** that updates as the merchant edits. | M |
| FR-CON-13 | The merchant shall be able to define the **CTA**: label (for example "Order now"), action (add to cart / open product / open link), and, optionally, style. | M |
| FR-CON-14 | Merchants shall be able to reorder slides inside a Story/Reel by drag and drop. | S |
| FR-CON-15 | The system shall support importing videos from **TikTok and Instagram** by URL or account connection. **[Assumption: gap versus the competitor; subject to platform API terms.]** | C |
| FR-CON-16 | The system shall support captions/subtitles per video. | S |
| FR-CON-17 | The system shall support scheduled publish and optional scheduled unpublish date/time (see FR-VIS-04). | M |

### 3.4 AI Reel Generation (AI)

The demo shows an "AI Reel" entry point on the content-creation page. Capabilities are tiered by plan (final tiers in Section 7).

| ID | Requirement | Priority |
|---|---|---|
| FR-AI-01 | The merchant shall be able to start content creation via **"Generate Reel with AI"**. | M |
| FR-AI-02 | **Level 1, Images to Reel:** from 1 to N product images (picked from Salla product media or uploaded), the system shall generate a short vertical video with motion, transitions, and a branded end-frame. | M |
| FR-AI-03 | **Level 2, Enhancement:** the system shall add auto-generated **captions** (Arabic and English) and **royalty-free background music** chosen from a licensed library. | S |
| FR-AI-04 | **Level 3, Script:** the system shall generate a short **marketing script / on-screen text** from the product's name, description, and price in Arabic or English, editable before rendering. | S |
| FR-AI-05 | The merchant shall be able to preview, regenerate, and edit the output (text, order, music) before saving. | M |
| FR-AI-06 | AI generation shall consume a **monthly quota** according to the plan; the dashboard shall show remaining usage and block generation (with an upgrade prompt) when exhausted. | M |
| FR-AI-07 | Generation shall run asynchronously with progress status and notification on completion or failure. | M |
| FR-AI-08 | All AI-generated content shall be reviewed by the merchant before publication; the system shall never auto-publish AI output without the merchant's explicit approval. | M |
| FR-AI-09 | The system shall filter prompts and outputs for prohibited content and comply with the AI provider's usage policies. | M |
| FR-AI-10 | The merchant shall be able to disable AI features for their store. | C |

### 3.5 Visibility Rules & Scheduling (VIS)

| ID | Requirement | Priority |
|---|---|---|
| FR-VIS-01 | Each content item shall have **placement rules** defining where it appears: **Home page, Category page, Product page**. | M |
| FR-VIS-02 | The merchant shall optionally specify a **target ID** (a specific category or product) to narrow the placement. | M |
| FR-VIS-03 | Content with no placement defined shall not be publishable (the demo shows "Not specified" for drafts). | M |
| FR-VIS-04 | The merchant shall be able to schedule start (and optionally end) time; scheduled items change to Published automatically. | M |
| FR-VIS-05 | The system shall provide a **"Visibility rules"** overview screen (linked from the content list) listing what shows where. | S |
| FR-VIS-06 | If multiple items match a placement, the system shall order them by a merchant-defined priority, then recency. | S |
| FR-VIS-07 | If the linked product becomes unavailable, the system shall follow the stock behavior defined in FR-PRD-05. | M |

### 3.6 Product Catalog Integration (PRD)

| ID | Requirement | Priority |
|---|---|---|
| FR-PRD-01 | The system shall import the merchant's Salla products (name, image, category, price, availability) and keep them in sync. | M |
| FR-PRD-02 | Sync shall be **automatic** via Salla webhooks, with a manual **"Sync products"** button and a **last sync** timestamp shown. | M |
| FR-PRD-03 | The Products page shall list each product with category, price, **number of linked content items**, **attributed orders**, and **availability** (Available / Low / Out of stock). | M |
| FR-PRD-04 | The page shall support filtering by category and searching by name. | M |
| FR-PRD-05 | **Stock behavior:** for out-of-stock products, the CTA shall switch to a configurable state (hide, "Out of stock", or "Notify me") **[Assumption]**; for low stock, an optional "Few left" label may be shown. | S |
| FR-PRD-06 | Price and availability shown to shoppers inside content shall always reflect the latest synced data. | M |
| FR-PRD-07 | The "Open" action on a product shall show that product's linked content and performance. | S |
| FR-PRD-08 | The system shall support products with variants (size, color) and let the shopper choose a variant before adding to cart. | S |

### 3.7 Storefront Injector / Player (INJ)

| ID | Requirement | Priority |
|---|---|---|
| FR-INJ-01 | The injector shall load on the merchant's storefront using the store's **injector key** and render only content eligible for the current page (type, ID, schedule, status). | M |
| FR-INJ-02 | The player shall support **Story mode**: story rings/bar, tap-to-advance, progress indicators, swipe to close. | M |
| FR-INJ-03 | The player shall support **Reels mode**: full-screen vertical swipe feed, one video at a time, per-video sound control. | M |
| FR-INJ-04 | Videos shall start **muted by default** and respect device and browser settings (autoplay, data saver, reduced motion). | M |
| FR-INJ-05 | Media shall be **lazy-loaded**: nothing heavy loads until the component is near or in the viewport. | M |
| FR-INJ-06 | The player shall pick the video rendition based on network quality (adaptive). | M |
| FR-INJ-07 | The player shall render correctly in **RTL and LTR** and follow the storefront language. | M |
| FR-INJ-08 | The player shall integrate visually with the store theme (colors, fonts, radius) via configurable settings. Deep template customization is reserved for higher plans. | S |
| FR-INJ-09 | The player shall fail gracefully: if the Slips service is unreachable, the storefront must remain fully functional with no visible errors. | M |
| FR-INJ-10 | The player shall be embeddable as: a product-page strip (below images or custom position), a home/category carousel (boxed or full width), and a full-screen Reels experience. | M |

### 3.8 Product Tagging & In-Content Purchase (BUY)

| ID | Requirement | Priority |
|---|---|---|
| FR-BUY-01 | A content item shall show a **product card** (image, name, price, CTA) tied to the linked product. | M |
| FR-BUY-02 | Tapping the CTA shall add the product to the Salla cart **without leaving the content experience**, with visual confirmation. | M |
| FR-BUY-03 | The system shall support multiple products per content item, each with a visibility window (appears at time X of the video) **[Assumption: seen in competitor]**. | S |
| FR-BUY-04 | A secondary action shall allow the shopper to open the product page or go to the cart/checkout. | M |
| FR-BUY-05 | Every add-to-cart made through Slips shall be **tagged** (for example with a cart/session marker) so later orders can be attributed. | M |
| FR-BUY-06 | Errors (out of stock, API failure) shall show a clear, localized message and keep the shopper in the experience. | M |
| FR-BUY-07 | The system shall support a coupon/offer overlay on content. | C |

### 3.9 Analytics & Attribution (ANA)

| ID | Requirement | Priority |
|---|---|---|
| FR-ANA-01 | The system shall capture events: **impression, view start, quartile progress, completion, slide advance, product click, add to cart, share (if enabled)**. | M |
| FR-ANA-02 | The system shall ingest **Salla order data** and attribute orders to Slips interactions using the model in FR-ANA-03. | M |
| FR-ANA-03 | **Attribution model [Assumption]:** last-touch; an order is attributed if it contains a product added via Slips, or follows a Slips product click, within a **configurable window (default 7 days)** in the same shopper session/browser. | M |
| FR-ANA-04 | The Analytics page shall show: total views, unique viewers, product clicks, **attributed orders**, each with change versus the previous period. | M |
| FR-ANA-05 | The page shall support date ranges: **Last 7 days, Last 30 days, This month**, and custom range. | M |
| FR-ANA-06 | The page shall show a **conversion funnel**: view → product click → add to cart → order, with counts and step conversion rates. | M |
| FR-ANA-07 | The page shall show a **best time to post** heatmap/recommendation (for example "Thursday 9 PM is best") derived from audience activity. | S |
| FR-ANA-08 | The page shall show **per-content performance**: views, completion rate, CTR, attributed revenue (SAR). | M |
| FR-ANA-09 | Sorting and comparing content by any metric shall be supported. | S |
| FR-ANA-10 | The system shall allow exporting reports (CSV). | S |
| FR-ANA-11 | Metric definitions (view, unique viewer, completion, CTR, engagement) shall be documented in-app via tooltips. | S |
| FR-ANA-12 | Bot and duplicate traffic shall be filtered from counts. | S |

### 3.10 Audience Insights (AUD)

| ID | Requirement | Priority |
|---|---|---|
| FR-AUD-01 | The Audience page shall show: **active audience** (unique visitors who viewed content), **repeat viewers %**, **mobile share %**, and **top city**. | M |
| FR-AUD-02 | It shall show the **age-group distribution** of viewers who engage most (18–24, 25–34, 35–44, 45+). | S |
| FR-AUD-03 | It shall show **top cities** by engagement for the last 30 days, with an "other cities" bucket. | M |
| FR-AUD-04 | Audience data shall be **aggregated and anonymous**; no individual shopper profile shall be exposed in the dashboard. | M |
| FR-AUD-05 | The source of demographic data shall be defined and documented (see Section 9, Q-02). Until defined, age groups shall be treated as optional and hidden when not reliably available. | M |
| FR-AUD-06 | Where the system collects shopper data or cookies, it shall provide the merchant with consent guidance and respect the store's consent state (see Section 5.3). | M |

### 3.11 Store Preview (PRV)

| ID | Requirement | Priority |
|---|---|---|
| FR-PRV-01 | A "Preview store" page shall let the merchant toggle between **Stories** and **Reels** and see a live simulation, including the in-content product card and "Order now" button. | M |
| FR-PRV-02 | The page shall display the injector's footprint, language support, and shoppable capability as reassurance. | C |
| FR-PRV-03 | The page shall provide **installation instructions** for the injector (linked from Settings). | M |
| FR-PRV-04 | Merchants shall be able to preview a specific content item on a desktop or mobile frame before publishing. | S |

### 3.12 Settings & Team (SET)

| ID | Requirement | Priority |
|---|---|---|
| FR-SET-01 | **Salla Connection tab:** show connection status, store name and URL, and allow reconnecting or disconnecting. | M |
| FR-SET-02 | **Injector & Visibility tab:** show the **injector key** (masked, with reveal/copy and regenerate), installation guide, and default display options. | M |
| FR-SET-03 | **Security & Team tab:** manage team members, roles, and active sessions. | S |
| FR-SET-04 | Regenerating the injector key shall invalidate the old key and prompt for re-installation. | M |
| FR-SET-05 | Roles shall include at least **Owner, Editor (create/edit), Viewer (analytics only)**. **[Assumption]** | S |
| FR-SET-06 | Changes shall be saved explicitly with a confirmation message ("Changes saved"). | M |
| FR-SET-07 | The merchant shall be able to choose the dashboard language (Arabic / English). | M |
| FR-SET-08 | The merchant shall be able to export or delete their data (see Section 5.4). | S |

### 3.13 Plans, Quotas & Billing (BIL)

| ID | Requirement | Priority |
|---|---|---|
| FR-BIL-01 | Subscription and payment shall be handled through **Salla's app billing**. Slips shall react to Salla subscription events (start, renew, upgrade, downgrade, cancel, expire). | M |
| FR-BIL-02 | The system shall enforce plan limits: number of active videos/stories, placements, AI generations, features, and team seats (Section 7). | M |
| FR-BIL-03 | The dashboard shall show current plan and usage with warnings at 80% and 100%. | M |
| FR-BIL-04 | On downgrade or expiry, content above the plan limit shall be **deactivated (not deleted)**, with merchant notification and a grace period. | M |
| FR-BIL-05 | A free trial (for example 7 days) shall be supported if configured in Salla. **[Assumption]** | S |

### 3.14 Notifications & Support (NOT)

| ID | Requirement | Priority |
|---|---|---|
| FR-NOT-01 | In-app notifications for: processing finished/failed, scheduled content published, quota warnings, sync errors, billing events. | S |
| FR-NOT-02 | Optional email notifications for critical events (failed processing, disconnected store, plan expiry). | S |
| FR-NOT-03 | A "Need help? Contact support" entry point shall be available on every page. | M |

---

## 4. External Interface Requirements

### 4.1 User interfaces
- **Layout:** right-side navigation (RTL default) with items: Overview, Videos & Stories, Products, Analytics, Audience; Settings at the bottom; store identity and connection status at the top; "Preview store" button on every page.
- **Bilingual:** full Arabic and English UI. Layout mirrors automatically (RTL/LTR). Numbers are displayed according to locale settings (Western or Arabic-Indic digits, configurable) **[Assumption]**.
- **Responsive:** dashboard fully usable on tablet and desktop, and functional on mobile.
- **Consistency:** shared components for tables, filters, KPI cards, empty states, loaders, and error messages.

### 4.2 Salla platform interfaces
| Interface | Use |
|---|---|
| OAuth 2.0 | Merchant authorization, token refresh |
| Merchant API | Products, categories, store info, cart actions (as permitted), orders |
| Webhooks | App installed/uninstalled, product created/updated, stock changes, order created/updated, subscription events |
| Theme / snippet injection | Load the injector on storefront pages |
| App billing | Plans and subscriptions |

All endpoint names, scopes and limits must be confirmed against the current Salla documentation before design is finalized.

### 4.3 Third-party service interfaces
- **Media storage & CDN:** for uploads, renditions, and player delivery.
- **Video transcoding service:** adaptive renditions and posters.
- **AI services:** video composition, speech/caption generation, and text generation (provider TBD).
- **Email service:** transactional email.
- **Optional social import:** TikTok / Instagram **[subject to their API terms]**.

### 4.4 Software interfaces (internal)
- **Injector ↔ Backend:** public read API for eligible content (cached, keyed by store) and an event-ingestion endpoint (batched, beacon-based).
- **Dashboard ↔ Backend:** authenticated REST/GraphQL API.

---

## 5. Non-Functional Requirements

### 5.1 Performance
| ID | Requirement |
|---|---|
| NFR-PERF-01 | The injector's initial payload shall be **≤ 50 KB** (target ~20 KB gzip for the core loader), with additional modules loaded on demand. |
| NFR-PERF-02 | The injector shall add **zero layout shift** (CLS = 0 contribution) by reserving space for embedded components. |
| NFR-PERF-03 | The injector shall not block rendering; it shall load asynchronously and defer heavy work until interaction or viewport entry. |
| NFR-PERF-04 | First video frame shall appear within **2 seconds** on a typical 4G connection after the shopper opens the player. |
| NFR-PERF-05 | Dashboard pages shall reach interactive state in **≤ 3 seconds** on a standard broadband connection; analytics queries shall return in **≤ 2 seconds** for a 30-day range at P95. |
| NFR-PERF-06 | Media processing for a 60-second video shall complete within **5 minutes** at P95 (excluding queue spikes). |
| NFR-PERF-07 | The injector shall not reduce the store's Core Web Vitals scores by more than a negligible margin (to be measured against a baseline store). |

### 5.2 Scalability & availability
| ID | Requirement |
|---|---|
| NFR-SCAL-01 | The platform shall support at least **[TBD, for example 5,000] concurrently active stores** and absorb **seasonal peaks of 10× normal traffic** (for example Ramadan, White Friday, National Day sales). |
| NFR-SCAL-02 | The storefront content API shall be CDN-cached, with cache invalidation within 1 minute of a publish/unpublish event. |
| NFR-AVAIL-01 | Storefront-facing services shall target **99.9% monthly availability**; dashboard **99.5%**. |
| NFR-AVAIL-02 | Event ingestion shall tolerate temporary backend outages through client-side retry and queuing. |

### 5.3 Security & Privacy
| ID | Requirement |
|---|---|
| NFR-SEC-01 | All traffic shall use TLS 1.2+; data at rest shall be encrypted. |
| NFR-SEC-02 | Salla tokens and injector keys shall be stored encrypted; the injector key shall be shown masked. |
| NFR-SEC-03 | The system shall enforce **tenant isolation**: a merchant can only access their own store's data. |
| NFR-SEC-04 | Role-based access control shall apply to the dashboard (Section 3.12). |
| NFR-SEC-05 | The system shall guard against common web vulnerabilities (OWASP Top 10), including XSS in merchant-supplied text and links, SSRF in external-link media fetching, and unsafe file uploads (type/content validation, malware scanning). |
| NFR-SEC-06 | Webhooks from Salla shall be verified (signature/secret) and processed idempotently. |
| NFR-SEC-07 | Rate limiting shall be applied to public endpoints and the event-ingestion API. |
| NFR-PRIV-01 | The system shall comply with the **Saudi PDPL** and shall be designed to also satisfy GDPR-style principles (minimization, purpose limitation, retention limits). |
| NFR-PRIV-02 | Shopper analytics shall use pseudonymous identifiers; no personal data (name, phone, email) shall be stored in analytics events. |
| NFR-PRIV-03 | Tracking shall honor the store's cookie/consent configuration and "Do Not Track"/consent signals where applicable. |
| NFR-PRIV-04 | A Privacy Policy and Data Processing terms covering the merchant–Slips relationship shall be published and linked in the app listing. |

> **Note.** Audience data (age, city) is a regulated area under PDPL even when aggregated, depending on how it is collected. Even if it is not a priority for the first release, these requirements should stay in the MVP baseline, and the exact obligations should be confirmed with legal counsel.

### 5.4 Data retention
| ID | Requirement |
|---|---|
| NFR-DATA-01 | After uninstall, merchant content and settings shall be retained for a grace period (default **30 days**, **[Assumption]**) to allow reinstall, then permanently deleted. |
| NFR-DATA-02 | Raw analytics events shall be retained for **[TBD, for example 13 months]**, then aggregated or deleted. |
| NFR-DATA-03 | Merchants shall be able to request export and deletion of their data. |

### 5.5 Localization & Accessibility
| ID | Requirement |
|---|---|
| NFR-LOC-01 | Every user-facing string (dashboard and storefront player) shall be externalized and available in Arabic and English. |
| NFR-LOC-02 | Dates, numbers, and currency (SAR) shall be formatted per locale; Hijri calendar display is optional **[Assumption]**. |
| NFR-LOC-03 | The system shall handle mixed-direction text (for example English product names inside Arabic UI) correctly. |
| NFR-A11Y-01 | The dashboard and player shall target **WCAG 2.1 AA**: keyboard navigation, focus states, contrast, alt text, captions option, and reduced-motion support. |

### 5.6 Compatibility
| ID | Requirement |
|---|---|
| NFR-COMP-01 | The injector shall work with Salla's official themes and common custom themes; compatibility testing matrix to be maintained. |
| NFR-COMP-02 | The player shall support iOS Safari (last 3 major versions), Android Chrome (last 3), Samsung Internet, and desktop browsers (Chrome, Safari, Edge, Firefox, last 2 versions). |
| NFR-COMP-03 | The injector shall not pollute the global namespace or conflict with theme CSS/JS (style isolation, for example Shadow DOM). |

### 5.7 Reliability, Observability & Maintainability
| ID | Requirement |
|---|---|
| NFR-REL-01 | Failed media/AI jobs shall be retried automatically, with a clear failure state shown to the merchant. |
| NFR-OBS-01 | The platform shall provide logging, metrics, tracing, and alerting for API errors, queue depth, processing failures, Salla API failures, and injector error rates. |
| NFR-OBS-02 | An internal admin console shall allow support staff to look up a store, its sync state, jobs, and plan usage. |
| NFR-MNT-01 | The injector shall be versioned; breaking changes shall be rolled out gradually with rollback capability. |
| NFR-BKP-01 | Databases shall be backed up daily with point-in-time recovery; restore tested at least quarterly. |

### 5.8 Cost & Abuse Control
| ID | Requirement |
|---|---|
| NFR-COST-01 | Storage, bandwidth, and AI usage shall be metered per store to protect margins and enforce plan limits. |
| NFR-COST-02 | The system shall detect and throttle abusive upload/generation behavior. |

---

## 6. Data Model (Logical)

| Entity | Key attributes |
|---|---|
| **Store** | store_id, Salla merchant ID, name, URL, language, plan, injector_key, status, installed_at |
| **User / TeamMember** | user_id, store_id, name, email, role, last_login |
| **Product** (synced) | product_id, store_id, salla_product_id, name, category, price, currency, image(s), availability, variants, updated_at |
| **Content** | content_id, store_id, title, format (story/reel), source (upload/link/AI), status, cta_label, cta_action, auto_publish, scheduled_start, scheduled_end, created_by, created_at |
| **ContentItem (slide/clip)** | item_id, content_id, order, media_type, source_url, renditions[], poster, duration, caption_track |
| **ContentProduct** | content_id, product_id, show_from_sec, show_to_sec |
| **VisibilityRule** | rule_id, content_id, page_type (home/category/product), target_id (nullable), priority |
| **AIJob** | job_id, store_id, content_id, level (1/2/3), inputs, status, cost_units, created_at |
| **Event** | event_id, store_id, content_id, item_id, type, session_id (pseudonymous), device, city (derived), timestamp |
| **AttributedOrder** | order_id, store_id, content_id, product_id, amount, attributed_at, window_rule |
| **Subscription / Usage** | store_id, plan, period, usage counters (videos, AI generations, seats) |
| **Notification** | id, store_id, type, payload, read_at |

---

## 7. Plans & Limits (Proposed, to be finalized)

> Based on the competitor's pricing (59 / 99 / 199 SAR per month excl. VAT). Names and figures below are **placeholders**.

| Capability | Starter | Pro | Growth |
|---|---|---|---|
| Active content items | 10 | 50 | 290 |
| Placements | 2 (for example Home, Product) | All | All |
| Formats | Stories + Reels | Stories + Reels | Stories + Reels |
| In-content add to cart | Yes (recommended as table stakes; competitor reserves it for higher plans) | Yes | Yes |
| Analytics | Basic (views, clicks) | Full funnel + attribution | Full + export + audience |
| **AI Level 1:** images to Reel | Limited (for example 5/month) | 30/month | 150/month |
| **AI Level 2:** captions + music | No | Yes (limited) | Yes |
| **AI Level 3:** script generation | No | No / limited | Yes |
| Social import (TikTok/Instagram) | No | Yes | Yes |
| Theme customization | Basic | Standard | Full |
| Team seats | 1 | 3 | 10 |
| Support | Standard | Priority | Dedicated account manager |

---

## 8. Competitive Positioning

| Area | Na3na3 (competitor) | Slips (this product) |
|---|---|---|
| Content types | Videos / Reels | **Stories and Reels** |
| Shoppable video | Yes (from Basic plan) | Yes |
| Performance claim | ~20 KB player, lazy loading, 3 renditions | Target ≤ 50 KB (aim for ~20 KB core); must match the claim |
| AI creation | Not advertised | **AI Reels (3 levels)** |
| Scheduling & visibility rules | Placement locations | **Scheduling + page/category/target-ID rules** |
| Analytics | Plays, completions, clicks, add-to-cart | Funnel to **orders**, best time to post, per-content revenue |
| Audience insights | Not advertised | **Age, city, repeat viewers** |
| Social import | TikTok + Instagram | Planned (Could) |
| Reviews | 0 (new) | n/a |

**Differentiation to protect:** AI creation, audience and timing insights, and Stories. **Parity to achieve:** player weight, add-to-cart in-video, social import.

---

## 9. Assumptions, Risks & Open Questions

### 9.1 Assumptions
| ID | Assumption |
|---|---|
| A-01 | Salla permits script/snippet injection into storefront themes for approved apps and provides APIs to add to cart and read orders. |
| A-02 | Orders can be attributed through cart tagging plus order webhooks (last-touch, 7-day window). |
| A-03 | Slips is distributed via the Salla App Store with Salla-managed billing and a free trial. |
| A-04 | City-level data can be derived from IP geolocation; age data requires a defined source (see Q-02). |
| A-05 | AI features will use third-party providers with usage-based costs. |
| A-06 | Roles beyond Owner (Editor, Viewer) are needed. |
| A-07 | Out-of-stock behavior is configurable per merchant. |
| A-08 | Data retention periods listed in Section 5.4 are acceptable. |

### 9.2 Risks
| ID | Risk | Mitigation |
|---|---|---|
| R-01 | Salla API/theme-injection limits change or restrict the injector | Early technical spike; stay aligned with Salla partner docs |
| R-02 | Attribution accuracy disputes (merchants doubt numbers) | Transparent definitions, configurable window, clear methodology page |
| R-03 | AI costs exceed plan revenue | Strict quotas, metering, cost caps per plan |
| R-04 | Player weight/performance regress and harm store speed | Performance budget in CI; third-party store benchmarks |
| R-05 | Privacy/PDPL non-compliance around audience data | Aggregation only, consent handling, legal review |
| R-06 | AI-generated content (misleading, copyrighted music, inappropriate) | Licensed music library, content filtering, mandatory merchant approval |
| R-07 | Social import breaks due to platform API/ToS changes | Treat as optional; manual upload remains primary |
| R-08 | Seasonal traffic spikes overload the storefront API | CDN-first design, load testing before peak seasons |

### 9.3 Open questions

| ID | Question |
|---|---|
| Q-01 | Which exact Salla mechanism will be used for injection, cart actions, and order attribution? (Technical spike recommended.) |
| Q-02 | What is the source of **age** data for the Audience page (not available from Salla by default)? Options: omit, user-declared, third-party, or modeled estimate. |
| Q-03 | Final **AI scope**: which providers, which languages for captions and scripts, music licensing source, and per-plan quotas? |
| Q-04 | Final **plans and pricing**: are the placeholders in Section 7 acceptable? Should in-video add-to-cart be in every plan? |
| Q-05 | **Data residency** requirements (store data in KSA or the region?). |
| Q-06 | Is **social import** (TikTok/Instagram) an MVP requirement or Phase 2? |
| Q-07 | Is there a need for **Zid, Shopify**, or other platforms in the future (affects architecture)? |
| Q-08 | Should the injector support **non-video** story slides such as text cards, polls, or coupon stickers in v1? |
| Q-09 | Who moderates content and handles abuse reports? |
| Q-10 | Support model: languages, hours, SLAs (the competitor advertises 24-hour support). |

---

## 10. Release Phasing

### 10.0 Overview and rules

| Phase | Theme | Goal |
|---|---|---|
| **MVP (Phase 1)** | *Publish, sell, measure* | Get approved on the Salla App Store and prove the core loop: a merchant publishes a Story/Reel, a shopper adds to cart from it, and the merchant sees attributed orders. |
| **Phase 2** | *Create faster, understand better* | Reduce the effort of making content (AI) and deepen insight (audience, timing, exports) to raise retention and justify higher plans. |
| **Phase 3** | *Optimize and scale* | Add growth and optimization tools (A/B testing, interactive elements, social import, advanced reporting) and reach feature parity or better against competitors. |

**Phasing rules**
1. **Section 3 priorities (M/S/C) are relative to the phase in which a requirement is delivered.** Where a requirement is marked M but assigned to Phase 2 or 3 below (for example the AI and Audience requirements), the phase assignment governs delivery timing.
2. **Non-functional requirements (Section 5) apply from the MVP** unless explicitly noted. Security, privacy, localization, and performance budgets are not deferred.
3. **Plan limits (Section 7)** for features not yet released are hidden from the plan comparison until the feature ships.
4. Each phase has **exit criteria** (below); the next phase does not start full development until they are met.

### 10.1 MVP (Phase 1): Publish, sell, measure

**Objective:** a complete, shippable Salla app with the smallest feature set that delivers the core value and passes Salla review.

**Included requirements**

| Module | Requirements |
|---|---|
| Install & auth | FR-AUTH-01 to 05 |
| Dashboard | FR-DASH-02 to 05 |
| Content management | FR-CON-01 to 13, FR-CON-17 |
| Visibility & scheduling | FR-VIS-01 to 04, FR-VIS-07 |
| Product sync | FR-PRD-01 to 04, FR-PRD-06; FR-PRD-05 in **basic form** (CTA is disabled and shows "Out of stock" for unavailable products; configurable behavior comes in Phase 2) |
| Injector / player | FR-INJ-01 to 07, FR-INJ-09, FR-INJ-10 |
| In-content purchase | FR-BUY-01, 02, 04, 05, 06 |
| Analytics & attribution | FR-ANA-01 to 06, FR-ANA-08, FR-ANA-11 |
| Preview | FR-PRV-01, FR-PRV-03 |
| Settings | FR-SET-01, 02, 04, 06, 07 |
| Billing | FR-BIL-01 to 05 (limits apply to the features available in this phase) |
| Support | FR-NOT-03 |
| Non-functional | All of Section 5 |

**Explicitly deferred from MVP:** AI generation, Audience page, best-time-to-post, team roles, notifications, CSV export, theme customization, social import, multi-product timed tags, coupons/stickers, A/B testing.

**MVP plan structure (simplified):** limits on active content items and placements only; Section 7 AI, social-import, and team-seat rows are not shown.

**Key dependencies and risks**
- Salla technical spike (Q-01) must be completed first: injection, cart actions, and order webhooks.
- Attribution methodology (FR-ANA-03) must be validated with real store data before launch (R-02).
- Performance budget (NFR-PERF-01 to 03) must be enforced in CI from day one (R-04).

**Exit criteria**
- Approved and listed on the Salla App Store.
- Injector initial payload within budget and zero measured layout shift on at least three representative themes.
- Attributed-order numbers reconcile with Salla order data within an agreed tolerance (for example ±3%) on pilot stores.
- At least **[TBD, for example 10]** pilot merchants live, each with published content and at least one attributed order.
- No open critical/high security findings.

### 10.2 Phase 2: Create faster, understand better

**Objective:** increase content volume and merchant retention by making creation easier, and give merchants insight that guides what to publish next.

**Included requirements**

| Module | Requirements |
|---|---|
| **AI Reels, Levels 1 and 2** | FR-AI-01, 02, 03, 05, 06, 07, 08, 09 (Level 1 images-to-Reel on lower plans; Level 2 captions and music on higher plans) |
| **Audience insights** | FR-AUD-01 to 06 (age groups shown only once the data source in Q-02 is decided and reliable) |
| **Analytics depth** | FR-ANA-07 (best time to post), FR-ANA-09 (compare/sort), FR-ANA-10 (CSV export), FR-ANA-12 (bot and duplicate filtering) |
| **Team & security** | FR-AUTH-06, FR-SET-03, FR-SET-05 (Owner / Editor / Viewer roles) |
| **Content tools** | FR-CON-14 (reorder slides), FR-CON-16 (captions per video) |
| **Visibility** | FR-VIS-05 (Visibility rules overview screen), FR-VIS-06 (priority ordering) |
| **Products** | FR-PRD-05 (configurable out-of-stock / low-stock behavior), FR-PRD-07, FR-PRD-08 (variants) |
| **Player** | FR-INJ-08 (theme-matching customization, standard level) |
| **Preview** | FR-PRV-04 (per-content device preview) |
| **Notifications** | FR-NOT-01, FR-NOT-02 |
| **Data rights** | FR-SET-08 (data export and deletion self-service) |

**Plan impact (Section 7):** AI Level 1 and 2 quotas, audience insights, CSV export, and team seats become plan differentiators. Starter / Pro / Growth limits are activated for these features.

**Key dependencies and risks**
- AI provider selection, music licensing, and cost modeling (Q-03, R-03, R-06) must be closed before development.
- Audience data source and legal review (Q-02, R-05) must be closed before the Audience page ships.
- Variant handling needs verification against the Salla product/cart APIs.

**Exit criteria**
- AI cost per generation within the agreed margin for every plan at quota; metering and quota enforcement verified.
- At least **[TBD, for example 40%]** of active merchants have used one Phase 2 feature in a 30-day period.
- Audience page released with a documented data source and legal sign-off.
- Role-based access verified by security testing.

### 10.3 Phase 3: Optimize and scale

**Objective:** help merchants improve conversion systematically, widen content sources, and strengthen the competitive position, especially against Na3na3's social import.

**Included requirements**

| Module | Requirements |
|---|---|
| **AI Level 3 (scripts)** | FR-AI-04 (marketing script and on-screen text from product data), FR-AI-10 (merchant can disable AI) |
| **Social import** | FR-CON-15 (TikTok and Instagram import, subject to platform API terms; manual upload remains the primary path) |
| **Multi-product timed tags** | FR-BUY-03 |
| **Coupons and offers** | FR-BUY-07 |
| **Store preview extras** | FR-PRV-02 |
| **Full theme customization** | Extension of FR-INJ-08 to complete template-level control (Growth plan) |

**New requirements introduced in Phase 3**

*A/B testing (EXP)*

| ID | Requirement | Priority |
|---|---|---|
| FR-EXP-01 | The merchant shall be able to create an experiment on a content item by defining two or more variants (for example a different cover, first slide, or CTA label). | M |
| FR-EXP-02 | The system shall split eligible shopper traffic between variants and record results per variant. | M |
| FR-EXP-03 | The dashboard shall show variant results (views, CTR, add-to-cart, attributed orders) with a basic indication of statistical confidence, and let the merchant promote the winner. | M |
| FR-EXP-04 | An experiment shall have a defined start, end, and minimum-sample rule, and shall not alter attribution logic. | S |

*Interactive elements (INT)*

| ID | Requirement | Priority |
|---|---|---|
| FR-INT-01 | Stories shall support **text-only cards** and **image cards** without video. (Resolves Q-08.) | M |
| FR-INT-02 | Stories shall support **poll and quiz stickers** with aggregated results shown to the merchant. | S |
| FR-INT-03 | Stories shall support a **coupon sticker** that reveals or copies a Salla coupon code, linked to FR-BUY-07. | S |
| FR-INT-04 | Interactions shall be tracked as events and included in analytics (FR-ANA-01). | M |

*Advanced reporting (RPT)*

| ID | Requirement | Priority |
|---|---|---|
| FR-RPT-01 | The system shall provide **cohort and trend views**, for example repeat-viewer conversion and weekly performance trends. | S |
| FR-RPT-02 | The system shall support **scheduled email reports** (weekly/monthly summary) to chosen recipients. | S |
| FR-RPT-03 | The system shall allow comparing **content formats** (Story vs Reel) and **placements** (home vs category vs product) on conversion and revenue. | S |
| FR-RPT-04 | The system shall provide **product-level insights**: which products gain the most from content and which products have demand but no content. | C |

**Plan impact (Section 7):** AI Level 3, social import, full theme customization, and advanced reporting become Growth-tier features; A/B testing placement by plan to be decided.

**Key dependencies and risks**
- TikTok/Instagram API access, terms, and stability (R-07, Q-06).
- Statistical validity of A/B tests at typical small-store traffic volumes; consider a minimum-traffic gate.
- Coupon features depend on what the Salla API exposes for coupon creation or validation.

**Exit criteria**
- Social import success rate above **[TBD, for example 95%]** on supported link types.
- A/B testing used by **[TBD]**% of Growth-plan merchants.
- No measurable degradation of player performance budgets (NFR-PERF) after adding interactive elements; new modules loaded on demand only.

### 10.4 Beyond Phase 3 (not committed)

- Support for other commerce platforms (Zid, Shopify) if the business case is validated (Q-07); this requires abstracting the platform integration layer early in the architecture.
- Native or in-app embeds (for example Salla mobile storefronts, if supported).
- Creator or UGC submissions: shoppers and influencers submit content for merchant approval.
- Live shopping sessions.

### 10.5 Phase-to-requirement summary

| Phase | Approx. functional modules | AI | Analytics | Audience | Plan features unlocked |
|---|---|---|---|---|---|
| MVP | Auth, dashboard, content, visibility, products, player, in-content purchase, preview, settings, billing | None | Funnel + attribution | None | Content and placement limits |
| Phase 2 | Teams, notifications, variants, richer visibility, theme matching | Levels 1-2 | Best time, export, filtering | Full | AI quotas, audience, export, seats |
| Phase 3 | Social import, A/B tests, stickers, advanced reports | Level 3 | Cohorts, scheduled reports | Product-level insights | Growth-tier tools |

---

## Appendix A: Demo Screen Traceability

| Demo screen | Requirement groups |
|---|---|
| `/dashboard` Overview | FR-DASH |
| `/content` Videos & Stories | FR-CON, FR-VIS |
| `/content/new` New content (incl. AI Reel, live preview) | FR-CON, FR-AI, FR-VIS, FR-BUY |
| `/products` Products | FR-PRD |
| `/analytics` Analytics | FR-ANA |
| `/audience` Audience | FR-AUD |
| `/settings` Settings (Salla link, Injector & visibility, Security & team) | FR-SET, FR-AUTH |
| `/preview` Store preview | FR-PRV, FR-INJ, FR-BUY |

## Appendix B: Observations on the Demo to Resolve

1. **Metric inconsistency:** the Overview shows attributed sales of 18,450 SAR, while the per-content revenue on the Analytics page adds up to ~16,470 SAR for the three listed items. Confirm whether the difference is expected (other content or an unlisted period) or a data/definition issue.
2. **"Engagement" vs "CTR":** the Overview labels 9.8% as "engagement", while Analytics labels the same value "CTR". Define and standardize these terms.
3. **Out-of-stock product** ("Hand bag Mina") is shown with 0 content, so define merchant guidance on promoting unavailable products.
4. **Funnel rates** are shown relative to total views (5.2%, 1.8%, 0.6%); decide whether to also show step-to-step conversion.
5. **Visibility rules** is a link on the content page with no screen in the demo; its design needs to be specified.
