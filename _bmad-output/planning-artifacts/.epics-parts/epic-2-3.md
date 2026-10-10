## Epic 2: Product Catalog Sync

The merchant's Salla products, prices and stock appear in Slips and stay in sync (webhooks, manual sync, daily reconciliation, disconnection handling); the Products page lists them with linked content and availability.

### Story 2.1: Import the full product catalog on first install

As a merchant,
I want my Salla products imported automatically after I install Slips,
So that I can link them to my content without typing anything.

**Requirements:** FR3, FR25, AD-2, AD-4, AD-14

**Acceptance Criteria:**

**Given** a store has just completed install and OAuth (Epic 1) and emitted the install lifecycle event
**When** the worker consumes that event
**Then** a `catalog.full-sync` job (batch queue) imports every product through the `CommercePlatform` port, storing name, image, category, price, sale price, `tax_inclusive`, currency, availability and required-options flag
**And** this story creates the `products` and `categories` tables, owned by `catalog` in the ownership map, each with non-null `store_id`, RLS and a cross-tenant test

**Given** a product is stored
**When** its stock is 0, 1-5, or more than 5
**Then** `catalog` stores the availability bucket Out of stock, Low, or Available respectively, and no client recomputes it
**And** prices are integer minor units with currency code per the money convention, and every row carries `(platform, external_id)` plus `source_updated_at`

**Given** Salla returns `429` or a transient error during import
**When** the adapter retries
**Then** it paces per store, honours `Retry-After`, and uses the AD-1 default policy (5 attempts, 30 s to 15 min backoff)
**And** if the job still fails the store's sync state is `failed` with a reason code, exposed through `catalog`'s service for later UI

**Given** the import needs an access token
**When** it calls Salla
**Then** it gets the token only through `integration.getAccessToken(storeId)` and never refreshes tokens itself

**Given** a store on any plan or with plan enforcement skipped (non-`live` store)
**When** the catalog syncs
**Then** product count is never limited by plan; catalog sync reads no billing entitlements (limits are decided only by `content`, AD-14)

**Given** the import finishes
**When** the job completes
**Then** `catalog` records the last successful sync time and emits `catalog.sync.completed` via the transactional outbox with counts of created/updated products

### Story 2.2: Browse products on the Products page

As a merchant,
I want a Products page listing my synced products with category, price and availability,
So that I can see what I can promote and what is out of stock.

**Requirements:** FR16, FR3, AD-2, UX-DR10, UX-DR11, UX-DR22, UX-DR23, UX-DR36, UX-DR37

**Acceptance Criteria:**

**Given** a store with synced products
**When** the merchant opens Products from the side nav
**Then** a table (shadcn Table in Card, 56px rows, thumb) shows name, category, price, linked-content count, attributed orders and availability
**And** price shows the sale price when set, formatted with `Intl.NumberFormat` in store currency, Western digits, `tabular-nums`, isolated with `<bdi>`

**Given** the availability column
**When** a product is Available, Low or Out of stock
**Then** a status chip with a text label (never colour alone) is shown using the status-chip component tokens; Out of stock reads "Out of stock" / "نفد المخزون"
**And** this story builds the reusable status-chip and data-table components in `packages/ui` that Epic 3 reuses

**Given** the linked-content column
**When** `content` has not yet exposed its batch read (before Epic 3)
**Then** the column shows 0 via a single batch call shape `getLinkCountsByProductIds(storeId, ids)` (no N+1)
**And** the attributed orders column shows "—" until Epic 6 attribution is live

**Given** the merchant filters by category or types in search
**When** input changes
**Then** search is debounced, matches product name in Arabic or English, filter and search persist in the URL via nuqs, and the back button restores them
**And** a filtered-empty result shows a sentence and "Show all"

**Given** the store has no products yet or the first sync is still running
**When** the page loads
**Then** a syncing empty state with a link to Salla products is shown; while loading, a boneyard skeleton of 6 rows appears after 150 ms
**And** if the request fails, an inline error with Retry is shown and the shell keeps working

