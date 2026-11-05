-- Story 3.5: media assets and the upload grants that issue pre-signed URLs (owner: media). Tenant tables: non-null store_id,
-- forced RLS, cross-tenant tested. No foreign key to `stores` (owned by integration, AD-2): rows are removed by the media purge.
CREATE TABLE "media_upload_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_upload_grants_kind_check" CHECK ("kind" IN ('image', 'video')),
	CONSTRAINT "media_upload_grants_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "media_upload_grants_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "media_upload_grants_store_created_idx" ON "media_upload_grants" ("store_id", "created_at");--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"upload_key" text NOT NULL,
	"storage_key" text,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_kind_check" CHECK ("kind" IN ('image', 'video')),
	CONSTRAINT "media_assets_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "media_assets_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_assets_status_check" CHECK ("status" IN ('uploaded', 'scanned', 'processed', 'failed')),
	CONSTRAINT "media_assets_failure_reason_check" CHECK (("status" = 'failed') = ("failure_reason" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX "media_assets_store_status_idx" ON "media_assets" ("store_id", "status");--> statement-breakpoint
ALTER TABLE "media_upload_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_upload_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "media_upload_grants" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "media_upload_grants" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "media_upload_grants" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "media_assets" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "media_assets" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "media_assets" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
