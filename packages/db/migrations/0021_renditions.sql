-- Story 3.8: processed renditions and posters of media assets (owner: media). Tenant table: non-null store_id,
-- forced RLS, cross-tenant tested. No foreign key to `stores` (owned by integration, AD-2).
CREATE TABLE "renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renditions_profile_check" CHECK ("profile" IN ('480p', '720p', '1080p', 'poster', 'web')),
	CONSTRAINT "renditions_content_type_check" CHECK ("content_type" IN ('video/mp4', 'image/webp', 'image/jpeg')),
	CONSTRAINT "renditions_width_check" CHECK ("width" > 0),
	CONSTRAINT "renditions_height_check" CHECK ("height" > 0),
	CONSTRAINT "renditions_size_check" CHECK ("size_bytes" > 0),
	CONSTRAINT "renditions_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX "renditions_store_asset_profile_idx" ON "renditions" ("store_id", "asset_id", "profile");--> statement-breakpoint
CREATE INDEX "renditions_store_asset_idx" ON "renditions" ("store_id", "asset_id");--> statement-breakpoint
ALTER TABLE "renditions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renditions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "renditions" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "renditions" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "renditions" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);

