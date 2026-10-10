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
