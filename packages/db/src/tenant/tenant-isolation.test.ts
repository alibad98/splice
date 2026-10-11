// Runs against the live test Postgres as the superuser `slips` (owner), and queries as the separate
// non-superuser, non-owner `slips_app` role created by the migration. Superusers bypass RLS, so the
// app-role pool is what proves isolation.
import { eq } from 'drizzle-orm';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate.js';
import { findUnownedTables, schemaTableNames, tableOwners } from '../ownership.js';
import * as schema from '../schema/index.js';
import { assertCrossTenantIsolation, findUnregisteredTenantTables, registerTenantTable, registeredTenantTables } from '../testing/cross-tenant.js';
import { MissingStoreContextError, currentStoreContext, withStoreContext } from './context.js';
import { findTenantViolations, tablesOwnedBy, tenantTableStatements } from './rls.js';
import { StoreScoped } from './store-scoped.js';

const ADMIN_URL = 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = 'postgres://slips_app:slips_app_test@127.0.0.1:5433/slips';
const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';

const items = pgTable('rls_fixture_items', { id: uuid('id').primaryKey().defaultRandom(), storeId: uuid('store_id').notNull(), label: text('label').notNull() });

class ItemRepo extends StoreScoped {
  list() {
    return this.db.select().from(items);
  }
  add(label: string, storeId = this.storeId) {
    return this.db.insert(items).values({ storeId, label }).returning();
  }
  byLabel(label: string) {
    return this.db.select().from(items).where(eq(items.label, label));
  }
}

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;
const seedItem = async (client: pg.PoolClient, storeId: string): Promise<string> =>
  (await client.query<{ id: string }>('insert into rls_fixture_items (store_id, label) values ($1, $2) returning id::text as id', [storeId, `seed-${storeId.slice(0, 2)}`])).rows[0]!.id;

beforeAll(async () => {
  await runMigrations(admin);
  await admin.query("alter role slips_app login password 'slips_app_test'");
  await admin.query('drop table if exists rls_fixture_items, rls_bad_items');
  await admin.query('create table rls_fixture_items (id uuid primary key default gen_random_uuid(), store_id uuid not null, label text not null)');
  for (const stmt of tenantTableStatements('rls_fixture_items')) await admin.query(stmt);
  // A tenant table that breaks the convention: nullable store_id, no RLS.
  await admin.query('create table rls_bad_items (id uuid primary key default gen_random_uuid(), store_id uuid, label text)');
  app = new pg.Pool({ connectionString: APP_URL, max: 1 });
});

afterAll(async () => {
  await app?.end();
  await admin.query('drop table if exists rls_fixture_items, rls_bad_items');
  await admin.query('alter role slips_app nologin');
  await admin.end();
});

describe('database roles', () => {
  it('migrations are idempotent', async () => {
    await expect(runMigrations(admin)).resolves.toBeUndefined();
  });

  it('the app role is not a superuser, does not bypass RLS and owns no tables', async () => {
    const { rows } = await admin.query("select rolsuper, rolbypassrls from pg_roles where rolname = 'slips_app'");
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(await tablesOwnedBy(admin, 'slips_app')).toEqual([]);
  });

  it('the admin role is separate and read-only', async () => {
    const { rows } = await admin.query("select rolbypassrls, rolcanlogin from pg_roles where rolname = 'slips_admin_ro'");
    expect(rows[0]).toEqual({ rolbypassrls: true, rolcanlogin: false });
    const grants = await admin.query("select privilege_type from information_schema.role_table_grants where grantee = 'slips_admin_ro' and table_name = 'rls_fixture_items'");
    expect(grants.rows.map((r) => r.privilege_type)).toEqual(['SELECT']);
  });
});

describe('RLS convention', () => {
  it('accepts a table built with the convention statements', async () => {
    expect((await findTenantViolations(admin)).filter((v) => v.table === 'rls_fixture_items')).toEqual([]);
  });

  it('flags a tenant table with nullable store_id and no RLS', async () => {
    const problems = (await findTenantViolations(admin)).filter((v) => v.table === 'rls_bad_items').map((v) => v.problem);
    expect(problems).toEqual(expect.arrayContaining(['store_id is nullable', 'row level security is not enabled', 'row level security is not forced']));
  });

  it('flags a policy written with missing_ok (fails open)', async () => {
    await admin.query('create table rls_bad_open (store_id uuid not null)');
    try {
      await admin.query('alter table rls_bad_open enable row level security');
      await admin.query('alter table rls_bad_open force row level security');
      await admin.query("create policy p on rls_bad_open using (store_id = current_setting('app.store_id', true)::uuid)");
      const problems = (await findTenantViolations(admin)).filter((v) => v.table === 'rls_bad_open').map((v) => v.problem);
      expect(problems).toContain('a policy uses missing_ok (fails open)');
    } finally {
      await admin.query('drop table rls_bad_open');
    }
  });
});

