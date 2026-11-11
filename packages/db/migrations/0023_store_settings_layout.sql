-- Story 4.2 Ring pilot slice. `store_settings` is owned by integration (one row per store; a missing row means Ring).
-- `placements.layout` is owned by content; existing Home rows take the default. No cross-module foreign keys.
CREATE TABLE "store_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "story_layout" text DEFAULT 'ring' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "store_settings_store_unique" UNIQUE ("store_id"),
  CONSTRAINT "store_settings_story_layout_check" CHECK ("story_layout" = 'ring')
);--> statement-breakpoint
ALTER TABLE "store_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_settings" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "store_settings" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "store_settings" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "layout" text DEFAULT 'ring' NOT NULL;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_layout_check" CHECK ("layout" = 'ring');
