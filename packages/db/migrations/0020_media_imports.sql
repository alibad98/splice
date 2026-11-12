-- Story 3.7: import media from an external link. An imported asset records its `source_url` and starts `importing`; the
-- worker fetches it and fills in the hash, size, type and upload key. Those are null only while `importing`, or when an
-- import failed before its file was stored.
ALTER TABLE "media_assets" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_url_check" CHECK ("source_url" IS NULL OR char_length("source_url") BETWEEN 1 AND 2048);--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ALTER COLUMN "upload_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_status_check";--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_status_check" CHECK ("status" IN ('importing', 'uploaded', 'scanned', 'processed', 'failed'));--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_importing_check" CHECK (
	("content_type" IS NOT NULL AND "size_bytes" IS NOT NULL AND "sha256" IS NOT NULL AND "upload_key" IS NOT NULL)
	OR ("status" = 'importing' AND "source_url" IS NOT NULL)
	OR ("status" = 'failed' AND "source_url" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_importing_source_check" CHECK ("status" <> 'importing' OR "source_url" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "media_assets_store_imported_created_idx" ON "media_assets" ("store_id", "created_at") WHERE "source_url" IS NOT NULL;
