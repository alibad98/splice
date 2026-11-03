# Epic 3 Context: Content Creation & Media

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The merchant creates Stories and Reels, uploads or imports their media, links a synced product and a call to action, previews the result with the real storefront player in preview mode, and manages each item through its full status lifecycle (create, edit, duplicate, archive, restore, delete). This epic produces safe, processed, shoppable content that Epic 4 places on the storefront and Epic 5 plays; it must be tenant-isolated, resistant to unsafe uploads, and clear about processing state and failures.

## Stories

- Story 3.1: Model content items and their status lifecycle
- Story 3.2: List and filter content with status tabs
- Story 3.3: Create a Story or Reel with title, format and CTA
- Story 3.4: Link a product with the product picker
- Story 3.5: Upload media directly to storage safely
- Story 3.6: Add slides with the media uploader and reorder them
- Story 3.7: Import media from an external link
- Story 3.8: Process videos into renditions and posters
- Story 3.9: Run quality checks, retry failures and auto-publish
- Story 3.10: Serve a preview manifest for one content item
- Story 3.11: Render content in the player's preview mode
- Story 3.12: Show the live preview panel in the editor
- Story 3.13: Edit, duplicate, archive, restore and delete content

## Requirements & Constraints

- Content has title, format (Story or Reel), linked product, CTA and multiple image/video slides (upload or external link). CTA = label + action (add to cart / open product / open link) + optional preset style. "Open link" accepts only URLs on the store's own synced domains, validated in the dashboard and again by the API.
- Statuses: Draft, Processing, Failed, Scheduled, Published, Ended, Archived, Deactivated. There is no "Ready"; passing processing without auto-publish returns to Draft. Only Published items within schedule reach the storefront. Published and Scheduled count toward plan limits.
- Tabs: All (every non-deleted status), Published, Scheduled, Drafts (Draft, Processing, Failed). Archived, Deactivated and Ended appear only under All with a chip.
- Upload limits: video MP4/MOV/WebM, at most 200 MB, at most 90 s, shorter side at least 720; image JPG/PNG/WebP, at most 10 MB, shorter side at least 1080. Quality flags: below minimum resolution, no video track, corrupt, over duration. External links are fetched and processed like uploads, never hotlinked.
- Security: content-sniffed file type, SVG rejected, image EXIF/GPS stripped, malware scan before publish, SSRF-safe external fetch, merchant text escaped and rendered `dir="auto"` (no XSS).
- Failed media jobs retry automatically (media: 3 attempts), then show Failed with a friendly reason and a Retry action.
- Performance and cost: 60 s video processed within 5 minutes P95 (excluding queue spikes), recorded as a metric. Upload-URL issuing is throttled per store, abuse metric recorded, stored bytes metered per store.
- Auto-publish with no placement stays Draft with the reason "Add a placement to publish" (placements arrive in Epic 4).
- Published items are edited live and saved explicitly (interim decision); only Drafts autosave.
- Preview shows no real cart or analytics: cart success simulated, no events sent.

## Technical Decisions

- **Ownership:** `content` owns `content_items`, `content_product_links`, `slides`; `media` owns `media_assets` and `renditions`. Only the owner writes; others use owner service reads, commands or domain events. No cascading FKs across modules; deletion is soft (tombstone kept for analytics). A test fails on tables without a declared owner.
- **Tenant isolation:** non-null `store_id`, RLS with `FORCE`, `StoreScoped` repositories, one cross-tenant test per table; workers set store context per job.
- **Status writes:** only `content` writes status. The transition table lives in `packages/contracts`; disallowed transitions return an RFC 9457 problem (type `invalid-transition`). `media` and later `billing` request changes via `content` commands. Each transition emits `content.item.<status-verb>` through the transactional outbox in the same transaction (events: `content.item.edited`, `content.item.deleted`, etc.). Handlers idempotent on event ID.
- **Schedule/ordering fields:** `first_published_at` is stored on the item (used for placement ordering in Epic 4).
- **Media pipeline:** direct-to-storage pre-signed uploads (store-scoped, store-prefixed, content-addressed immutable paths, 15 min expiry, size-limited). Asset states `uploaded -> scanned -> processed | failed`; only `processed` assets are publishable. `MalwareScanner` and `MediaProcessor` are ports (no vendor assumed; hosting deferred). Output: progressive MP4 at 480p/720p/1080p (where source allows) plus poster, no HLS; images get a web-optimized version. External fetch only in the worker via one SSRF-safe fetcher (blocks private/loopback/link-local/metadata IPs and redirects to them; size and timeout limits). Assets are removed only when unreferenced.
- **Background work:** pg-boss, worker only; media queue is its own deployment; media retry 3 attempts with the one queue-policy file; job payloads Zod-versioned, carrying `trace_id` and `store_id`.
- **Preview:** `GET /v1/preview/content/{id}` returns a `StoreManifest` v1 with only that item, built by a compile function in `publishing` that Epic 4 reuses for the CDN manifest. Requires the merchant session, never CDN-cached, other store's item returns 404; Processing slides fall back to posters or original upload. The dashboard embeds the real player build in an iframe with `MockStorefrontPlatform`; new manifests are posted to the iframe and re-render without reload.
- **Player preview rendering:** Shadow DOM, system fonts, `--slips-*` properties only, direction from locale, 9:16.
- **Contracts and API:** hand-written Zod v1 in `packages/contracts`; `/v1/<resource>` paths; problem+json errors with stable `type` slugs, no user text from the API; dashboard uses per-module TanStack Query hooks and nuqs URL state, RHF with contract Zod schemas.
- **Money/time:** integer minor units plus currency; UTC timestamps; schedule display in store time zone.

