# Epic 4 Context: Visibility, Scheduling & Publishing

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make published content appear on the intended storefront pages, with the chosen layout and publication order, at the scheduled time. Keep delivery fast and reliable through one cached manifest per store, with merchant changes visible within one minute and Salla product updates within two minutes P95.

## Stories

- Story 4.1: Choose placements and targets for a content item
- Story 4.2: Pick a layout per placement with Settings defaults
- Story 4.3: Schedule start and end in the store time zone
- Story 4.4: Compile the per-store manifest of eligible content
- Story 4.5: Serve the manifest from the CDN and purge on change
- Story 4.6: Refresh the storefront on product price and stock changes

## Requirements & Constraints

- Placements support Home, Category and Product pages, optionally narrowed to a synced category/product. At least one valid placement is required to publish; deleted targets invalidate placements. Auto-publish without one leaves the item Draft with an actionable reason.
- Stories support Ring/Bar; Reels use strips or cover carousels opening the full-screen viewer. Home/category carousels may be boxed/full width; product strips appear below images or at a custom position. Reject invalid page/layout combinations. New placements inherit store display defaults.
- Serve only eligible Published items with processed, immutable media and current product snapshots. Exclude other statuses, soft-deleted items and content whose linked product was deleted. Order each placement by newest `first_published_at`, capped at 10.
- Publish, unpublish, archive, delete and schedule boundaries must reach storefronts within one minute. Price/stock updates have a two-minute P95 budget: one minute sync plus one minute cache. Salla remains authoritative for the cart price.
- Unknown, uninstalled or purged stores and revoked keys return an empty eligible list. During a Salla outage, retain the last manifest and surface staleness through operational metrics.
- Ali approved the controlled pilot on 2026-11-11. Deliver Home/Story/Ring/publish-now first, with scheduling disabled and absent schedules treated as publish-now. Preserve full-epic contracts and requirements; track partial delivery in `pilot-readiness.md`, never mark a full story complete from a pilot slice. Close relevant review gaps before the Home placement slice. Merchant, provider/region, support and numeric caps remain launch decisions; deployment/enrollment need separate authorization.

## Technical Decisions

- `content` owns placements, schedules and all status mutations. `integration` owns the single store-settings record, including display defaults, language, time zone and attribution settings. `publishing` owns manifests and manual-fallback keys. Respect owner-only writes; obtain cross-module data through owner services/events. Tenant data requires non-null `store_id`, store-scoped access, RLS and cross-tenant verification.
- Store timestamps as UTC `timestamptz`. Accept schedule wall-clock time plus store zone; only the API converts it. Use the Salla zone when available, otherwise `Asia/Riyadh`. Re-anchor future schedules by wall clock after a zone change; reject end times at or before start.
- Enforce the shared transition table: delayed jobs move Scheduled to Published and Published to Ended. `content` owns deduplicated jobs per item/boundary, replacing them on edits. `publishing` filters status rather than independently evaluating time. Ended is inactive and appears under All. Publish admission and eventual plan-limit decisions belong to `content`; manifest compilation must not trim for billing limits.
- Reuse the same publishing compiler for previews and storefront manifests. The versioned `StoreManifest` includes placements/layouts, display options, product snapshots and immutable processed asset URLs. Previews bypass the CDN. Keep wire schemas in shared contracts; do not expose database types.
- Compile only in the worker through pg-boss: single-flight per store, debounced approximately ten seconds. Persist monotonically increasing manifest revisions and check before upload so older work cannot overwrite newer output.
- Maintain one manifest-input trigger list covering content edits/status, visible product changes/deletion, settings, plans, key retirement, lifecycle and schema backfills. Enqueue domain events transactionally with state changes; consumers are idempotent by event ID. Visible product fields include price/sale price, availability bucket, name, image and required-options flag; unrelated changes must not trigger compilation.
- Validate open-link CTAs against synced store domains at save and compile; drop invalid CTAs and flag affected content. Publish the manifest at `/m/v1/salla/<platform_store_id>.json` and active/retiring fallback-key paths. Use 60-second TTL plus stale-while-revalidate, with retried purges. Normal manifest purges belong exclusively to `publishing`; media deletion and orchestrated store purge are explicit exceptions.
- Record compile lag and manifest size; alert on staleness and warn above 15 KB gzip. Manifest sharding is deferred. Measure schedule-start/end and product-price freshness in integration checks rather than relying on cache settings alone.

## UX & Interaction Patterns

- Integrate controls into the editor beside the real-player preview, with responsive stacking. Drafts autosave; Published changes require explicit Save changes and one transactional edit event. Protect unsaved edits when leaving.
- Keep blocked Publish focusable with `aria-disabled` and an inline reason. Use searchable target pickers, localized field errors and clear deleted-product flags. Status chips always include text; Scheduled includes its date and Ended uses an outline without a dot.
- Externalize Arabic/English copy and support RTL/LTR, keyboard operation and visible focus. Isolate mixed-direction target names with automatic direction. Use Western digits, Gregorian dates with Arabic month names in Arabic, and an explicit store-time-zone label.
- Preserve the storefront's no-layout-shift contract: inline entries insert only while eligible and their anchor is below the viewport; otherwise use an overlay entry. Reserve no space for absent content.

## Cross-Story Dependencies

- Catalog synchronization supplies targets, product snapshots and manifest-visible change/deletion events. Content/media foundations supply the status machine, processed assets, transactional edits and shared preview compiler.
- Placement validity and layout defaults feed schedule/publish eligibility and compilation; compilation feeds CDN delivery; catalog events and cache invalidation complete the freshness path. Boundary jobs must emit events even without a merchant write.
- The storefront player consumes placement metadata and versioned manifests. Later settings, key rotation, billing and lifecycle flows must reuse the same settings ownership, content admission rules and manifest-trigger pipeline.
