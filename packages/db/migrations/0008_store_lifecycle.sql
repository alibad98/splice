-- Story 1.10: store lifecycle (uninstall grace, purge), the webhook inbox and the lifecycle audit trail (owner: integration).
ALTER TABLE "stores"
	ADD COLUMN "uninstalled_at" timestamp with time zone,
	ADD COLUMN "grace_ends_at" timestamp with time zone,
	ADD COLUMN "purged_at" timestamp with time zone,
	ADD COLUMN "epoch_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Webhooks arrive before a store is known, so the inbox is not a tenant table (no store_id, no RLS). It holds only the
-- canonical PII-free payload, never a raw body; a token pair from an authorize event is envelope-encrypted in secret_enc
-- and nulled once processed.
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"platform_store_id" text NOT NULL,
	"body_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"secret_enc" text,
	"secret_key_id" text,
	"occurred_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parked_since" timestamp with time zone,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_inbox_platform_check" CHECK ("platform" IN ('salla')),
	CONSTRAINT "webhook_inbox_status_check" CHECK ("status" IN ('pending', 'processed', 'ignored', 'dead_lettered')),
	CONSTRAINT "webhook_inbox_event_unique" UNIQUE ("platform", "event_id")
);--> statement-breakpoint
CREATE INDEX "webhook_inbox_due_idx" ON "webhook_inbox" ("status", "next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_inbox_store_idx" ON "webhook_inbox" ("platform", "platform_store_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_inbox" TO "slips_app";--> statement-breakpoint
GRANT SELECT ON "webhook_inbox" TO "slips_admin_ro";--> statement-breakpoint
CREATE TABLE "store_data_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"kind" text NOT NULL,
	"install_epoch" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"completed_modules" text[] DEFAULT '{}'::text[] NOT NULL,
	"batches" integer DEFAULT 0 NOT NULL,
	"abort_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "store_data_jobs_kind_check" CHECK ("kind" IN ('purge')),
	CONSTRAINT "store_data_jobs_status_check" CHECK ("status" IN ('running', 'completed', 'aborted')),
	CONSTRAINT "store_data_jobs_unique" UNIQUE ("store_id", "kind", "install_epoch")
);--> statement-breakpoint
ALTER TABLE "store_data_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_data_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_data_jobs" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "store_data_jobs" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "store_data_jobs" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint
-- Append-only record of lifecycle actions. Keyed by the platform locator (no store_id) so it outlives a purge; holds no PII.
CREATE TABLE "lifecycle_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_store_id" text NOT NULL,
	"action" text NOT NULL,
	"install_epoch" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "lifecycle_audit_store_idx" ON "lifecycle_audit" ("platform", "platform_store_id", "at");--> statement-breakpoint
GRANT SELECT, INSERT ON "lifecycle_audit" TO "slips_app";--> statement-breakpoint
GRANT SELECT ON "lifecycle_audit" TO "slips_admin_ro";
--> statement-breakpoint
-- Which uninstalled stores are due for purge. Not a tenant table (no store_id): the sweep must find due stores across
-- tenants before any store context exists. It exposes only the store id, epoch and due time.
CREATE TABLE "store_purge_schedule" (
	"id" uuid PRIMARY KEY NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"install_epoch" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX "store_purge_schedule_due_idx" ON "store_purge_schedule" ("due_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_purge_schedule" TO "slips_app";--> statement-breakpoint
GRANT SELECT ON "store_purge_schedule" TO "slips_admin_ro";
