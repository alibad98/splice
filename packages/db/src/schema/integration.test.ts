// Live-Postgres tests for the integration tables: RLS convention, ownership, cross-tenant isolation.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate.js';
import { findUnownedTables, schemaTableNames, tableOwners } from '../ownership.js';
import { findTenantViolations, tablesOwnedBy } from '../tenant/rls.js';
import { ensureTestAppRole } from '../testing/app-role.js';
import { assertCrossTenantIsolation, findUnregisteredTenantTables, registerTenantTable, registeredTenantTables } from '../testing/cross-tenant.js';
import * as schema from './index.js';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = process.env.TEST_APP_URL ?? 'postgres://slips_it_integration:it_integration_pw@127.0.0.1:5433/slips';
const TENANT_TABLES = ['stores', 'merchant_accounts', 'platform_tokens', 'token_access_log', 'merchant_sessions', 'store_data_jobs'];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;

const seedStore = async (c: pg.PoolClient, storeId: string): Promise<string> => {
  await c.query(
    `insert into stores (id, store_id, platform, platform_store_id, name) values ($1, $1, 'salla', $2, 'Seed') on conflict (id) do update set name = excluded.name`,
    [storeId, `seed-${storeId}`],
  );
  await c.query(`insert into store_locator (platform, platform_store_id, id) values ('salla', $2, $1) on conflict do nothing`, [storeId, `seed-${storeId}`]);
  return storeId;
};
const seedStoreOnly = async (c: pg.PoolClient, storeId: string): Promise<string> => {
  // Admin seeding creates the store first; in an app context the stores row already exists for A.
  await seedStore(c, storeId);
  return storeId;
};

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_integration', 'it_integration_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 1 });
});
afterAll(async () => {
  await app?.end();
  await admin.end();
});