**Given** the viewport is `sm`
**When** the page renders
**Then** the table becomes a card list with no horizontal page scroll, in RTL and LTR

### Story 2.3: Sync products manually and see last sync time

As a merchant,
I want a "Sync products" button and the last sync time,
So that I can force an update and trust that my catalog is current.

**Requirements:** FR3, NFR12, UX-DR6, UX-DR20, UX-DR39

**Acceptance Criteria:**

**Given** the Products page
**When** it renders
**Then** the header shows "Last synced {relative time}" in the store time zone and a "Sync products" secondary button

**Given** the merchant clicks "Sync products"
**When** the request is accepted (`POST /v1/catalog/sync`)
**Then** the button shows a spinner with `aria-busy` and ignores further clicks, a full-sync job is enqueued (single-flight per store, a second request while running returns the running job), and on completion the list refreshes and last sync time updates

**Given** a manual sync was requested less than 60 seconds after the previous one
**When** the API receives it
**Then** it responds with an RFC 9457 problem (`type` `sync-rate-limited`) and the dashboard shows a localized friendly message

**Given** the sync fails after all retries
**When** the merchant views the page
**Then** an action toast reads the localized friendly-coach error with a "Retry" action that never auto-dismisses, and the page keeps showing the previous catalog

### Story 2.4: Apply product webhooks in near real time

As a merchant,
I want product, price and stock changes in Salla reflected in Slips automatically,
So that shoppers always see current prices and stock.

**Requirements:** FR3, FR25, AD-13, AD-17, AD-18, AD-2

**Acceptance Criteria:**

**Given** Salla sends a signed `product.created`, `product.updated` or stock/quantity webhook
**When** it is verified and stored in `webhook_inbox` by Epic 1's transport
**Then** a `catalog` handler (per store, serialized) upserts the product within 1 minute of receipt

**Given** two webhooks for the same product arrive out of order
**When** the older one is processed after the newer
**Then** the guarded write on `source_updated_at` leaves the newer data in place and the skip is counted in a metric

**Given** the same Salla event ID is delivered twice
**When** processed
**Then** the second delivery is a no-op

**Given** a product update changes a manifest-visible field (price, sale price, availability bucket, name, image, required-options flag)
**When** the upsert commits
**Then** `catalog.product.updated` is emitted in the same transaction with the changed fields
**And** a change only to non-visible fields (for example description) emits no event

**Given** a webhook payload is malformed or the product fetch fails
**When** retries are exhausted
**Then** the inbox row is dead-lettered, an alert fires through the telemetry module, and the next reconciliation (Story 2.6) repairs the product

### Story 2.5: Handle products deleted in Salla

As a merchant,
I want Slips to notice when I delete a product in Salla,
So that content never sells something that no longer exists.

**Requirements:** FR25, AD-2, AD-17

**Acceptance Criteria:**

**Given** a `product.deleted` webhook or a reconciliation finding that a product no longer exists
**When** `catalog` processes it
**Then** the product is soft-deleted (tombstone with `deleted_at`, no cascading FK delete) and `catalog.product.deleted` is emitted with `(store_id, product_id)`

**Given** a deleted product
**When** the Products page or product picker queries products
**Then** it is excluded by default

**Given** the product is later recreated in Salla with the same external ID
**When** a create/update webhook arrives
**Then** the tombstone is cleared and `catalog.product.updated` is emitted

**Given** the deletion event
**When** consumers exist (content in Story 3.4, publishing in Epic 4)
**Then** the event schema and owner are catalogued in `packages/contracts` so they can react idempotently on event ID

### Story 2.6: Reconcile the catalog daily

As a merchant,
I want my catalog to self-correct at least daily,
So that missed webhooks never leave wrong prices or stock on my store.

**Requirements:** FR25, AD-13, AD-1

**Acceptance Criteria:**

