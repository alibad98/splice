-- Story 3.4: product links of content items (owner: content). Tenant table: non-null store_id, forced RLS, cross-tenant tested.
-- One product per content item (unique store + content). No foreign key to `products` (owned by catalog, AD-2): a deleted
-- product keeps its link so the item can be flagged. Unlinking sets `product_id` to null; rows are only removed by the purge.
-- `slide_id` is reserved for later per-slide links.
CREATE TABLE "content_product_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"product_id" uuid,
	"slide_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "content_product_links_store_content_idx" ON "content_product_links" ("store_id", "content_id");--> statement-breakpoint
CREATE INDEX "content_product_links_store_product_idx" ON "content_product_links" ("store_id", "product_id") WHERE "product_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "content_product_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_product_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_product_links" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "content_product_links" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "content_product_links" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
