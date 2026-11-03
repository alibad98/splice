-- Story 3.1: content items and their status lifecycle (owner: content). Tenant table: non-null store_id, forced RLS, cross-tenant tested.
-- No foreign key to `stores` (owned by integration, AD-2): content rows are removed by the content purge (AD-20).
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"format" text NOT NULL,
	"cta_label" text NOT NULL,
	"cta_action" text NOT NULL,
	"cta_url" text,
	"cta_style" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"archived_from" text,
	"reactivate_to" text,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"first_published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_title_check" CHECK (char_length("title") BETWEEN 1 AND 80),
	CONSTRAINT "content_items_format_check" CHECK ("format" IN ('story', 'reel')),
	CONSTRAINT "content_items_cta_label_check" CHECK (char_length("cta_label") BETWEEN 1 AND 40),
	CONSTRAINT "content_items_cta_action_check" CHECK ("cta_action" IN ('add_to_cart', 'open_product', 'open_link')),
	CONSTRAINT "content_items_cta_url_check" CHECK (("cta_action" = 'open_link' AND "cta_url" IS NOT NULL AND char_length("cta_url") > 0) OR ("cta_action" <> 'open_link' AND "cta_url" IS NULL)),
	CONSTRAINT "content_items_status_check" CHECK ("status" IN ('draft', 'processing', 'failed', 'scheduled', 'published', 'ended', 'archived', 'deactivated')),
	CONSTRAINT "content_items_archived_from_check" CHECK ("archived_from" IS NULL OR "archived_from" IN ('draft', 'failed', 'scheduled', 'published', 'ended', 'deactivated')),
	CONSTRAINT "content_items_reactivate_to_check" CHECK ("reactivate_to" IS NULL OR "reactivate_to" IN ('published', 'scheduled'))
);--> statement-breakpoint
CREATE INDEX "content_items_store_status_idx" ON "content_items" ("store_id", "status") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_items" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "content_items" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "content_items" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
