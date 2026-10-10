## Epic 4: Visibility, Scheduling & Publishing

Published content appears on the right storefront pages, in the right layout and order, at the right time, and stays fresh within the FR24 bounds.

### Story 4.1: Choose placements and targets for a content item

As a merchant,
I want to choose the pages where my story or reel appears (home, a category, a product page),
So that shoppers see it where it is relevant.

**Requirements:** FR8, AD-2, AD-3, AD-19

**Acceptance Criteria:**

**Given** a content item open in the editor
**When** I add a placement
**Then** I can choose Home, Category or Product page, and for Category/Product an optional target picked from synced categories/products (searchable, Western digits, names in `dir="auto"`)
**And** the `placements` table (owner `content`, non-null `store_id`, RLS, cross-tenant test) is created in this story's migration

**Given** an item with no placement
**When** I press Publish (or auto-publish passes QC)
**Then** publish is blocked with the inline reason "Add a placement to publish" (button `aria-disabled` with reason, focus kept) and an auto-published item stays Draft with that reason (FR22)

**Given** a target product or category is later deleted in Salla
**When** the placement is shown in the editor
**Then** it is flagged "Linked product deleted" and no longer counts as a valid placement

**Given** I add, change or remove a placement on a Published item
**When** I press "Save changes"
**Then** exactly one `content.item.edited` domain event is emitted in the same transaction (AD-17)

### Story 4.2: Pick a layout per placement with Settings defaults

As a merchant,
I want each placement to use a layout (story ring/bar, product-page strip, home/category carousel boxed or full width, Reels covers opening the full-screen viewer),
So that content fits the page it lives on.

**Requirements:** FR29, FR8

**Acceptance Criteria:**

**Given** a placement on a Story item
**When** I open its layout control
**Then** I can choose Ring or Bar; for a Reel item I can choose Strip or Carousel of covers (boxed or full width on home/category; strip below images or custom position on product page), each opening the full-screen viewer

**Given** a new placement
**When** it is created
**Then** its layout defaults to the store's display default from `store_settings` (owner `integration`), falling back to Ring for Stories and Strip/Carousel for Reels when no default is stored

**Given** a layout not valid for the page type (e.g. full-width carousel on product page)
**When** I try to save
**Then** the API rejects it with a `problem+json` slug and the form shows a localized field error

### Story 4.3: Schedule start and end in the store time zone

As a merchant,
I want to set a start time and optional end time for a content item,
So that campaigns go live and stop on their own.

**Requirements:** FR8, FR24, AD-19

**Acceptance Criteria:**

**Given** the editor schedule section
**When** I choose "Now" or a wall-clock date/time
**Then** the time is shown and entered in the store time zone with its label (G7 result, else Asia/Riyadh), Arabic month names, Western digits, and the API converts it to UTC `timestamptz`
**And** the `schedules` table (owner `content`, RLS) is created in this story's migration

**Given** a future start time
**When** I publish
**Then** status becomes Scheduled (chip with date) and a pg-boss delayed job is queued with dedup key per item and boundary

**Given** the start boundary passes
**When** the job runs
**Then** status moves Scheduled -> Published via the contracts transition table and emits a status event; at an end time Published -> Ended

**Given** I edit the start/end or the store time zone changes
**When** the change is saved
**Then** existing boundary jobs are replaced (no duplicate transitions) and future schedules are re-anchored

**Given** an end time earlier than or equal to the start
**When** I save
**Then** the form shows "End time must be after the start time" and nothing is saved

### Story 4.4: Compile the per-store manifest of eligible content

As a Slips developer,
I want one compiled `StoreManifest` per store containing only content eligible now,
So that the storefront reads a single small, cacheable file.

**Requirements:** AD-6, AD-18, FR30, FR24, AD-19

**Acceptance Criteria:**

**Given** a store with content items
**When** the compile job runs
**Then** the manifest (contracts `StoreManifest` v1) contains only Published, in-schedule items with their placements, layouts, display options, product snapshots (price the cart charges, sale price, availability bucket, required-options flag) and immutable processed asset URLs
**And** Draft, Processing, Failed, Scheduled, Ended, Archived, Deactivated and deleted items are excluded (filter on status only)

