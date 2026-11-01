-- Story 2.3: manual sync. A requested run waits as `queued` until the worker starts it; `requested_at` is when the
-- merchant last asked (rate limit). Additive: the new status widens the check, the new column is nullable.
ALTER TABLE "catalog_sync_state" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_sync_state" DROP CONSTRAINT "catalog_sync_state_status_check";--> statement-breakpoint
ALTER TABLE "catalog_sync_state" ADD CONSTRAINT "catalog_sync_state_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed'));
