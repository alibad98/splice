-- Story 4.4 pilot slice. `store_manifests` is owned by publishing: one compiled manifest per store, derived data.
-- `revision` is monotonic (each compile locks the row and writes revision + 1). No cross-module foreign keys.
CREATE TABLE "store_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "store_id" uuid NOT NULL,
  "revision" bigint DEFAULT 0 NOT NULL,
  "manifest" jsonb,
  "size_gzip_bytes" integer,
  "compiled_at" timestamp with time zone,
  CONSTRAINT "store_manifests_store_unique" UNIQUE ("store_id"),
  CONSTRAINT "store_manifests_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "store_manifests_size_check" CHECK ("size_gzip_bytes" IS NULL OR "size_gzip_bytes" >= 0),
  CONSTRAINT "store_manifests_compiled_check" CHECK (("revision" = 0) = ("manifest" IS NULL) AND ("manifest" IS NULL) = ("compiled_at" IS NULL) AND ("manifest" IS NULL) = ("size_gzip_bytes" IS NULL))
);--> statement-breakpoint
ALTER TABLE "store_manifests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_manifests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_manifests" TO slips_app;--> statement-breakpoint
GRANT SELECT ON "store_manifests" TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "store_manifests" USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
