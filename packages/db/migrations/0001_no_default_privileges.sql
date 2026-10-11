-- Remove default grants an earlier draft of 0000 made; grants are per table now.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM slips_app, slips_admin_ro;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM slips_app, slips_admin_ro;
