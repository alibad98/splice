# Epic 3 Context: Content Creation & Media

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Merchants create, upload, preview and manage Stories and Reels through their full lifecycle. Content must be safe, tenant-isolated and ready for later storefront publishing. Published changes remain under merchant control. Ali approved the controlled pilot on 2026-11-11: Home/Story/Ring/publish-now storefront delivery first, preserving completed creation/media/preview capabilities and original full-story acceptance criteria. Track launch gates in `pilot-readiness.md`.

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

- Items contain title, Story/Reel format, one linked product, CTA and ordered slides. CTA supports label, action and preset style; open-link URLs must belong to the store's synced domains, validated by client and API.
- Statuses are Draft, Processing, Failed, Scheduled, Published, Ended, Archived and Deactivated. No Ready status. Only Published items within schedule reach storefronts; Published and Scheduled count toward plan limits. Drafts tab includes Draft/Processing/Failed; All includes every non-deleted status.
- Drafts autosave after roughly one second. Published edits never autosave: explicit Save changes commits all edits together and emits one edited event. Warn before leaving with unsaved changes.
- Duplicate makes a Draft copy with the same slides/product link, without placements or schedule. Archive supports persistent Undo to prior status; Restore returns Archived content to Draft. Delete requires confirmation naming the item and preserves an analytics tombstone. Shared media survives deletion of another referencing item; unreferenced assets may be cleaned later.
- Videos: MP4/MOV/WebM, at most 200 MB and 90 seconds, shorter side at least 720px. Images: JPG/PNG/WebP, at most 10 MB, shorter side at least 1080px. When metadata is readable, reject low-resolution files before upload with actual/minimum dimensions, higher-resolution guidance and replacement action; retain accepted batch files. Never upscale or crop to bypass limits.
- Sniff types, reject SVG/mismatches, strip image metadata, scan before publication and safely fetch external media into storage rather than hotlinking. Exhausted processing retries explain the reason and offer Retry. A 60-second 1080p video should process within five minutes P95, excluding queue spikes.
- No placement means no publish, including auto-publish. Preview never sends analytics or real cart requests. Merchant text is escaped and direction-aware.

## Technical Decisions

- Modular monolith with ports/adapters and explicit ownership. Content owns items, product links and slides; media owns assets/renditions. Other modules use owner services or transactional events. Avoid cascading foreign keys across modules.
- Non-null store IDs, forced RLS and store-scoped repositories protect every tenant table; verify cross-tenant access. Workers establish store context per job.
- Content alone writes lifecycle status against the contracts transition table. Invalid transitions produce a stable problem and no writes. Changes and outbox events commit together; handlers are idempotent. Soft deletion must not free media referenced elsewhere.
- Presigned uploads are store-prefixed, content-addressed, size-limited and expire in exactly 15 minutes. Throttle abusive upload-URL issue rates and record abuse metrics; meter per-store stored bytes, storage and delivery usage. Assets progress uploaded to scanned to processed/failed; only processed assets publish. External integrations remain behind storage, scanner and processor ports. Progressive MP4 renditions at supported 480p/720p/1080p plus posters; no HLS. Record processing-duration metrics to evaluate the five-minute P95 target for 60-second 1080p video (excluding queue spikes); a single local test is not deployed P95 evidence.
- External fetch blocks private, loopback, link-local and metadata destinations, including redirects; bound bytes/time. Media jobs use their own worker queue, three automatic attempts, versioned payloads and trace/store IDs.
- Preview is authenticated, never CDN-cached and returns 404 for another store's item. One compiler serves preview now and storefront later. Processing slides may use posters/source uploads in preview only. Embed the real player in an iframe with a mock platform; update manifests without reload. Player uses Shadow DOM, system fonts, 9:16 and its own custom properties.
- Shared versioned Zod wire contracts and stable problem slugs govern APIs. Money uses integer minor units; timestamps are UTC with store-zone display.

## UX & Interaction Patterns

- Reuse components/tokens. Arabic first, English supported, logical CSS, Western digits in both locales and merchant text with automatic direction. Follow dashboard WCAG AA, keyboard access, visible focus and reduced motion.
- Content rows open by click/Enter; row actions support Edit, Duplicate, Archive/Delete or Restore. Tabs/search/sort persist in URL. Mobile uses cards; status labels never rely on color. Views/clicks remain unavailable until analytics exists.
- Editor has form/end-side preview at desktop, sticky preview action at tablet and toggle on phones. Validation appears near fields with a linked, announced summary. Images require alt text; reorder uses logical earlier/later controls, announces position and retains focus.
- Product picker is searchable and keyboard-operable. Out-of-stock linking is allowed with warning; required options explain the View options fallback. Skeletons appear after 150ms; failures have inline Retry.
- Preview uses a phone frame and persistent simulated-cart/no-analytics notice; saved drafts update within two seconds. Archive Undo stays until dismissed; destructive confirmation names content. Copy is brief/helpful in both languages.

## Cross-Story Dependencies

- Lifecycle ownership/events underpin editing/media. Upload, slides, import, renditions and quality checks share one pipeline; processing results request transitions through content commands.
- Product linking consumes catalog reads/deletion events and supplies linked-content counts. Edit/delete events let later publishing refresh eligibility.
- Preview compiler, preview player and editor panel form one reusable chain. Epic 4 adds placements/layouts/scheduling/publishing; Epic 5 storefront runtime/cart; Epic 6 analytics; Epic 7 entitlements/operations. Do not introduce substitute implementations for future owners.