**Given** a scheduled `catalog.reconcile` job runs at least once every 24 hours per active store
**When** it compares Salla's products with local rows
**Then** missing products are created, differing products updated, and absent ones handled per Story 2.5, using the same guarded writes and event rules as Story 2.4

**Given** reconciliation finds differences
**When** it finishes
**Then** a structured log line and metric record counts of created, updated, deleted and unchanged products with `store_id` and `trace_id`, and last sync time updates

**Given** reconciliation for one store fails
**When** retries are exhausted
**Then** other stores are unaffected and an alert is raised

**Given** a store is `disconnected` or `uninstalled`
**When** the schedule fires
**Then** that store is skipped

### Story 2.7: Pause sync when disconnected and resume on reconnect

As a merchant,
I want to see clearly when Slips loses access to my store and fix it in one step,
So that my catalog does not silently go stale.

**Requirements:** FR25, AD-20, UX-DR21, UX-DR39

**Acceptance Criteria:**

**Given** the store moves to `disconnected` (token refresh definitively failed or access revoked, Epic 1)
**When** catalog jobs or webhooks are processed
**Then** sync is paused (jobs skip with reason `disconnected`) and storefront content keeps serving last data

**Given** a disconnected store
**When** the merchant opens any dashboard page
**Then** a persistent in-flow danger banner shows "Your Salla connection dropped, so syncing paused. Reconnect to continue." (Arabic first) with the last sync time and a "Reconnect" action

**Given** the merchant completes reconnect
**When** the store returns to `active`
**Then** the banner clears and a full sync is enqueued immediately to catch up

**Given** a store reinstalled within the 30-day grace
**When** the restore runs
**Then** `catalog`'s `StoreDataLifecycle` restore keeps the same product rows and triggers a full sync; its export returns products and categories and its purge deletes them after grace

## Epic 3: Content Creation & Media

The merchant creates, uploads, previews (real player in preview mode), and manages Stories and Reels through their full status lifecycle.

Note: open question A-1 is resolved for these stories with the AD-19 interim: Published items are edited live and saved explicitly.

### Story 3.1: Model content items and their status lifecycle

As a Slips developer,
I want one content state machine owned by the `content` module,
So that every status change is consistent between dashboard and storefront.

**Requirements:** FR22, AD-19, AD-2, AD-17, AD-11

**Acceptance Criteria:**

**Given** this story
**When** migrations run
**Then** it creates `content_items` (owned by `content`; UUIDv7, `store_id`, title, format Story/Reel, CTA fields, status, auto-publish flag, `first_published_at`, `deleted_at`) with RLS and a cross-tenant test

**Given** the statuses Draft, Processing, Failed, Scheduled, Published, Ended, Archived, Deactivated
**When** a transition is requested
**Then** it is checked against the transition table in `packages/contracts`; disallowed transitions return an RFC 9457 problem (`type` `invalid-transition`) and change nothing
**And** there is no "Ready" status

**Given** any successful transition
**When** it commits
**Then** only `content` writes the status and emits `content.item.<status-verb>` in the same transaction (outbox)

**Given** other modules (`media`, later `billing`)
**When** they need a status change
**Then** they call a `content` command; a lint/test proves no other module writes `content_items.status`

**Given** a content item is deleted
**When** delete runs
**Then** it is soft-deleted (tombstone kept for analytics) and `content.item.deleted` is emitted

### Story 3.2: List and filter content with status tabs

As a merchant,
I want my content listed with status, tabs and counts,
So that I can find and manage any Story or Reel quickly.

**Requirements:** FR6, FR22, UX-DR10, UX-DR11, UX-DR22, UX-DR23, UX-DR39

**Acceptance Criteria:**

**Given** the Videos & Stories page
**When** it loads
**Then** a content table shows thumb, title, format, placement, status chip, views, clicks and a row menu; views and clicks show "—" until Epic 6

