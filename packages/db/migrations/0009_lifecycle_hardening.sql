-- Story 1.10 security review: least privilege on the non-RLS cross-tenant tables, and a replay ledger that survives a purge.
REVOKE ALL ON "store_purge_schedule" FROM "slips_app";--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "store_purge_schedule" TO "slips_app";--> statement-breakpoint
-- webhook_inbox: the token pair (secret_enc) is write-only for the app role; it is read through inbox_secret() only.
REVOKE ALL ON "webhook_inbox" FROM "slips_app";--> statement-breakpoint
GRANT INSERT, DELETE ON "webhook_inbox" TO "slips_app";--> statement-breakpoint
GRANT SELECT ("id", "platform", "event_id", "type", "platform_store_id", "body_hash", "payload", "secret_key_id", "occurred_at", "status", "attempts", "next_attempt_at", "parked_since", "last_error", "received_at", "processed_at") ON "webhook_inbox" TO "slips_app";--> statement-breakpoint
GRANT UPDATE ("status", "attempts", "next_attempt_at", "parked_since", "last_error", "processed_at", "secret_enc", "secret_key_id") ON "webhook_inbox" TO "slips_app";--> statement-breakpoint
CREATE FUNCTION "inbox_secret"(p_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT "secret_enc" FROM public."webhook_inbox" WHERE "id" = p_id AND "status" = 'pending' $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "inbox_secret"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "inbox_secret"(uuid) TO "slips_app";--> statement-breakpoint
-- Ids (body hashes) of lifecycle events already applied. Keyed by the platform locator, no store_id, so it outlives a purge
-- and an old signed uninstall/authorize replayed later is recognised. Pruning (90 days) is deferred.
CREATE TABLE "lifecycle_event_ledger" (
	"platform" text NOT NULL,
	"event_id" text NOT NULL,
	"platform_store_id" text NOT NULL,
	"kind" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_event_ledger_pkey" PRIMARY KEY ("platform", "event_id")
);--> statement-breakpoint
GRANT SELECT, INSERT ON "lifecycle_event_ledger" TO "slips_app";--> statement-breakpoint
GRANT SELECT ON "lifecycle_event_ledger" TO "slips_admin_ro";
