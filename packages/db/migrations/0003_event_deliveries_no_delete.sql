-- The app role never prunes the ledger (pruning is a deferred maintenance job), so it holds no DELETE.
REVOKE DELETE ON "event_deliveries" FROM "slips_app";
