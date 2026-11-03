-- Story 2.5: products deleted in Salla are soft-deleted. `deleted_at` is the tombstone (null = live); the row is never
-- removed. Additive and nullable; RLS and grants are table-level (0012).
ALTER TABLE "products" ADD COLUMN "deleted_at" timestamp with time zone;
