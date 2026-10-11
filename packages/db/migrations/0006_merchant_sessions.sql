-- Story 1.9: merchant sessions (owner: session). Embedded bearers and direct-link cookie sessions are both rows here.
CREATE TABLE "merchant_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE,
	"mode" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "merchant_sessions_mode_check" CHECK ("mode" IN ('embedded', 'direct'))
);--> statement-breakpoint
CREATE INDEX "merchant_sessions_store_idx" ON "merchant_sessions" ("store_id", "expires_at");--> statement-breakpoint
ALTER TABLE "merchant_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "merchant_sessions" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "merchant_sessions" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "merchant_sessions" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
