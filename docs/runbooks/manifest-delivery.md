# Manifest delivery (4.5 controlled pilot)

Publishing compiles Home/Story/Ring output and enqueues `publishing.manifest.deliver` in the same transaction. Upload and purge are separate durable jobs. Before PUT, a separate transaction commits an uncertainty checkpoint that invalidates old completion proofs; a crash after storage accepts bytes therefore forces repair on retry or a newer compile. `manifest_deliveries` stores desired revision/epoch/hash, uploaded and acknowledged hashes, earliest pending request time, completion time and exhausted failure state under forced tenant RLS. A successful upload is committed before purge is attempted. Do not acknowledge delivery until purge succeeds.

The origin is `GET /m/v1/salla/<platform_store_id>.json`. It reads the single `m/v1/salla/<encoded platform_store_id>.json` object only, returns `Cache-Control: public, max-age=60, stale-while-revalidate=60` and `Access-Control-Allow-Origin: *`. Missing objects return 200 empty v1 JSON with the all-zero store UUID. Storage failures (including missing/misconfigured buckets and unclassified HTTP 404 responses) return observable, non-cacheable 503 responses; only explicit missing-key GET responses receive the empty fallback. Manifest S3 PUTs have a 10-second SDK abort deadline while private-media operations retain their existing options. The origin exposes no arbitrary object reads; source uploads remain private. CDN configuration must route only this origin path and public processed media, never make the media bucket public.

## Authenticated purge bridge contract

Set `CDN_PURGE_URL`, `CDN_PURGE_TOKEN` and optionally `CDN_PURGE_TIMEOUT_MS` (100-10000 ms, default 5000). URL/token are paired, production requires HTTPS and both settings. Credentials, URL queries/fragments and redirects are rejected. Requests are `POST` with `Authorization: Bearer <token>`, `Content-Type: application/json` and body `{"paths":["/m/v1/salla/<platform_store_id>.json"]}`. Any 2xx acknowledges that invalidation is effective; asynchronous acceptance without effective invalidation is insufficient. Non-2xx, redirect, network failure or timeout retries the purge phase. Response bodies and credentials never enter job errors. The deployment operator must implement this provider-neutral bridge and validate its acknowledgement semantics before launch.

## Alert investigation and recovery

- `manifest-delivery-stale`: inspect `slips_queue_oldest_age_seconds` and `slips_queue_depth` for compile and deliver queues. Check worker health and configured queue groups (both queues are realtime), object storage and bridge availability. The one-minute target includes event dispatch, compile and delivery. Retry backoff can exceed this target during an outage; investigate promptly.
- `manifest-delivery-exhausted`: inspect `slips_dead_letter_depth` and `slips_manifest_delivery_failures_total` with phase/exhausted labels. Check bridge credentials without logging them. Repair the dependency and redrive the failed pg-boss queue using the explicit redrive commands below; persisted upload checkpoints prevent redundant uploads. Never mark hashes delivered manually.
- `slips_manifest_delivery_lag_seconds` measures original pending event to successful purge; `slips_manifest_purges_total` counts acknowledged invalidations. `slips_manifest_origin_failures_total` distinguishes storage outages from missing paths. `slips_manifest_delivery_pending`, `slips_manifest_delivery_failed` and `slips_manifest_delivery_oldest_age_seconds` expose persisted work, including delayed retries; the restricted aggregate-only database function returns no tenant identity or content. Queue metrics also cover cleanup jobs after tenant rows are removed.

For tenant-level diagnosis use the approved owner/admin access path and tenant context to inspect `manifest_deliveries` and `store_manifests`. Do not query tenant tables without context or weaken RLS. Replaying obsolete jobs is safe: lifecycle locks, revision and install epoch checks reject them. Disconnected installations retain last good output; uninstall compiles empty. Publishing's purge hook atomically queues an identity-only cleanup job and deletes its tenant rows. Cleanup uploads empty and enqueues purge independently; it never recreates tenant rows. A reinstall increments the epoch, so old cleanup cannot withdraw the new installation.

## Pre-rollout backfill

Existing compiled stores have no delivery checkpoint/job until another manifest trigger occurs. Before enabling the public origin/CDN for a rollout, run the following from the repository root with the same approved database credentials and `PG_BOSS_SCHEMA` (default `pgboss`) as the worker. The operator needs the queue-owner permissions used by the worker. Apply migrations and start the realtime worker first so the compile/delivery queues and retry/dead-letter policies exist. The command uses the existing `active_store_ids` owner interface, tenant-context `enqueueManifestCompile` and normal queue handlers; it never uploads objects directly or reads tenant tables without context.