describe('integration tables', () => {
  it('follow the tenant convention and the app role owns none', async () => {
    const violations = (await findTenantViolations(admin)).filter((v) => TENANT_TABLES.includes(v.table));
    expect(violations).toEqual([]);
    expect(await tablesOwnedBy(admin, 'slips_app')).toEqual([]);
  });

  it('are owned by integration and the schema has no unowned table', () => {
    for (const t of [...TENANT_TABLES.filter((x) => x !== 'merchant_sessions'), 'store_locator', 'webhook_inbox', 'lifecycle_audit', 'store_purge_schedule', 'lifecycle_event_ledger']) expect(tableOwners().get(t)).toBe('integration');
    expect(tableOwners().get('merchant_sessions')).toBe('session');
    expect(findUnownedTables(schemaTableNames(schema))).toEqual([]);
  });

  it('every tenant table in the schema registers with the cross-tenant harness', () => {
    const regs = [
      { table: 'stores', seed: seedStoreOnly },
      {
        table: 'merchant_accounts',
        seed: async (c: pg.PoolClient, s: string) => {
          await seedStore(c, s);
          return (await c.query<{ id: string }>(`insert into merchant_accounts (store_id, platform_merchant_id) values ($1, 'm-1') on conflict (store_id) do update set owner_name = 'x' returning id::text as id`, [s])).rows[0]!.id;
        },
      },
      {
        table: 'platform_tokens',
        seed: async (c: pg.PoolClient, s: string) => {
          await seedStore(c, s);
          return (await c.query<{ id: string }>(`insert into platform_tokens (store_id, access_token_enc, refresh_token_enc, access_expires_at, key_id) values ($1, 'enc', 'enc', now(), 'k1') on conflict (store_id) do update set key_id = 'k1' returning id::text as id`, [s])).rows[0]!.id;
        },
      },
      {
        table: 'token_access_log',
        seed: async (c: pg.PoolClient, s: string) => {
          await seedStore(c, s);
          return (await c.query<{ id: string }>(`insert into token_access_log (store_id, purpose, outcome) values ($1, 'use', 'ok') returning id::text as id`, [s])).rows[0]!.id;
        },
      },
      {
        table: 'merchant_sessions',
        seed: async (c: pg.PoolClient, s: string) => {
          await seedStore(c, s);
          return (await c.query<{ id: string }>(`insert into merchant_sessions (id, store_id, mode, secret_hash, expires_at) values ($2, $1, 'direct', 'h', now() + interval '1 day') returning id::text as id`, [s, randomUUID()])).rows[0]!.id;
        },
      },
      {
        table: 'store_data_jobs',
        seed: async (c: pg.PoolClient, s: string) => {
          await seedStore(c, s);
          return (await c.query<{ id: string }>(`insert into store_data_jobs (id, store_id, kind, install_epoch) values ($2, $1, 'purge', 1) on conflict (store_id, kind, install_epoch) do update set batches = 0 returning id::text as id`, [s, randomUUID()])).rows[0]!.id;
        },
      },
    ];
    for (const r of regs) registerTenantTable(r);
    expect(findUnregisteredTenantTables(TENANT_TABLES)).toEqual([]);
    expect(registeredTenantTables().length).toBe(6);
  });

  it.each(TENANT_TABLES)('%s: store A can not read, change or write store B rows', async (table) => {
    const reg = registeredTenantTables().find((r) => r.table === table);
    expect(reg).toBeDefined();
    await assertCrossTenantIsolation({ admin, app, storeA: randomUUID(), storeB: randomUUID() }, reg!);
  });

  it('rejects an unknown lifecycle state and a store_id that is not the id', async () => {
    const id = randomUUID();
    await expect(admin.query(`insert into stores (id, store_id, platform, platform_store_id, name, lifecycle_state) values ($1, $1, 'salla', $2, 'x', 'weird')`, [id, `bad-${id}`])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`insert into stores (id, store_id, platform, platform_store_id, name) values ($1, $2, 'salla', $3, 'x')`, [id, randomUUID(), `bad2-${id}`])).rejects.toMatchObject({ code: '23514' });
  });

  it('(platform, platform_store_id) is unique and there is one merchant account and one token row per store', async () => {
    const id = randomUUID();
    const other = randomUUID();
    const c = await admin.connect();
    try {
      await seedStore(c, id);
      await expect(c.query(`insert into stores (id, store_id, platform, platform_store_id, name) values ($1, $1, 'salla', $2, 'dup')`, [other, `seed-${id}`])).rejects.toMatchObject({ code: '23505' });
      await c.query(`insert into merchant_accounts (store_id, platform_merchant_id) values ($1, 'm')`, [id]);
      await expect(c.query(`insert into merchant_accounts (store_id, platform_merchant_id) values ($1, 'm2')`, [id])).rejects.toMatchObject({ code: '23505' });
    } finally {
      c.release();
    }
  });

  it('store_locator: the app role can insert but not read or update; lookup goes through locate_store(); rows are write-once', async () => {
    const id = randomUUID();
    const ps = `loc-${id}`;
    const c = await admin.connect();
    try {
      await seedStore(c, id); // stores row + locator row (as admin)
    } finally {
      c.release();
    }
    await expect(app.query('select * from store_locator')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query("update store_locator set id = $1 where platform_store_id = $2", [randomUUID(), `seed-${id}`])).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('delete from store_locator')).rejects.toMatchObject({ code: '42501' });
    expect((await app.query<{ id: string }>("select locate_store('salla', $1)::text as id", [`seed-${id}`])).rows[0]!.id).toBe(id);
    expect((await app.query("select locate_store('salla', $1) as id", [`nope-${ps}`])).rows[0]!.id).toBeNull();
    // even a privileged role can not re-point a row
    await expect(admin.query('update store_locator set id = $1 where platform_store_id = $2', [randomUUID(), `seed-${id}`])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query('delete from store_locator where platform_store_id = $1', [`seed-${id}`])).rejects.toMatchObject({ code: '42501' });
    // purging the store cascades to its locator row
    await admin.query('delete from stores where id = $1', [id]);
    expect((await admin.query('select 1 from store_locator where id = $1', [id])).rowCount).toBe(0);
  });
});