**Given** tabs All, Published, Scheduled, Drafts
**When** counts render
**Then** All counts every non-deleted status; Drafts counts Draft, Processing and Failed; Archived, Deactivated and Ended appear only under All with their chip
**And** the active tab, search and sort live in the URL (`?tab=`) via nuqs

**Given** each status chip
**When** shown
**Then** it uses the DESIGN.md chip for that status (Processing with pulsing dot, static under reduced motion; Failed with reason and 6% row tint; Scheduled with date in store time zone; Archived with archive icon; Deactivated amber), always with a text label

**Given** a row
**When** clicked or focused and `Enter` pressed
**Then** the editor opens for that item

**Given** no content exists
**When** the page loads
**Then** the empty state reads the friendly-coach sentence with one amber "Create your first story" action; an empty tab shows its sentence plus action; loading shows a 6-row skeleton after 150 ms; an API failure shows an inline Retry

### Story 3.3: Create a Story or Reel with title, format and CTA

As a merchant,
I want to create content by choosing format, title and a call to action,
So that my content is shoppable from the start.

**Requirements:** FR4, FR22, UX-DR12, UX-DR6, UX-DR39, UX-DR40, AD-19

**Acceptance Criteria:**

**Given** the merchant clicks "Create" (amber action)
**When** the editor opens (`mockups/key-content-editor.html`)
**Then** it shows two columns (form start side, preview placeholder end side), single column with sticky preview button on `md`, stacked with preview toggle on `sm`
**And** saving the first field creates a Draft

**Given** the CTA section
**When** the merchant fills it
**Then** they set a label, an action (add to cart / open product / open link) and an optional preset style
**And** "open link" accepts only URLs on the store's own synced domains; other URLs show an inline error naming the rule, and the API re-validates and rejects with a problem

**Given** a Draft
**When** the merchant edits any field
**Then** it autosaves after ~1 s debounce and shows "Saved"; merchant text is stored as-is and rendered with `dir="auto"` and escaped (no XSS)

**Given** a validation error
**When** the merchant blurs a field or submits
**Then** errors show in the active language with a summary linking to fields, announced via a live region

**Given** unsaved changes
**When** the merchant navigates away
**Then** a confirm dialog asks before leaving

### Story 3.4: Link a product with the product picker

As a merchant,
I want to pick a synced product for my content,
So that shoppers can buy it from the Story.

**Requirements:** FR4, FR16, FR25, UX-DR15, AD-2

**Acceptance Criteria:**

**Given** the editor's product field
**When** the merchant types
**Then** a searchable combobox lists synced products (via `catalog` service) with thumb, name, price and availability chip, keyboard-operable

**Given** the merchant selects an Out of stock product
**When** it is linked
**Then** a warning says the CTA will show "Out of stock" until stock returns; linking is still allowed

**Given** a product with the required-options flag
**When** it is linked
**Then** the CTA preview note says the button will read "View options"

**Given** a link is saved
**When** it commits
**Then** this story creates `content_product_links` (owned by `content`) and exposes `getLinkCountsByProductIds`, so the Products page linked-content count shows real numbers

**Given** `catalog.product.deleted` arrives
**When** `content` handles it (idempotent on event ID)
**Then** each linked item is flagged "Linked product deleted" in the list and editor, and `content.item.edited` is emitted so publishing can drop it

### Story 3.5: Upload media directly to storage safely

As a merchant,
I want to upload images and videos securely,
So that my files are accepted quickly and nothing unsafe goes live.

**Requirements:** FR5, NFR11, AD-15, AD-2

**Acceptance Criteria:**

**Given** the merchant requests an upload
**When** `media` issues a pre-signed URL
**Then** it is store-scoped, store-prefixed, content-addressed, size-limited (video 200 MB, image 10 MB) and expires in 15 minutes
**And** this story creates `media_assets` (owned by `media`) with states `uploaded -> scanned -> processed | failed`