```powershell
# DATABASE_URL is inherited securely from the approved worker environment; do not print it.
# First backfill one approved store (internal UUID), then verify status and its public path.
$manifestStoreId = 'REPLACE-WITH-INTERNAL-STORE-UUID'
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts backfill $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts status $manifestStoreId
# After validating that store, enqueue every currently active store in bounded pages.
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts backfill
```

Keep realtime workers running while jobs become eligible (the existing compile debounce applies). For each rollout store, repeat `status` until the latest compile and both upload/purge jobs are `completed`, the checkpoint has `uploaded_hash = delivered_hash = content_hash`, `delivered_at` is present and `failed` is false. A completed historical compile row alone does not establish public availability. Read the origin and CDN path with the external Salla store id and verify the expected store UUID/content, cache policy and CORS headers:

```powershell
$manifestPublicUrl = 'https://REPLACE-CDN-HOST/m/v1/salla/REPLACE-PLATFORM-STORE-ID.json'
Invoke-WebRequest -Uri $manifestPublicUrl -Headers @{Origin='https://REPLACE-SHOP-HOST'}
```

Repeated backfill is safe: compilation reads current committed content and delivery deduplicates acknowledged canonical output. Disconnected/uninstalled stores are not included. Do not enable rollout for a store whose newest delivery is pending, failed or absent.

## Redrive failed compile, upload, purge and cleanup phases

Repair the dependency first, then run the matching command for the affected internal store UUID. These commands use pg-boss `previewRedrive`/`redrive` on the existing dead-letter queues, filtered by original source queue, tenant, phase and cleanup flag. They retain the original job payload, install epoch, revision, timestamp and phase; they do not substitute a new compile for a failed purge or cleanup. Each invocation moves at most 100 matching jobs present at invocation time and reports preview/moved counts. Repeat only while matching dead letters remain.

```powershell
$manifestStoreId = 'REPLACE-WITH-INTERNAL-STORE-UUID'
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts status $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts redrive compile $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts redrive upload $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts redrive purge $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts redrive cleanup-upload $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts redrive cleanup-purge $manifestStoreId
pnpm --filter @slips/api exec tsx scripts/manifest-delivery-ops.ts status $manifestStoreId
```

Run only the phase(s) actually dead-lettered. With realtime workers active, repeat `status` until redriven jobs complete and their store's matching dead-letter lists are empty. Historical failed source jobs can remain retained; inspect the newly redriven/completed jobs and checkpoint rather than requiring historical records to disappear. Normal delivery success requires matching acknowledged hashes and `failed=false`. Cleanup success requires completed cleanup-upload and cleanup-purge jobs, empty public JSON and no recreated publishing tenant rows (`delivery: []` and `manifestPresent: false` are expected after purge). An obsolete epoch/revision can complete without external writes; verify the current installation's checkpoint/public output separately. If another dependency failure occurs, the same payload/phase will retry and can dead-letter again.

After the next 30-second metrics poll, verify affected queue dead-letter depth and pending/failed/oldest-age gauges clear, the successful purge counter advances when invalidation was required, and `manifest-delivery-stale`/`manifest-delivery-exhausted` resolve in the alert backend. Global gauges may remain nonzero for other affected stores; inspect their jobs rather than altering completion hashes. Never acknowledge delivery manually or reset an unresolved timestamp.

## Evidence and launch gates

The isolated PostgreSQL and caching HTTP composition fixture exercises the real Nest public origin, transactional pg-boss jobs, phase retry/restart, publication transitions, rollback, deduplication, lifecycle and serialized writes. Executed counts and commands are recorded in the 4.5 slice spec after verification. Local fixture timings prove application behavior only.

Production hosting/provider selection, authenticated bridge deployment and credential rotation, deployed CDN path/CORS/cache configuration, measured publish/edit/withdraw latency within 60 seconds, real outage/alert routing and merchant enrollment approval remain launch gates. No deployment or merchant enrollment is authorized by this slice. Manual fallback keys/key paths and schedule-boundary freshness remain deferred; full Story 4.5 stays in progress.