## UX & Interaction Patterns

- Content table: shadcn Table in Card, 56px rows with 9:16 thumb, status chip, row hover, click or `Enter` opens editor, row menu (Edit, Duplicate, Archive, Delete with confirm dialog naming the item), sortable headers, debounced search, tab/search/sort in the URL (`?tab=`). Card list on `sm`. Views and clicks show "—" until Epic 6.
- Status chips (text label always, never colour alone): Processing pulsing dot (static under reduced motion), Failed with reason and 6% row tint, Scheduled with date, Archived with icon, Deactivated amber, Ended outline.
- Editor: two columns (form start side, preview end side); single column with sticky preview button on `md`; stacked with preview toggle on `sm`. Drafts autosave after ~1 s with "Saved"; Published items use explicit "Save changes" and the "Changes saved" toast. Publish blocked without a placement with inline reason. Unsaved-changes confirm on leave. Errors on blur/submit with a summary linking to fields, announced via live region. Alt text required on image slides.
- Uploader: dashed `input-border` drop zone, multi-file, client-side pre-check naming the violated limit, per-file progress, Processing with poster, Failed with reason and Retry.
- Slide reorder: "Move earlier"/"Move later" buttons plus drag; logical order (RTL-safe), announces "Slide 2 of 3", focus stays on moved slide.
- Product picker: keyboard-operable combobox with thumb, name, price, availability chip. Out-of-stock link allowed with warning; required-options product shows a "View options" note on CTA preview.
- Live preview: 9:16 phone frame (radius lg, ink bezel), always-visible "Preview: no real cart or analytics", updates within 2 s of draft save, skeleton frame after 150 ms, "Preview didn't load. Try again." with Retry.
- Archive toast: "Archived. Undo available", Undo never auto-dismisses and returns prior status; Archived items offer Restore (to Draft). Duplicate creates a Draft "(copy)" without placements or schedule.
- Empty states: friendly-coach sentence with one amber "Create your first story" action; 6-row boneyard skeleton after 150 ms; inline Retry on API failure. Copy in `ar`/`en`, Arabic first; logical CSS properties only; WCAG 2.1 AA.

## Cross-Story Dependencies

- 3.1 creates the state machine and events every other story relies on; 3.8 and 3.9 drive Processing, Failed and Draft only through `content` commands from 3.1.
- 3.5 creates `media_assets` and the sniff/strip/scan path; 3.6 creates `slides` referencing them; 3.7 and 3.8 reuse that same path.
- 3.9 depends on 3.8 outputs; its auto-publish eligibility check needs placements from Epic 4 until then it falls back to Draft.
- 3.10 introduces the compile function that Epic 4 (Stories 4.x manifest publishing) reuses; 3.11 consumes its manifest shape; 3.12 composes 3.10 and 3.11 into the editor.
- 3.4 consumes `catalog` (Epic 2) reads and the `catalog.product.deleted` event; it creates `content_product_links` and `getLinkCountsByProductIds`, which Epic 2's Products page uses for real linked-content counts. `content.item.edited` from 3.4 and 3.13 lets Epic 4 publishing drop or refresh items.
- Epic 1 supplies the app shell, tokens, toast region, RLS and `StoreScoped` base, outbox transport and queue policy; Epic 4 adds placements and schedules; Epic 6 fills views/clicks; Epic 7 `billing` later requests Deactivated through `content` commands.
