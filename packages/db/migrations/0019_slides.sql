-- Story 3.6: slides of content items (owner: content). Tenant table: non-null store_id, forced RLS, cross-tenant tested.
-- Each slide references a `media_assets` row (owned by media, AD-2: no foreign key). `kind` is copied from the asset.
-- A removed slide is soft-deleted (`deleted_at`); re-adding the same asset revives it, so one live slide per asset per
-- item. Rows are only hard-deleted by the store purge.
CREATE TABLE "slides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" integer NOT NULL,
	"alt_text" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slides_kind_check" CHECK ("kind" IN ('image', 'video')),
	CONSTRAINT "slides_position_check" CHECK ("position" >= 0),
	CONSTRAINT "slides_alt_text_check" CHECK ("alt_text" IS NULL OR char_length("alt_text") <= 250)
);--> statement-breakpoint
CREATE INDEX "slides_store_content_position_idx" ON "slides" ("store_id", "content_id", "position");--> statement-breakpoint
CREATE UNIQUE INDEX "slides_store_content_asset_live_idx" ON "slides" ("store_id", "content_id", "media_asset_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "slides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "slides" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "slides" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "slides" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
