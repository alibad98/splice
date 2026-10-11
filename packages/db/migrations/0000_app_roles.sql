-- Tenancy roles (AD-3). The app role owns no tables and never bypasses RLS; the admin role is read-only
-- and bypasses RLS (every admin read is audited by the admin module, Epic 7).
-- Login and passwords are granted by deployment, not here. Creating BYPASSRLS needs a privileged migration role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slips_app') THEN
    CREATE ROLE slips_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slips_admin_ro') THEN
    CREATE ROLE slips_admin_ro NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO slips_app, slips_admin_ro;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO slips_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO slips_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO slips_admin_ro;
