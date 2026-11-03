# Alert: catalog reconcile job dead-lettered

- **Alert id:** `catalog-reconcile-dead-lettered` (see `ops/alert-rules.json`)
- **Owner:** catalog-owner
- **Severity:** ticket (the storefront keeps serving the last catalog; nothing is lost, the daily repair is late)
- **Fires when:** a queue matching `catalog.reconcile*` has jobs in its dead-letter queue (`<queue>.dead_letter`), meaning a job failed all its attempts (5 attempts, 30 s to 15 min backoff):
  - `catalog.reconcile`: one store's daily reconcile failed.
  - `catalog.reconcile.schedule`: the daily fan-out failed, so **no store** was queued for reconcile that day.

## What reconcile does

Once per UTC day (cron `0 0 * * *`), `catalog.reconcile.schedule` queues one `catalog.reconcile` job per `active` store (singleton key `<store_id>:<yyyy-mm-dd>`, started at a fixed per-store offset of up to an hour after 00:00 UTC, up to 4 h per attempt). The job lists every Salla product page, creates/updates/revives products through the guarded write path, confirms each local product missing from the listing with a single-product fetch, and tombstones only those Salla answers "not found" for. A failed attempt restarts from page 1; writes are idempotent.

## First checks

1. In the worker logs, find `error captured` lines with `queue: catalog.reconcile` (or `catalog.reconcile.schedule`). Each carries `job_id`, `trace_id` and, for a store job, `store_id`. A store job's last attempt also logs `catalog reconcile failed after its last attempt`.
2. Read the error. Common causes:
   - `PlatformUnavailableError`: Salla outage, rate limiting or a response the adapter does not recognise. Check `slips_salla_api_failures_total` and Salla status. If many stores dead-lettered at once, it was an outage.
   - Job expired: the store's catalog took longer than an attempt may run. Check the store's product count and the attempt durations in `job completed`/`error captured` lines.
   - A database error (fan-out or store job): check database health and the worker's connection pool.
   - A bug in the job: look for the same error across stores.
3. A disconnected or uninstalled store never dead-letters (the job logs `catalog reconcile skipped` with reason `disconnected` and ends).

## Recovery

1. Fix the cause.
2. Doing nothing is safe: the next daily run (00:00 UTC plus the store's offset) reconciles every active store again from page 1.
3. To repair one store sooner, send a new job from a shell with database access (pg-boss on the worker's `DATABASE_URL`), with a fresh trace id:

   ```js
   await boss.send('catalog.reconcile', { v: 1, trace_id: crypto.randomBytes(16).toString('hex'), store_id: '<store uuid>' });
   ```

   Leave out `singletonKey`, so the store's daily job for today does not block it. Writes are guarded on `source_updated_at` and deletions are confirmed per product, so an extra run is safe. If the fan-out itself dead-lettered, send `catalog.reconcile.schedule` with `{ v: 1, trace_id: 'manual' }` instead: it queues every active store that has not already had a job today.
4. Clear the dead-letter queue so the alert resolves: once the cause is fixed and the stores are repaired, delete its jobs, for example `await boss.deleteAllJobs('catalog.reconcile.dead_letter')` (or `catalog.reconcile.schedule.dead_letter`). The alert clears when the dead-letter depth is back to 0, at the next queue-stats poll (30 s).

No tokens, secrets or shopper data are in the job payload or the logs.
