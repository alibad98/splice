---
title: '4.6 Product freshness on the storefront - controlled pilot slice'
type: 'feature'
created: '2026-11-12'
status: 'done'
pilot_slice_status: 'done'
full_story_status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '750911e127bdfde3168d97bc386ff30b60919843'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Catalog already announces manifest-visible product changes, and those events already trigger store compiles, but nothing proves that a price, stock-bucket, required-options or deletion change reaches the cached storefront manifest within budget. Every visible change to any product, even one no content links, also forces a compile.

**Approach:** Only compile for product events whose product is linked to non-deleted content. Then prove the full webhook → catalog → event → compile → delivery → CDN path with a measured freshness test, continuing the approved Home/Story/Ring publish-now pilot.

## Boundaries & Constraints

**Always:**
- Salla stays authoritative for the cart price; the manifest snapshot is display-only. Visible fields are exactly `PRODUCT_VISIBLE_FIELDS`; catalog keeps emitting only on their change.
- `catalog.product.updated` and `catalog.product.deleted` enqueue a compile only when content links the product to at least one non-deleted item, read through the content owner's service. `catalog.sync.completed` and every other `MANIFEST_INPUTS` event keep compiling unconditionally.
- A deleted linked product withholds its item at the next compile (existing compiler rule); a recreate restores it.
- Decision (Ali, 2026-11-12): a linked product hidden in Salla (`visible` false) withholds its item exactly like a deletion; unhiding restores it at the next compile. Previews are unaffected.
- Decision (Ali, 2026-11-12, review B1/V1): no merchant signal for a hidden linked product in this slice; the content flag and dashboard chip are deferred to a follow-up.
- Pipeline freshness (webhook processed → shopper read through the caching fixture) is measured and stays under 60 s, leaving the other minute of the 2-minute P95 budget for Salla webhook delivery.
- Preserve RLS, owner-only reads/writes, previews, debounce/single-flight and 4.5 delivery semantics.

**Never:** Deploy, enroll merchants, change the Salla adapter, add scheduling, other placements/formats, player, cart or analytics. Schedule start/end freshness and staging CI timing stay with full 4.6; full 4.6 stays in progress.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Visible change, linked | Price, sale price, stock crossing a bucket, or required-options flag of a product linked to a live Home Story | New value in the shopper read in < 60 s | Existing compile/delivery retries |
| Non-visible change | Stock change within the same bucket, description, tax flag | No event, no compile job | N/A |
| Visible change, unlinked | Product no non-deleted content links | Event emitted, no compile job enqueued | N/A |
| Deletion, linked | `product.deleted` webhook or 404 fetch | Item absent from the shopper read in < 60 s; content flagged (existing) | Existing retries |
| Recreate | Deleted product written again by a newer source | Item returns at the next compile | N/A |
| Hide / unhide, linked | `visible` false, then true | Item absent in < 60 s, then returns | Existing retries |

</frozen-after-approval>

## Code Map