**Given** a store exceeds the upload issue rate threshold
**When** it requests more URLs
**Then** issue is throttled with a problem response and an abuse metric is recorded; per-store stored bytes are metered

**Given** an uploaded object
**When** the worker inspects it
**Then** type is sniffed from content (video MP4/MOV/WebM; image JPG/PNG/WebP); SVG and mismatches are rejected; image EXIF/GPS metadata is stripped

**Given** a valid file
**When** the `MalwareScanner` port scans it
**Then** clean files move to `scanned`; infected ones to `failed` with reason; only `processed` assets can ever be published

### Story 3.6: Add slides with the media uploader and reorder them

As a merchant,
I want to drop several files at once and arrange them,
So that I can build a Story in minutes.

**Requirements:** FR4, FR5, UX-DR13, UX-DR14, UX-DR12

**Acceptance Criteria:**

**Given** the editor's uploader (dashed `input-border` drop zone)
**When** the merchant drags or picks multiple files
**Then** each is pre-checked in the browser against FR5 limits (video <= 200 MB, <= 90 s, shorter side >= 720; image <= 10 MB, shorter side >= 1080) and rejected with a message naming the limit, before upload

**Given** accepted files
**When** they upload
**Then** each shows per-file progress, then Processing with poster, or Failed with reason and Retry
**And** this story creates `slides` (owned by `content`) referencing `media_assets`

**Given** an image slide
**When** saved
**Then** alt text is required

**Given** a slide
**When** the merchant uses "Move earlier"/"Move later" or drag
**Then** order changes in logical order (RTL-safe), "Slide 2 of 3" is announced, and focus stays on the moved slide

### Story 3.7: Import media from an external link

As a merchant,
I want to paste a link to a video or image,
So that I can reuse media I already host.

**Requirements:** FR5, NFR3, AD-15

**Acceptance Criteria:**

**Given** the merchant pastes a URL
**When** submitted
**Then** a worker job fetches it through the single SSRF-safe fetcher (blocks private/loopback/link-local/metadata IPs and redirects to them, enforces size and timeout) and stores a copy; the media is never hotlinked

**Given** a fetched file
**When** stored
**Then** it goes through the same sniff, strip, scan and processing path as uploads

**Given** the fetch fails or is blocked
**When** the job ends
**Then** the slide shows Failed with a friendly reason and Retry

### Story 3.8: Process videos into renditions and posters

As a merchant,
I want my videos processed automatically,
So that they play smoothly on any connection.

**Requirements:** FR5, NFR13, AD-15, AD-1

**Acceptance Criteria:**

**Given** a `scanned` video asset
**When** the media queue (own worker deployment) processes it via the `MediaProcessor` port
**Then** progressive MP4 renditions at 480p, 720p and 1080p (where the source allows) and a poster are produced at immutable paths; no HLS
**And** this story creates `renditions` (owned by `media`)

**Given** processing is running
**When** the merchant views the item
**Then** the item status is Processing (set through a `content` command)

**Given** a 60 s 1080p test video in staging
**When** processed
**Then** it completes within 5 minutes at P95 excluding queue spikes, recorded as a metric

**Given** an image asset
**When** processed
**Then** a web-optimized version is produced and the asset becomes `processed`

### Story 3.9: Run quality checks, retry failures and auto-publish

As a merchant,
I want clear processing results and an option to publish automatically,
So that I know when my content is ready without watching it.

**Requirements:** FR5, FR22, NFR12, AD-15, AD-19, UX-DR20, UX-DR39

**Acceptance Criteria:**

**Given** a processed asset
**When** the quality check runs
**Then** it flags below minimum resolution, no video track, corrupt file, or over 90 s duration, with a reason code

**Given** a failing job
**When** it errors
**Then** it retries automatically (media: 3 attempts per AD-1); after the last, `media` tells `content` and the item becomes Failed with reason (e.g. "This video didn't finish processing: resolution is below 720p...") and a "Retry" action that re-queues it

