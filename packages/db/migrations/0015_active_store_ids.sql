-- Story 2.6: the daily catalog reconcile fan-out needs the ids of every active store. `stores` is under RLS, so the
-- list is read only through this function (same pattern as locate_store, 0005); it returns ids and nothing else.
CREATE FUNCTION "active_store_ids"(p_after uuid, p_limit int) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ SELECT "id" FROM public."stores" WHERE "lifecycle_state" = 'active' AND "id" > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid) ORDER BY "id" LIMIT p_limit $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "active_store_ids"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "active_store_ids"(uuid, int) TO "slips_app";