- `apps/api/src/worker/publishing-jobs.ts` -- `registerPublishingEventHandlers` loops `MANIFEST_INPUTS`; add the linked-product gate for the two product events. Takes a narrow content dependency (`Pick<ContentService, ...>`); keep `enqueueManifestCompile` unchanged.
- `apps/api/src/modules/content/content.service.ts` `getLinkCountsByProductIds` (line 52) and `content.repository.ts` `linkCountsByProductIds` (counts non-deleted items) -- reuse; add a single-product convenience only if it stays a thin wrapper.
- `apps/api/src/worker/worker.ts` (~line 145) -- passes the content service into the publishing handler registration; update other callers (`composition/manifest-delivery.test.ts`, `store-manifest.test.ts`).
- `apps/api/src/modules/publishing/store-manifest.ts` lines 106-113 -- product selection (deleted/missing withholds); also withhold hidden (`visible === false`; `ProductSummaryRow.visible` is already read). Store compile only — `compileManifest`/preview untouched. Update the class doc comment (line ~30) and `store-manifest.test.ts`.
- `apps/api/src/modules/publishing/manifest-inputs.ts` -- update the comment ("guarantees are Story 4.6") to describe the linked-product gate.
- `apps/api/src/modules/catalog/product-webhooks.ts`, `catalog.repository.ts` (`applyProduct` `changed`), `availability.ts` -- existing emission; do not change.
- `apps/api/src/composition/manifest-delivery.test.ts` -- harness to reuse (caching CDN fixture, `eventsAndCompile`, `drain`, `story`); `composition/product-webhooks.test.ts` -- how product webhooks are processed through the integration inbox with the Salla adapter.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/worker/publishing-jobs.ts`, `worker.ts` -- gate product events on linked non-deleted content; log skipped triggers at debug.
- [x] `apps/api/src/modules/publishing/store-manifest.ts` -- withhold items whose linked product is hidden; unit-test hidden/unhidden selection.
- [x] `apps/api/src/modules/publishing/manifest-inputs.ts` -- comment update.
- [x] `apps/api/src/composition/product-freshness.test.ts` (new) -- every matrix row against isolated PostgreSQL, real pg-boss eligibility and the caching HTTP fixture, driving product changes through the product-webhook consumer; record measured milliseconds per row.
- [x] Unit test for the handler gate (linked / unlinked / deleted-content-only link).
- [x] `pilot-readiness.md`, `sprint-status.yaml` -- executed evidence; full 4.6 remains in progress.

**Acceptance Criteria:**
- Given a primed cache, when a linked product's price changes via webhook, then the shopper read shows the new price in under 60 s, including event dispatch, compile, delivery and purge.
- Given a burst of unlinked product updates, when events dispatch, then no compile job is created and the store's manifest revision is unchanged.

## Implementation Notes

- Gate: `registerPublishingEventHandlers(registry, boss, telemetry, content)` takes `Pick<ContentService, 'getLinkCountsByProductIds'>`; the read joins the delivery transaction's store context. No single-product wrapper was added.
- Hidden products: `StoreManifestCompiler.select` requires `deleted === false && visible`; `compileManifest`/preview untouched.
- `store-manifest.test.ts`: the `MANIFEST_INPUTS` trigger test now links the product first for the two product events and delivers only the event under test; new gate cases (unlinked, deleted-only link, linked) and a hide/unhide selection case. The pre-existing `burst` case got a 20 s timeout: its slot alignment can wait up to 5 s, the default timeout (it flaked once during this work).
- `worker/publishing-jobs.test.ts` (new): pure unit test of the gate with fakes.
- `composition/product-freshness.test.ts` (new): measured ms are recorded in pilot-readiness.md (~9-10 s per row, dominated by the 10 s debounce slot). These ms come from the test's own 100 ms polling loop; the worker's pg-boss polling and the `events.dispatch` job hop are not included.

## Spec Change Log

## Review Triage Log

Independent three-layer review, 2026-11-12 (blind, edge-case, verification-gap; none skipped).

| ID | Verdict | Evidence and disposition |
| --- | --- | --- |
| B1 | medium | Hidden linked product silently drops a published item from the storefront; unlike deletion (`notifyLinkedProductDeleted` → `content.item.edited`, "Linked product deleted" chip in `ContentTable.tsx:48`) the merchant gets no signal. The frozen decision settles the compile, not merchant notification. intent_gap. |
| V1 | medium | Same as B1 (verification-gap "Other findings"); grouped with B1. |
| B2 | low | `name`/`image_url` freshness rows absent, but they flow through the identical `catalog.product.updated` → gate → compile path the price rows prove. Rejected: low, rarely distinct, adds test rows only for duplicate coverage. |
| B3 | low | Timings use a test loop (100 ms polling) instead of worker pg-boss polling and the `events.dispatch` hop; pilot-readiness presents them as pipeline latency without that caveat. Patch: state the caveat in the evidence. |
| B4 | low | Reconcile emits the same `catalog.product.updated`/`deleteProducts` events through the same gate; existing reconcile tests cover emission. Rejected: low, same path. |
| B5 | low | Gate counts draft/archived links, per the spec's "non-deleted" rule; extra compile is deduplicated by 4.5 delivery hashing (revision bump already deferred). Rejected: low, fix adds a status branch. |
| B6 | low | Skips logged at debug only; a broken gate would be caught by the unit/composition tests. Rejected: low, fix adds a new metric surface. |
| B7 | false | `eventDispatcher` parses each payload with `EVENT_CATALOG[name].schema` (`dispatcher.ts:41`), which requires `product_id: z.uuid()` for both product events, so a missing id fails loudly before the handler. |
| B8 | low | Unit test's `DELETED_ONLY` fake returns 0 like `UNLINKED`, so it adds nothing; real deleted-only coverage is the composition test. Patch: delete the redundant case. |
| B9 | low | Single long freshness `it`; developer ergonomics only. Rejected: low, restructuring exceeds a direct correction. |
| B10 | low | `compileAndDeliver() === 0` in the unlinked burst passes even with a broken gate (job not yet eligible in its slot); job count and revision are the real checks. Patch: delete the assertion. |
| B11 | false | The `source_spec: none` entry was written by Build step 1's split, whose format mandates `none`. |
| B12 | low | `linkedProduct` docstring says "live (draft)", conflating live with non-deleted. Patch: reword. |
| E1 | low | Hidden selection is tested in `composition/store-manifest.test.ts`, where every existing selection test lives (it needs RLS-bound reads). Rejected: low, matches house convention. |

B1/V1 resolved by Ali's decision (frozen block): merchant signal deferred to deferred-work.md, no code reverted. Patches B3, B8, B10, B12 applied by the implementation agent. B2, B4, B5, B6, B9, E1 rejected as low; B7, B11 rejected as false. Parent verification after patches (2026-11-12, isolated PostgreSQL port 15436): `pnpm turbo run lint typecheck build --continue --concurrency=2` 19/19; API Vitest `--maxWorkers=2` 41 files, 773 passed, 1 pre-existing MinIO-only skip; `git diff --check` clean.

## Verification

**Commands:**
- `pnpm turbo run lint typecheck build --continue --concurrency=2` -- expected: all tasks pass.
- API Vitest with `--maxWorkers=2` against an isolated PostgreSQL port (never the development database) -- expected: full suite passes, including the new freshness file.
- `git diff --check` -- expected: clean.
