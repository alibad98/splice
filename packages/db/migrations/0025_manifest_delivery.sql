-- Publishing-owned delivery checkpoints; no cross-module foreign keys.
CREATE TABLE manifest_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL UNIQUE,
 install_epoch integer NOT NULL CHECK (install_epoch > 0),
 platform_store_id text NOT NULL,
 revision bigint NOT NULL CHECK (revision > 0),
 content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
 uploaded_hash text CHECK (uploaded_hash ~ '^[a-f0-9]{64}$'),
 delivered_hash text CHECK (delivered_hash ~ '^[a-f0-9]{64}$'),
 requested_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz,
 failed boolean NOT NULL DEFAULT false
);--> statement-breakpoint
ALTER TABLE manifest_deliveries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE manifest_deliveries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON manifest_deliveries TO slips_app;--> statement-breakpoint
GRANT SELECT ON manifest_deliveries TO slips_admin_ro;--> statement-breakpoint
CREATE POLICY tenant_isolation ON manifest_deliveries USING (store_id = current_setting('app.store_id')::uuid) WITH CHECK (store_id = current_setting('app.store_id')::uuid);
--> statement-breakpoint
-- Operational totals only: no identity, manifest or per-tenant state crosses this read boundary.
CREATE FUNCTION manifest_delivery_stats() RETURNS TABLE(pending bigint, failed bigint, oldest_seconds double precision)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
 AS $$ SELECT count(*) FILTER (WHERE delivered_hash IS DISTINCT FROM content_hash),
 count(*) FILTER (WHERE failed),
 coalesce(max(extract(epoch from (now()-requested_at))) FILTER (WHERE delivered_hash IS DISTINCT FROM content_hash),0)::double precision
 FROM public.manifest_deliveries $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION manifest_delivery_stats() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION manifest_delivery_stats() TO slips_app;
