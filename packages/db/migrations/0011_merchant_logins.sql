-- Email/password identity (owner: session). One login per email, linked to every store that email owns, so an owner
-- with two stores has one password. Replaces the per-store merchant_credentials / credential_otps of 0010 (pre-release).
-- These are identity tables, read across stores at sign-in (before any store is chosen). Like store_locator they carry
-- no `store_id` column and no tenant RLS: the store reference is `linked_store_id`, and nothing here is tenant content.
DROP FUNCTION IF EXISTS locate_store_by_email(text);--> statement-breakpoint
DROP TABLE IF EXISTS "credential_otps";--> statement-breakpoint
DROP TABLE IF EXISTS "merchant_credentials";--> statement-breakpoint

CREATE TABLE "merchant_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	-- NULL until the owner sets a password from the setup invite.
	"password_hash" text,
	"password_set_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_logins_email_unique" UNIQUE ("email"),
	CONSTRAINT "merchant_logins_email_lower" CHECK ("email" = lower("email"))
);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "merchant_logins" TO slips_app;--> statement-breakpoint
GRANT SELECT ("id", "email", "password_set_at", "created_at", "updated_at") ON "merchant_logins" TO slips_admin_ro;--> statement-breakpoint

CREATE TABLE "merchant_login_stores" (
	"login_id" uuid NOT NULL REFERENCES "merchant_logins"("id") ON DELETE CASCADE,
	"linked_store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("login_id", "linked_store_id")
);--> statement-breakpoint
CREATE INDEX "merchant_login_stores_store_idx" ON "merchant_login_stores" ("linked_store_id");--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "merchant_login_stores" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "merchant_login_stores" TO slips_admin_ro;--> statement-breakpoint

CREATE TABLE "login_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login_id" uuid NOT NULL REFERENCES "merchant_logins"("id") ON DELETE CASCADE,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_otps_purpose_check" CHECK ("purpose" IN ('setup', 'reset'))
);--> statement-breakpoint
CREATE INDEX "login_otps_login_idx" ON "login_otps" ("login_id", "purpose", "created_at");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "login_otps" TO slips_app;
