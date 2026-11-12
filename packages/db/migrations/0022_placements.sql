-- Controlled Home pilot. Owner: content. No cross-module foreign keys.
CREATE TABLE "placements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "content_id" uuid NOT NULL,
  "type" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "placements_type_check" CHECK ("type" = 'home')
);--> statement-breakpoint
CREATE UNIQUE INDEX "placements_store_content_type_idx" ON "placements" ("store_id", "content_id", "type");--> statement-breakpoint
ALTER TABLE "placements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "placements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "placements" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "placements" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "placements" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