**Given** more than 10 eligible items on one placement
**When** compiled
**Then** items are ordered by `first_published_at` newest first and capped at 10

**Given** several triggers in the `ManifestInputs` list fire within ~10 s
**When** compile runs
**Then** it runs single-flight per store, debounced, writes `store_manifests` (owner `publishing`, created here) with a monotonic `revision`, and never overwrites a newer revision

**Given** a CTA "open link" URL no longer on the store's synced domain
**When** compiled
**Then** that CTA is dropped from the manifest and the item is flagged for the merchant

**Given** a manifest above 15 KB gzip
**When** compiled
**Then** a manifest-size metric and warning are emitted (sharding deferred)

### Story 4.5: Serve the manifest from the CDN and purge on change

As a shopper,
I want the storefront to load current content quickly,
So that I see the right stories within a minute of the merchant's change.

**Requirements:** AD-6, AD-18, FR24, NFR7

**Acceptance Criteria:**

**Given** a compiled manifest
**When** it is uploaded
**Then** it is served at `/m/v1/salla/<platform_store_id>.json` (and active/retiring key paths) with TTL 60 s plus stale-while-revalidate, and only `publishing` calls `CdnPurger`, with retried purges

**Given** publish, unpublish, archive, delete or a schedule boundary
**When** the change commits
**Then** the storefront manifest reflects it within 1 minute (integration test measures it)

**Given** an uninstalled, purged or unknown store, or a revoked key
**When** its manifest path is requested
**Then** an empty eligible list is returned, never an error page

**Given** Salla is in an outage (degraded mode)
**When** shoppers request the manifest
**Then** the last manifest keeps serving and a compile-lag metric/alert reports staleness

### Story 4.6: Refresh the storefront on product price and stock changes

As a merchant,
I want price and stock changes in Salla to show on my stories quickly,
So that shoppers never see a wrong price or buy something out of stock.

**Requirements:** FR24, AD-18

**Acceptance Criteria:**

**Given** a linked product's price, sale price, stock bucket or required-options flag changes in Salla
**When** catalog emits its manifest-visible change event
**Then** a recompile is triggered and the storefront shows the new value within 2 minutes P95 (1 min sync + 1 min cache)

**Given** a product field that is not manifest-visible changes
**When** the event is processed
**Then** no recompile is triggered

**Given** a linked product is deleted
**When** the change is processed
**Then** its content leaves the storefront at the next compile

**Given** the automated freshness test
**When** it runs in CI against staging fixtures
**Then** it covers a schedule start, a schedule end and a price change, each asserted within its bound

## Epic 5: Storefront Player & In-Content Purchase

Shoppers see the story ring (or floating bubble), watch Stories and Reels, and add products to their Salla cart without leaving the content, on every supported browser and theme, in Arabic and English.

### Story 5.1: Ship the App Snippet stub and release-channel loader

As a Slips developer,
I want a static, store-identical App Snippet stub that loads a versioned loader from a release channel,
So that every store gets Slips with no theme edits and we can roll out or roll back safely.

**Requirements:** FR9, AD-21, AD-7, NFR1, NFR8

**Acceptance Criteria:**

**Given** the stub in `packages/player/stub`
**When** it runs on a storefront page
**Then** it reads `(platform, platform_store_id)` and language from `salla.config`, fetches the short-TTL channel pointer, and loads the named immutable loader asynchronously without blocking render

**Given** channels `stable` and `canary` (cohort %)
**When** a store falls in the canary cohort
**Then** it gets the canary loader; repointing the channel rolls back; the global kill switch loads nothing

**Given** the stub runs twice, the pointer or loader is blocked/missing/times out, or the manifest major is unknown
**When** boot is attempted
**Then** it fails silently (no console errors thrown to the page, nothing rendered) and the `window.__slips` guard prevents double boot

**Given** `cart::*` events before the loader is ready
**When** the loader boots
**Then** the buffered events are replayed

