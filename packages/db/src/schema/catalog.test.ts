// Live-Postgres tests for the catalog tables: RLS convention, ownership, cross-tenant isolation (Story 2.1).
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate.js';
import { findUnownedTables, schemaTableNames, tableOwners } from '../ownership.js';
import { findTenantViolations } from '../tenant/rls.js';
import { ensureTestAppRole } from '../testing/app-role.js';
import { assertCrossTenantIsolation, findUnregisteredTenantTables, registerTenantTable, registeredTenantTables } from '../testing/cross-tenant.js';
import * as schema from './index.js';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://slips:slips@127.0.0.1:5433/slips';
const APP_URL = process.env.TEST_APP_URL ?? 'postgres://slips_it_catalog:it_catalog_pw@127.0.0.1:5433/slips';
const TENANT_TABLES = ['products', 'categories', 'catalog_sync_state'];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_catalog', 'it_catalog_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 1 });
});
afterAll(async () => {
  await app?.end();
  await admin.end();
});

describe('catalog tables', () => {
  it('follow the tenant convention', async () => {
    expect((await findTenantViolations(admin)).filter((v) => TENANT_TABLES.includes(v.table))).toEqual([]);
  });

  it('are owned by catalog and the schema has no unowned table', () => {
    for (const t of TENANT_TABLES) expect(tableOwners().get(t)).toBe('catalog');
    expect(findUnownedTables(schemaTableNames(schema))).toEqual([]);
  });

  it('every catalog tenant table registers with the cross-tenant harness', () => {
    registerTenantTable({
      table: 'products',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into products (store_id, platform, external_id, name, price_minor, currency, tax_inclusive, availability, has_required_options, visible, source_updated_at)
             values ($1, 'salla', $2, 'P', 1000, 'SAR', true, 'available', false, true, now()) returning id::text as id`,
            [s, `p-${randomUUID()}`],
          )
        ).rows[0]!.id,
    });
    registerTenantTable({
      table: 'categories',
      seed: async (c: pg.PoolClient, s: string) =>
        (await c.query<{ id: string }>(`insert into categories (store_id, platform, external_id, name, source_updated_at) values ($1, 'salla', $2, 'C', now()) returning id::text as id`, [s, `c-${randomUUID()}`])).rows[0]!.id,
    });
    registerTenantTable({
      table: 'catalog_sync_state',
      idColumn: 'store_id',
      seed: async (c: pg.PoolClient, s: string) =>
        (await c.query<{ id: string }>(`insert into catalog_sync_state (store_id, run_id, status) values ($1, $2, 'running') on conflict (store_id) do update set status = 'running' returning store_id::text as id`, [s, randomUUID()])).rows[0]!.id,
    });
    expect(findUnregisteredTenantTables(TENANT_TABLES)).toEqual([]);
    expect(registeredTenantTables().length).toBe(3);
  });

  it.each(TENANT_TABLES)('%s: store A can not read, change or write store B rows', async (table) => {
    const reg = registeredTenantTables().find((r) => r.table === table);
    expect(reg).toBeDefined();
    await assertCrossTenantIsolation({ admin, app, storeA: randomUUID(), storeB: randomUUID() }, reg!);
  });

  it('rejects a bad availability bucket, a lower-case currency, a negative price and a duplicate external id', async () => {
    const s = randomUUID();
    const ins = (ext: string, availability = 'available', currency = 'SAR', price = 100) =>
      admin.query(
        `insert into products (store_id, platform, external_id, name, price_minor, currency, tax_inclusive, availability, has_required_options, visible, source_updated_at)
         values ($1, 'salla', $2, 'P', $5, $4, true, $3, false, true, now())`,
        [s, ext, availability, currency, price],
      );
    await expect(ins('a', 'low_stock')).rejects.toMatchObject({ code: '23514' });
    await expect(ins('b', 'available', 'sar')).rejects.toMatchObject({ code: '23514' });
    await expect(ins('c', 'available', 'SAR', -1)).rejects.toMatchObject({ code: '23514' });
    await ins('d');
    await expect(ins('d')).rejects.toMatchObject({ code: '23505' });
  });
});
