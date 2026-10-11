-- Story 1.8: the first tenant tables (owner: integration).
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_store_id" text NOT NULL,
	"name" text NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"install_epoch" integer DEFAULT 1 NOT NULL,
	"synced_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_store_id_is_id" CHECK ("store_id" = "id"),
	CONSTRAINT "stores_platform_check" CHECK ("platform" IN ('salla')),
	CONSTRAINT "stores_lifecycle_check" CHECK ("lifecycle_state" IN ('active', 'disconnected', 'uninstalled', 'purged')),
	CONSTRAINT "stores_install_epoch_check" CHECK ("install_epoch" >= 1),
	CONSTRAINT "stores_platform_store_unique" UNIQUE ("platform", "platform_store_id")
);--> statement-breakpoint
CREATE TABLE "store_locator" (
	"platform" text NOT NULL,
	"platform_store_id" text NOT NULL,
	"id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	CONSTRAINT "store_locator_pkey" PRIMARY KEY ("platform", "platform_store_id"),
	CONSTRAINT "store_locator_id_unique" UNIQUE ("id")
);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "store_locator" TO "slips_app";--> statement-breakpoint
GRANT SELECT ON "store_locator" TO "slips_admin_ro";--> statement-breakpoint
CREATE TABLE "merchant_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"platform_merchant_id" text NOT NULL,
	"owner_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_accounts_store_unique" UNIQUE ("store_id")
);--> statement-breakpoint
CREATE TABLE "platform_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_tokens_store_unique" UNIQUE ("store_id")
);--> statement-breakpoint
CREATE TABLE "token_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"purpose" text NOT NULL,
	"outcome" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "token_access_log_store_idx" ON "token_access_log" ("store_id", "accessed_at");--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stores" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "stores" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "stores" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint
ALTER TABLE "merchant_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "merchant_accounts" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "merchant_accounts" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "merchant_accounts" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint
ALTER TABLE "platform_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_tokens" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "platform_tokens" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "platform_tokens" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint
ALTER TABLE "token_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "token_access_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "token_access_log" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "token_access_log" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "token_access_log" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