**Given** the manual-snippet fallback with an injector key
**When** used
**Then** only `active` or `retiring` keys load content
**And** CI fails if the initial payload exceeds 50 KB gzip and warns above 20 KB core; only Slips CDN and API origins are contacted (documented for CSP); release to Partners Portal follows the documented step

### Story 5.2: Render only eligible content for the page and fail invisibly

As a shopper,
I want the store to work normally whether or not Slips has content for this page,
So that Slips never breaks or slows my shopping.

**Requirements:** FR9, FR10, NFR1, AD-7, AD-4, UX-DR35, UX-DR36

**Acceptance Criteria:**

**Given** the loader on a home, category or product page
**When** `StorefrontPlatform` maps `salla.*` to `PageContext`
**Then** only manifest items matching page type and target ID are rendered

**Given** no eligible content, API timeout, invalid key or Slips unreachable
**When** the page loads
**Then** nothing is visible, no space is reserved and the store is fully functional

**Given** content is rendered
**When** inspected
**Then** it lives in Shadow DOM, uses system fonts and only `--slips-*` custom properties, neutral light-only styling independent of `prefers-color-scheme`, defines `slips-player`/`slips-viewer` once, adds no globals beyond `window.__slips`, and imports `preact` only at runtime (lint-enforced)

**Given** the storefront language is Arabic or English
**When** the player mounts
**Then** the host gets `lang` and `dir` (RTL/LTR) from the locale, uses logical properties only and wraps prices/names in bidi isolates

### Story 5.3: Show the story ring entry with floating-bubble fallback without layout shift

As a shopper,
I want a story ring (or a small floating bubble) where content is available,
So that I can open stories without the page jumping.

**Requirements:** FR10, FR29, AD-8, NFR1, UX-DR25, UX-DR26, UX-DR3

**Acceptance Criteria:**

**Given** eligible Story content with ring/bar layout and its anchor below the viewport at insertion
**When** the manifest arrives
**Then** the ring inserts inline: 68px avatars with the coral-to-amber story-ring gradient, 12px one-line label, horizontal scroll following text direction (mockups/key-story-viewer.html)

**Given** the anchor is already in view (including when the shopper scrolled past before the manifest arrived)
**When** insertion would occur
**Then** no inline element is inserted and a 56px floating bubble mounts on `document.body` at bottom-start, never covering the theme cart/checkout button

**Given** the bubble
**When** I tap its 24px dismiss button (44px hit area)
**Then** it hides for the rest of the session

**Given** a ring item
**When** focused or read by AT
**Then** it is a `button` named "{title}, story, new" or "..., seen", seen state (stored per viewer locally) uses the thinner flat seen ring, and focus uses the white-inner/ink-outer player focus ring

**Given** the Playwright CLS test on 3 themes
**When** run for no content, API timeout and scroll-past-anchor-before-manifest
**Then** Slips-caused CLS is 0

### Story 5.4: Open the full-screen viewer with accessible controls

As a shopper,
I want a full-screen viewer that I can control by touch, mouse, keyboard or screen reader,
So that I can watch content comfortably and leave it easily.

**Requirements:** FR10, NFR6, AD-7, AD-8, UX-DR27, UX-DR28, UX-DR35

**Acceptance Criteria:**

**Given** I activate any entry point
**When** the viewer opens
**Then** it mounts on `document.body` as `role=dialog`, `aria-modal`, named "{merchant} stories", host siblings `inert`, scroll locked, initial focus on Pause, focus trapped; phone full screen with safe-area insets, desktop centered 9:16 with backdrop and visible arrows

**Given** the viewer is open
**When** I look for controls
**Then** mute, pause, close, next and previous are 44px round buttons (white icon on 40% scrim), mute and pause visible in every mode, tap zones are named buttons "Next slide"/"Previous slide"

**Given** I press `Esc` or Close
**When** the viewer closes
**Then** scroll lock and `inert` are removed and focus returns to the entry that opened it

**Given** the lazy viewer module
**When** built
**Then** it loads on first interaction and stays within 25 KB gzip

### Story 5.5: Play Stories with segmented progress and auto-advance