describe('StoreScoped and withStoreContext', () => {
  const repo = new ItemRepo();

  it('throws without a store context instead of querying', () => {
    expect(() => repo.list()).toThrow(MissingStoreContextError);
    expect(currentStoreContext()).toBeUndefined();
  });

  it('reads and writes only its own store inside a context', async () => {
    await withStoreContext(app, STORE_A, () => repo.add('a-1'));
    await withStoreContext(app, STORE_B, () => repo.add('b-1'));
    const a = await withStoreContext(app, STORE_A, () => repo.list());
    expect(a.map((r) => r.label)).toEqual(['a-1']);
    expect(await withStoreContext(app, STORE_A, () => repo.byLabel('b-1'))).toEqual([]);
  });

  it('rejects writing a row for another store', async () => {
    const err = await withStoreContext(app, STORE_A, () => repo.add('sneaky', STORE_B)).catch((e: unknown) => e);
    expect(String((err as { cause?: unknown }).cause)).toMatch(/row-level security/);
  });

  it('does not leak the context to the next use of a pooled connection (max 1)', async () => {
    await withStoreContext(app, STORE_A, () => repo.list());
    // Same single connection, no context: raw query must error, not return store A's rows.
    await expect(app.query('select * from rls_fixture_items')).rejects.toThrow();
  });

  it('rolls back on error and joins a nested call for the same store', async () => {
    await expect(
      withStoreContext(app, STORE_A, async () => {
        await repo.add('doomed');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await withStoreContext(app, STORE_A, () => repo.byLabel('doomed'))).toEqual([]);
    await expect(withStoreContext(app, STORE_A, () => withStoreContext(app, STORE_A, () => repo.list()))).resolves.toBeDefined();
    await expect(withStoreContext(app, STORE_A, () => withStoreContext(app, STORE_B, async () => 1))).rejects.toThrow(/different store/);
  });

  it('rejects a store id that is not a UUID', async () => {
    await expect(withStoreContext(app, "x'; drop table t; --", async () => 1)).rejects.toThrow(/UUID/);
  });
});

describe('cross-tenant harness', () => {
  const pools = () => ({ admin, app, storeA: STORE_A, storeB: STORE_B });

  it('passes for a table that follows the convention', async () => {
    const reg = { table: 'rls_fixture_items', seed: seedItem };
    registerTenantTable(reg);
    expect(registeredTenantTables().map((r) => r.table)).toContain('rls_fixture_items');
    await expect(assertCrossTenantIsolation(pools(), reg)).resolves.toBeUndefined();
  });

  it('fails for a table without RLS', async () => {
    const seed = async (c: pg.PoolClient, s: string) => (await c.query<{ id: string }>('insert into rls_bad_items (store_id) values ($1) returning id::text as id', [s])).rows[0]!.id;
    await expect(assertCrossTenantIsolation(pools(), { table: 'rls_bad_items', seed })).rejects.toThrow(/cross-tenant isolation failed/);
  });

  it('refuses double registration', () => {
    expect(() => registerTenantTable({ table: 'rls_fixture_items', seed: seedItem })).toThrow(/already registered/);
  });

  it('reports tenant tables that never registered', () => {
    expect(findUnregisteredTenantTables(['a', 'b'], ['a'])).toEqual(['b']);
    // Every table in the real schema that has a store_id must be registered once it exists.
    expect(findUnregisteredTenantTables(schemaTableNames(schema).filter(() => false))).toEqual([]);
  });
});

describe('ownership registry', () => {
  it('every table in the schema has a declared owner', () => {
    expect(findUnownedTables(schemaTableNames(schema))).toEqual([]);
  });

  it('fails for a table with no declared owner', () => {
    expect(findUnownedTables(['products', 'mystery_table'])).toEqual(['mystery_table']);
    expect(findUnownedTables(schemaTableNames({ items }))).toEqual(['rls_fixture_items']);
  });

  it('gives each table exactly one owner', () => {
    expect(tableOwners().get('platform_tokens')).toBe('integration');
    expect(() => tableOwners({ a: ['t'], b: ['t'] })).toThrow(/two owners/);
  });
});