**Given** all slides pass and auto-publish is off
**When** processing finishes
**Then** the item returns to Draft

**Given** auto-publish is on
**When** processing passes
**Then** `content` runs its publish eligibility check; with no placement (placements arrive in Epic 4) the item stays Draft with the reason "Add a placement to publish" shown in editor and list

### Story 3.10: Serve a preview manifest for one content item

As a Slips developer,
I want a preview endpoint that builds a manifest with the same compiler code as the storefront,
So that previews match what shoppers will see.

**Requirements:** FR7, AD-23, AD-6, AD-11

**Acceptance Criteria:**

**Given** an authenticated merchant
**When** they call `GET /v1/preview/content/{id}`
**Then** the API returns a `StoreManifest` v1 (contracts schema) containing only that item, its slides, product snapshot and asset URLs, built by a compile function in `publishing` that Epic 4 reuses for the CDN manifest

**Given** a preview response
**When** served
**Then** it is never cached on the CDN and requires the merchant session; another store's item returns 404

**Given** slides still Processing
**When** previewed
**Then** posters or the original upload are used so the merchant sees something

### Story 3.11: Render content in the player's preview mode

As a Slips developer,
I want the real player build to run in preview mode with a mock storefront,
So that the dashboard preview uses the same code shoppers get.

**Requirements:** FR7, AD-23, AD-7, UX-DR35, UX-DR36

**Acceptance Criteria:**

**Given** `packages/player` built for preview
**When** loaded in an iframe with `MockStorefrontPlatform` and a preview manifest
**Then** it renders the item's slides vertically (9:16), title, product card and CTA in Shadow DOM, system fonts, `--slips-*` properties only

**Given** the shopper-side CTA is pressed in preview
**When** add to cart runs
**Then** it is simulated as success; no events and no cart confirms are sent

**Given** locale `ar` or `en`
**When** rendered
**Then** direction follows locale and merchant text uses `dir="auto"`

**Given** a new manifest posted to the iframe
**When** received
**Then** the player re-renders without reload

### Story 3.12: Show the live preview panel in the editor

As a merchant,
I want a phone-sized preview that updates as I edit,
So that I see exactly what shoppers will see before publishing.

**Requirements:** FR7, UX-DR16, UX-DR41

**Acceptance Criteria:**

**Given** the editor
**When** it loads
**Then** the end-side column shows a 9:16 phone frame (radius lg, ink bezel) iframing the preview player, with the always-visible note "Preview: no real cart or analytics"

**Given** the merchant changes title, CTA, product or slide order
**When** the draft saves
**Then** the preview updates within 2 s

**Given** the preview is loading
**When** it takes over 150 ms
**Then** a skeleton phone frame shows; on failure "Preview didn't load. Try again." with Retry

### Story 3.13: Edit, duplicate, archive, restore and delete content

As a merchant,
I want to change and tidy my content safely,
So that my library stays organized and live items change only when I say so.

**Requirements:** FR6, FR22, AD-19, UX-DR11, UX-DR12, UX-DR20, UX-DR40

**Acceptance Criteria:**

**Given** a Published item in the editor
**When** the merchant edits
**Then** nothing autosaves; a "Save changes" button commits all edits as one `content.item.edited` event and shows the "Changes saved" toast

**Given** the row menu
**When** the merchant chooses Duplicate
**Then** a new Draft copy with "(copy)" title and same slides and link is created, without placements or schedule

**Given** Archive
**When** chosen
**Then** the item becomes Archived, emits its event, and a toast announces "Archived. Undo available" with Undo that never auto-dismisses; Undo returns the prior status
**And** Archived items offer "Restore", returning them to Draft

**Given** Delete
**When** chosen
**Then** a confirm dialog naming the item appears; confirming soft-deletes it, emits `content.item.deleted`, and removes it from all tabs

**Given** media referenced only by a deleted item
**When** no references remain
**Then** `media` may remove the asset later; assets referenced elsewhere are kept