As a shopper,
I want stories to play slide by slide with a progress bar,
So that I can browse a merchant's stories quickly.

**Requirements:** FR10, UX-DR29, UX-DR35

**Acceptance Criteria:**

**Given** a story opens
**When** the first slide shows
**Then** the poster shows first then the video plays muted; image slides advance after their duration; segmented 2px white bars with 4px gap sit on a 64px top scrim

**Given** Pause, long-press, `Space` or `K`
**When** used
**Then** auto-advance and video stop until resumed

**Given** I navigate manually
**When** the slide changes
**Then** a hidden "Slide 2 of 5" is announced (not announced on auto-advance)

**Given** the last slide of a story ends
**When** more stories exist in the ring
**Then** the next story opens; after the last, the viewer closes and focus returns to the entry

**Given** the shopper goes offline mid-view
**When** media is already loaded
**Then** it keeps playing

### Story 5.6: Apply RTL/LTR gestures, keyboard map and reduced motion

As a shopper,
I want gestures and keys to follow my language direction and my motion settings,
So that the player feels native and never moves on its own when I asked it not to.

**Requirements:** FR10, NFR5, NFR6, UX-DR33, UX-DR34, UX-DR36

**Acceptance Criteria:**

**Given** an RTL viewer
**When** I tap the inline-start third
**Then** it goes to the next slide; tap zones mirror in LTR; progress fills in reading direction; media/playback icons never mirror

**Given** keyboard focus inside the viewer
**When** I press arrow keys, `PageDown`/`PageUp`, `M`, `Esc`, `Space`/`K`
**Then** arrows follow viewer `dir` for slides, `PageDown`/`PageUp` move between story groups, `M` mutes, `Esc` closes, `Space`/`K` pause (Space never advances); single-key shortcuts do nothing when focus is outside the viewer

**Given** swipe toward inline-start, swipe down, long-press
**When** performed
**Then** they move to the next group, close, and pause respectively, and each has a button alternative

**Given** `prefers-reduced-motion: reduce`
**When** Stories play
**Then** they do not auto-advance (tap/Next to advance only), there are no transitions, and an ended video slide stops on its last frame with a focus-reachable Next

### Story 5.7: Play Reels as a vertical swipe feed with lazy loading

As a shopper,
I want to swipe through full-screen videos one at a time,
So that discovery feels natural without wasting my data.

**Requirements:** FR10, NFR1, UX-DR33, UX-DR28

**Acceptance Criteria:**

**Given** Reels covers (strip/carousel)
**When** I open one
**Then** the viewer shows one video at a time, muted autoplay, swipe up/`↓` for next and swipe down/`↑` for previous, with Next/Previous buttons

**Given** the page loads
**When** the Reels placement is not yet near the viewport
**Then** no video bytes or viewer code are loaded

**Given** data saver is on or the browser blocks autoplay
**When** a reel is shown
**Then** the poster with a play button appears instead of autoplay

**Given** the open viewer
**When** I swipe down from the first reel or press `Esc`
**Then** the viewer closes and focus returns

### Story 5.8: Pick an adaptive rendition for a fast first frame

As a shopper,
I want videos to start fast on my connection,
So that I don't wait.

**Requirements:** FR10, NFR2, AD-15

**Acceptance Criteria:**

**Given** 480p/720p/1080p progressive MP4 renditions
**When** a video starts
**Then** the player picks a rendition from viewport size and connection (Network Information where available, else 720p), preloading only the poster and the next slide

**Given** Fast 4G on a mid-range Android profile
**When** the player opens
**Then** the first video frame appears within 2 s (CI performance test)

**Given** playback stalls repeatedly
**When** detected
**Then** the next slide uses a lower rendition

### Story 5.9: Show the product card and add to the Salla cart in place

As a shopper,
I want to see the product price and add it to my cart from the video,
So that I can buy without leaving the content.

**Requirements:** FR11, AD-7, AD-9, NFR6, UX-DR30, UX-DR31, UX-DR39

**Acceptance Criteria:**

