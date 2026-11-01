-- Story 2.1: the product catalog (owner: catalog). Tenant tables: non-null store_id, forced RLS, cross-tenant tested.
-- No foreign key to `stores` (owned by integration, AD-2): catalog rows are removed by the catalog purge (AD-20).
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_platform_check" CHECK ("platform" IN ('salla')),
	CONSTRAINT "categories_external_unique" UNIQUE ("store_id", "platform", "external_id")
);--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "categories" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "categories" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint

CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	-- Platform category ids; names live in `categories`.
	"category_external_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	-- Integer minor units of `currency` (spine Money convention).
	"price_minor" bigint NOT NULL,
	"sale_price_minor" bigint,
	"currency" text NOT NULL,
	"tax_inclusive" boolean NOT NULL,
	-- NULL: unlimited or not reported by the platform.
	"stock" integer,
	"availability" text NOT NULL,
	"has_required_options" boolean NOT NULL,
	"visible" boolean NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_platform_check" CHECK ("platform" IN ('salla')),
	CONSTRAINT "products_availability_check" CHECK ("availability" IN ('available', 'low', 'out_of_stock')),
	CONSTRAINT "products_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "products_price_check" CHECK ("price_minor" >= 0 AND ("sale_price_minor" IS NULL OR "sale_price_minor" >= 0)),
	CONSTRAINT "products_external_unique" UNIQUE ("store_id", "platform", "external_id")
);--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "products" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "products" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "products" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint

-- One row per store: the state of the latest catalog sync run, resumable by page.
CREATE TABLE "catalog_sync_state" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"next_page" integer DEFAULT 1 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_sync_state_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "catalog_sync_state_reason_check" CHECK ("reason" IS NULL OR "reason" IN ('platform_unavailable', 'auth_rejected', 'store_inactive', 'unknown_currency', 'invalid_data', 'internal'))
);--> statement-breakpoint
ALTER TABLE "catalog_sync_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_sync_state" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_sync_state" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "catalog_sync_state" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "catalog_sync_state" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
