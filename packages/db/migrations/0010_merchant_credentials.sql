-- Merchant credentials and OTPs for email/password authentication (owner: session/auth).
CREATE TABLE "merchant_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"password_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_credentials_email_unique" UNIQUE ("email")
);--> statement-breakpoint
CREATE INDEX "merchant_credentials_store_idx" ON "merchant_credentials" ("store_id");--> statement-breakpoint
ALTER TABLE "merchant_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "merchant_credentials" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "merchant_credentials" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "merchant_credentials" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint

CREATE TABLE "credential_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"email" text NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_otps_purpose_check" CHECK ("purpose" IN ('setup', 'reset'))
);--> statement-breakpoint
CREATE INDEX "credential_otps_store_idx" ON "credential_otps" ("store_id", "expires_at");--> statement-breakpoint
ALTER TABLE "credential_otps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credential_otps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "credential_otps" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "credential_otps" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "credential_otps" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint

-- Fast email to store lookup for direct login (SECURITY DEFINER, executes with table owner privileges, bypasses RLS)
CREATE OR REPLACE FUNCTION locate_store_by_email(email_input text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT store_id FROM public.merchant_credentials WHERE lower(email) = lower(email_input) LIMIT 1;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION locate_store_by_email(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION locate_store_by_email(text) TO slips_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION locate_store_by_email(text) TO slips_admin_ro;
