---
title: '4.5 CDN manifest delivery and purge - controlled pilot slice'
type: 'feature'
created: '2026-11-12'
status: 'done'
pilot_slice_status: 'done'
full_story_status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '67c72876d931af792bb63e91e112500911d6b724'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** The Home/Story/Ring compiler writes only a database row. Shoppers cannot retrieve its output through the CDN, and withdrawals cannot invalidate cached content.

**Approach:** Deliver compiled manifests to object storage through durable jobs, then invalidate CDN paths. Add an object-backed public origin, alerts and measured delivery tests, continuing the approved publish-now pilot.

## Boundaries & Constraints

**Always:**
- Serve `/m/v1/salla/<platform_store_id>.json` with `Cache-Control: public, max-age=60, stale-while-revalidate=60` and cross-origin reads. Shopper reads access objects only. Missing objects return 200 empty v1 JSON, using the all-zero UUID when identity is unknown.
- Only publishing calls `CdnPurger` for normal invalidation. Preserve private source media. Use a configured authenticated HTTP purge bridge with a documented contract, bounded timeout and no credential logging. Production provider configuration and CDN evidence remain launch gates.
- Atomically enqueue delivery with compilation; persist progress. Serialize revision checks and external writes against compilation and lifecycle changes. Older jobs must never overwrite newer output. Retry durably, including purge failures after successful uploads.
- Compare canonical content hashes to skip redundant completed delivery, without suppressing pending purges or withdrawals.
- Disconnected retains last good output; uninstall uploads empty and purges. Store purge removes tenant rows and durably clears public objects without recreating tenant data. Earlier install epochs cannot overwrite reinstallation.
- Meter delivery lag, pending/failed work and purges; alert on staleness and exhausted retries. Preserve RLS, owner-only writes and previews.

**Never:** Deploy, select production hosting, enroll merchants, or add scheduling, other placements/formats, player, cart or analytics. Manual fallback keys/key paths remain deferred; full 4.5 stays in progress.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Publish / edit / withdraw | Committed manifest change | Latest JSON uploaded; cached path invalidated | Durable retries and alert after exhaustion |
| Race / duplicate | Old revision, concurrent jobs or unchanged content | Newest output wins; redundant completed delivery skipped | Pending purge still retried |
| Storage / purge failure | Upload fails, or upload succeeds but purge fails | Progress survives restart; no false delivery acknowledgement | Retry failed phase |
| Lifecycle | Disconnect, uninstall, purge, reinstall | Last good / empty / empty / current epoch respectively | Stale jobs cannot revive withdrawn data |
| Missing path | Unknown store or absent object | 200 empty manifest JSON, no database lookup | Storage outages remain observable |

</frozen-after-approval>

## Code Map

Paths below are repository-relative; abbreviated sibling paths share the preceding directory.

- `apps/api/src/modules/publishing/store-manifest.ts`: atomic delivery enqueue; preserve the shared `manifest-compiler.ts`.
- `apps/api/src/worker/publishing-jobs.ts`, `queues.ts`, `worker.ts`: pg-boss handlers, retries and registration.
- `packages/db/src/schema/publishing.ts`, `packages/db/migrations/0025_manifest_delivery.sql`, `packages/db/src/testing/cross-tenant.ts`: delivery state, forced RLS, constraints and migration registration.
- `apps/api/src/modules/integration/integration.service.ts`: owner-provided identity/epoch read; existing lifecycle locking coordinates delivery. Avoid `isStoreActive`, which rejects disconnected stores.
- `apps/api/src/ports/object-storage.ts`, `apps/api/src/adapters/storage/`: compatible cache metadata support; new `apps/api/src/ports/cdn-purger.ts`, `apps/api/src/adapters/cdn/http-cdn-purger.ts`: purge contract/adapter.
- `apps/api/src/modules/publishing/`: new `manifest-delivery.ts` and `manifest.controller.ts`; wire `publishing.module.ts` and `publishing.lifecycle.ts`. Use `@Public()` and object-only reads.
- `apps/api/src/http.ts`, `infra.module.ts`, `config/env.ts`: adapter/config wiring. `apps/api/src/ports/telemetry.ts`, `ops/alert-rules.json`, `.env.example`, `docs/runbooks/manifest-delivery.md`: metrics and operations.
- `apps/api/scripts/manifest-delivery-ops.ts`: tested operator backfill, phase-preserving dead-letter redrive and status commands used by the runbook.

## Tasks & Acceptance