**Given** a slide with a linked product
**When** shown
**Then** the card has a white surface, 22px radius, 56px thumb, 2-line name, tabular price the cart will charge (sale price when set) and a 48px full-width ink CTA with amber text; opening the card pauses auto-advance; taps on the card/CTA never navigate slides

**Given** I press Add to cart
**When** the request is pending
**Then** the CTA shows a spinner with `aria-disabled="true"` and `aria-busy="true"` (never native `disabled`), focus stays, playback pauses, double-submit is ignored

**Given** Salla's cart promise confirms
**When** success returns
**Then** the empty polite live region (mounted at viewer open) announces "Added to cart. Cart: 3 items", playback resumes, the add is tagged per the G4 mechanism and `POST /v1/cart-adds` is sent immediately with `keepalive` (never batched)

**Given** Salla returns a different price
**When** the add completes
**Then** the card updates to Salla's price

**Given** out of stock or an API failure
**When** the add fails
**Then** an assertive inline "Couldn't add it right now. Try again." (or localized out-of-stock text) shows, the CTA re-enables and the shopper stays in the viewer

**Given** the secondary actions
**When** I choose "Open product" or "Open cart"
**Then** the product page or cart opens

### Story 5.10: Handle required-options and out-of-stock products

As a shopper,
I want clear actions for products that need size/colour or are sold out,
So that I am never stuck on a button that can't work.

**Requirements:** FR23, FR11, FR16, UX-DR32, UX-DR31

**Acceptance Criteria:**

**Given** a product with the required-options flag and no G3 pass
**When** its card shows
**Then** the CTA reads "اختر المقاس واللون" / "View options" and opens the product page; it is recorded as a product click and never sent as a cart add or credited

**Given** an out-of-stock product in the manifest
**When** its card shows
**Then** the CTA stays focusable with `aria-disabled`, is named "Out of stock" and does nothing on press

**Given** stock changes back to available
**When** the next manifest is loaded
**Then** the normal Add to cart CTA returns

### Story 5.11: Render product-page strip and home/category carousel layouts

As a merchant,
I want my content shown as a product-page strip or home/category carousel,
So that it fits each page of my store.

**Requirements:** FR29, FR10, AD-8, NFR1

**Acceptance Criteria:**

**Given** a product-page placement with strip layout
**When** eligible and its anchor is below the viewport
**Then** the strip inserts below product images (or the custom position) and opens the viewer on tap

**Given** a home/category placement with carousel (boxed or full width)
**When** eligible and anchor below the viewport
**Then** the carousel inserts and opens the full-screen viewer; otherwise the floating bubble is used

**Given** each layout in Arabic and English
**When** rendered
**Then** scroll and order follow text direction

**Given** the CLS test
**When** run on 3 themes in the 4 scenarios (content, no content, API timeout, invalid key)
**Then** every layout has zero Slips-caused layout shift

### Story 5.12: Verify the player across browsers and themes

As a Slips developer,
I want the player tested across supported browsers and themes,
So that no shopper gets a broken store.

**Requirements:** NFR9, NFR1, NFR6

**Acceptance Criteria:**

**Given** the player test suite
**When** CI runs
**Then** it covers iOS Safari (last 3), Android Chrome (last 3), Samsung Internet and desktop Chrome/Safari/Edge/Firefox (last 2), including keyboard and screen-reader-name checks

**Given** the theme compatibility matrix in the repo
**When** reviewed
**Then** it lists at least 3 representative Salla themes with pass/fail per layout and scenario

**Given** any matrix failure
**When** a player release is attempted
**Then** promotion to `stable` is blocked

### Story 5.13: Measure storefront impact on Core Web Vitals

As a Slips admin,
I want proof that Slips does not slow stores down,
So that we meet exit criterion E2 and the counter-metric.

**Requirements:** NFR13, NFR1

**Acceptance Criteria:**

**Given** a repeatable test
**When** run on at least 3 representative themes with and without Slips
**Then** it reports LCP, INP and CLS and fails if Slips worsens any versus baseline beyond measurement noise

**Given** a pilot store with merchant permission
**When** the same measurement is run
**Then** results are saved as a report used for E2 and the Core Web Vitals counter-metric
