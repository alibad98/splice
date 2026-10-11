-- Story 1.8 security review: store_locator is write-once and readable only through locate_store().
REVOKE SELECT, UPDATE ON "store_locator" FROM "slips_app";--> statement-breakpoint
CREATE FUNCTION "store_locator_write_once"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- ON DELETE CASCADE from stores (purge, Story 1.10) runs nested inside the RI trigger and is allowed.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'store_locator is write-once' USING ERRCODE = '42501';
END $$;--> statement-breakpoint
CREATE TRIGGER "store_locator_write_once" BEFORE UPDATE OR DELETE ON "store_locator" FOR EACH ROW EXECUTE FUNCTION "store_locator_write_once"();--> statement-breakpoint
CREATE FUNCTION "locate_store"(p_platform text, p_platform_store_id text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT "id" FROM public."store_locator" WHERE "platform" = p_platform AND "platform_store_id" = p_platform_store_id $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "locate_store"(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "locate_store"(text, text) TO "slips_app";