**Execution:**
- [x] DB files above: delivery state, migration registration, ownership and isolation tests; isolated databases only.
- [x] Storage/CDN files above: cache metadata, purge contract and adapter tests.
- [x] Publishing/worker files above: atomic enqueue, serialized delivery, deduplication, phase retries and epoch-safe cleanup.
- [x] Origin/config files above: object-only JSON reads and validated adapter configuration.
- [x] `apps/api/src/composition/manifest-delivery.test.ts`: all matrix rows, restart recovery and concurrency against isolated PostgreSQL and a caching HTTP fixture.
- [x] Runbook, alerts, `pilot-readiness.md`, `sprint-status.yaml`: executed evidence and remaining gates.

**Acceptance Criteria:**
- Given Home content, when publish/edit/unpublish/archive/delete commits, then a caching HTTP integration test measures changed output within 60 seconds, including dispatch, compile and delivery.
- Given committed versus rolled-back compiles, when workers run, then only committed work produces delivery jobs.
- Given Salla unavailability, when shoppers read, then last-good output remains available and stale/pending work is observable.

## Implementation Notes

- Compilation now requires a delivery sender. It holds the existing integration lifecycle lock before the manifest lock and atomically writes the manifest, desired delivery checkpoint and pg-boss upload job. The owner supplies platform identity and install epoch through `IntegrationService.getManifestIdentity`; shopper requests never call integration or the database.
- Upload intent, upload acknowledgement and purge are separately committed phases on the realtime delivery queue. A durable uncertainty checkpoint clears prior uploaded/delivered proofs before PUT, so storage acceptance followed by process death or transaction rollback cannot leave a stale deduplication proof. Revision and install-epoch checks under the lifecycle lock cover external writes, compiles, disconnect and lifecycle transitions. Completed canonical hashes skip duplicate work; pending purges are retained, including the A -> uploaded B -> A case.
- Publishing purge atomically queues identity-only cleanup before deleting its tenant delivery/manifest rows. Cleanup uploads empty then queues purge, survives process reconstruction and does not recreate tenant rows. Reinstallation makes earlier epochs inert.
- The public Nest origin reads objects only, returns the exact cache policy and public CORS headers, supplies all-zero empty identity for absent objects, and surfaces storage errors as non-cacheable 503 responses. Object PUT metadata is optional and compatible with private source-media uploads.
- The HTTP purge bridge uses paired URL/token configuration, HTTPS in production, bounded timeout, no redirects and sanitized failures. Queue grants now permit only explicitly named event/delivery tables on owner-context transactions. The operational aggregate function exposes pending/failed counts and oldest pending age only; its fixed search path and revoked public execute grant are tested, while direct tenant tables retain forced RLS.


## Spec Change Log

## Review Triage Log

Independent three-layer review, 2026-11-12. Each finding was classified before grouping.

| ID | Verdict | Evidence and disposition |
| --- | --- | --- |
| B1 | medium | Publishing purge and final lifecycle completion use separate transactions. A compile can recreate checkpoints between them; the purged compiler branch only deletes manifests. Patch that branch to delete delivery state too; test the interleaving and eventual purge event. |
| B2 | medium | Migration creates no delivery jobs for existing compiled manifests. Add an executable, documented pre-rollout backfill using existing compile jobs; verify existing active-store output becomes available. No new public API is needed. Patch. |
| B3 | medium | The upsert resets requested_at when desired content changes during unresolved delivery. Preserve the earliest outstanding timestamp across hashes within an epoch. Patch and test. |
| B4 | medium | getStream maps NoSuchBucket to null, causing the new origin to cache empty output for missing storage. Distinguish missing keys from bucket/configuration failures. Patch. |
| B5 | medium | S3 PUT has no abort deadline while delivery holds the lifecycle lock. Add a bounded manifest PUT using the existing SDK cancellation option and verify cancellation. Patch; durable uncertainty already covers failed writes. |
| B6 | low | Origin buffering is unbounded, but this private namespace is written only by the capped compiler. No reachable oversized object from the current public request was demonstrated. Reject a new size-limit branch for this uncommon operational corruption case; public requests cannot choose arbitrary source objects. |
| B7 | maybe-false | The fixture proves CDN invalidation, not browser cache/SWR behavior. The future player loader's fetch cache policy is not implemented in this slice, so its actual shopper outcome cannot yet be established. Defer the medium-risk unverified integration question to loader/deployed-browser validation; check the loader policy and browser requests to settle it. |
| B8 | low | Custom-header preflight would use dashboard CORS, but current public manifest reads are simple GETs with no custom headers. Reject additional preflight handling for a caller absent from the current flow. |
| B9 | medium | Revoke/grant statements are non-atomic, but the same sequence and event-enqueue outage window existed before this change. Defer the existing worker-start grant race; the new array argument does not create it. |
| B10 | medium | The runbook refers to recovery tooling without naming an executable procedure. Replace it with concrete pg-boss redrive/verification commands preserving payload and phase, including cleanup jobs. Documentation correction; patch. |
| E1 | medium | Same verified purge/compile interleaving as B1. Group with B1 and patch the purged-state cleanup plus regression. |
| E2 | medium | Same verified missing-bucket mapping as B4. Group with B4 and patch storage error classification. |
| E3 | medium | Same verified pending-age reset as B3. Group with B3 and patch timestamp preservation. |
| V1 | low | Pre-verified: queue-policy/startup tests assert compile selection but not delivery selection; composition creates the queue directly. Add realtime delivery selection assertions to the existing queue test. Patch. |

