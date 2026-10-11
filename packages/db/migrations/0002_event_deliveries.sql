-- Idempotency ledger for domain event handlers (AD-17): one row per (event, handler) that has run.
-- Infrastructure table, not tenant data: no store_id, no RLS. Written in the same transaction as the handler's effect.
CREATE TABLE "event_deliveries" (
	"event_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"delivered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_deliveries_pkey" PRIMARY KEY ("event_id", "handler")
);--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "event_deliveries" TO "slips_app";--> statement-breakpoint
GRANT SELECT ON "event_deliveries" TO "slips_admin_ro";