All seven patch groups are fixed: B1/E1, B2, B3/E3, B4/E2, B5, B10 and V1. The final purged-event compile deletes both publishing tables, unresolved timestamps survive changed content, missing buckets propagate, manifest PUTs have a bounded SDK abort, realtime queue selection is asserted, and tested operator commands implement backfill/redrive/status. B7 and B9 are appended to deferred-work.md; B6 and B8 are rejected for the reasons above. No review layer was skipped. Full-story tracking remains in progress under the approved pilot boundary; this completed spec represents the pilot slice only.

## Design Notes

Local cache tests prove application behavior; deployed CDN latency remains unverified. Full 4.5 retains fallback-key paths and schedule-boundary freshness with their prerequisite features.

## Verification

Executed 2026-11-12 against isolated PostgreSQL containers, never the development database:

- `pnpm turbo run lint typecheck build --continue --concurrency=2`: 19/19 tasks pass; API lint/typecheck/build pass again after the durable upload-intent correction.
- Contracts 96, DB 75, player 65 and dashboard 381 Vitest tests pass with `--maxWorkers=2`. DB 75 includes fresh migration, tenant isolation/ownership/constraints and the restricted aggregate-function boundary (port 15436).
- Final focused delivery/adapter/alert tests: 22/22 pass on isolated port 15435 in 61.52 seconds, including all 10 delivery composition cases. Seven cached publication/edit/withdraw/archive/delete transitions each measure <60 seconds from mutation through actual pg-boss event/compile readiness, compile, upload, effective fixture invalidation and shopper read. The fixture executes the real Nest route and verifies no injected origin-pool query/connect occurs.
- Matrix coverage includes rollback, storage retry, separately persisted upload intent/acknowledgement and purge, storage-applied-then-failed crash recovery before an A->B->A recompile, reconstructed delivery instances, real pg-boss retry exhaustion/dead letter, pending-purge retry while disconnected, canonical duplicate/A->B->A repair, concurrent compile serialization, stale revision/epoch rejection, tenant-row cleanup and reinstall protection.
- Full API: 759/759 pass in 138.97 seconds on isolated port 15436 with real FFmpeg. This broad run preceded the final upload-intent crash regression/correction; the final 22-test focused suite (10 delivery cases) and API lint/typecheck/build verify that correction. Captured summaries: `test-results/manifest-delivery-api-full.log` and `test-results/manifest-delivery-final-focused.log` (local ignored verification artifacts).
- Real FFmpeg verification uses a temporary executable from the uv `imageio-ffmpeg` cache through explicit `FFMPEG_PATH`; no application `.env` settings were changed.
- `git diff --check`: clean.

Remaining gates: production provider/hosting and authenticated purge bridge configuration, deployed CDN latency/CORS/cache evidence, alert routing, merchant enrollment and live pilot approval. Manual fallback keys/key paths and schedule-boundary freshness remain outside this slice; full Story 4.5 stays in progress. No deployment or merchant enrollment performed.

### Final parent verification after review patches (2026-11-12)

- `pnpm turbo run lint typecheck build --continue --concurrency=2`: 19/19 successful (12 cached). The operator script is exercised as a real process by the backfill/redrive/status composition tests; API typecheck covers `src`.
- Full Vitest suites (`--maxWorkers=2`): API **767**, DB **75**, contracts **96**, player **65**, dashboard **381**: **1,384 passed**. API used isolated PostgreSQL port 15435 and explicit temporary `FFMPEG_PATH`; DB used isolated port 15436. Full API completed in 158.70 s and includes all 14 delivery cases after every review fix.
- Matrix audit: publish/edit/withdraw and actual queue eligibility; obsolete revisions, A->B->A and post-PUT uncertainty; upload/purge retry and exhaustion; disconnect/uninstall/purge/reinstall; missing paths and observable storage failures all ran and passed. Review regressions also cover backfill, all five phase-preserving redrives, pending age across changed hashes, final purged-event cleanup, missing-bucket distinction, PUT abort and realtime delivery selection.
- Parent logs are local ignored `test-results/manifest-delivery-parent-{api,db,contracts,player,dashboard}.log`. `git diff --check` and staged whitespace checks passed.
