// Live-Postgres tests for the publishing tables: RLS convention, ownership, cross-tenant isolation, constraints (Story 4.4).
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrate.js';
import { findUnownedTables, schemaTableNames, tableOwners } from '../ownership.js';
import { findTenantViolations } from '../tenant/rls.js';
import { ensureTestAppRole } from '../testing/app-role.js';
import { assertCrossTenantIsolation, findUnregisteredTenantTables, registerTenantTable, registeredTenantTables } from '../testing/cross-tenant.js';
import * as schema from './index.js';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? `postgres://slips:slips@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const APP_URL = process.env.TEST_APP_URL ?? `postgres://slips_it_publishing:it_publishing_pw@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const TENANT_TABLES = ['store_manifests'];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_publishing', 'it_publishing_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 1 });
});
afterAll(async () => {
  await app?.end();
  await admin.end();
});

describe('publishing tables', () => {
  it('follow the tenant convention', async () => {
    expect((await findTenantViolations(admin)).filter((v) => TENANT_TABLES.includes(v.table))).toEqual([]);
  });

  it('are owned by publishing and the schema has no unowned table', () => {
    for (const t of TENANT_TABLES) expect(tableOwners().get(t)).toBe('publishing');
    expect(findUnownedTables(schemaTableNames(schema))).toEqual([]);
  });

  it('every publishing tenant table registers with the cross-tenant harness', () => {
    registerTenantTable({
      table: 'store_manifests',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into store_manifests (store_id, revision, manifest, size_gzip_bytes, compiled_at)
             values ($1, 1, '{"v":1}'::jsonb, 10, now())
             on conflict (store_id) do update set compiled_at = now() returning id::text as id`,
            [s],
          )
        ).rows[0]!.id,
    });
    expect(findUnregisteredTenantTables(TENANT_TABLES)).toEqual([]);
  });

  it.each(TENANT_TABLES)('%s: store A can not read, change or write store B rows', async (table) => {
    const reg = registeredTenantTables().find((r) => r.table === table);
    expect(reg).toBeDefined();
    await assertCrossTenantIsolation({ admin, app, storeA: randomUUID(), storeB: randomUUID() }, reg!);
  });

  it('store_manifests (0024): one row per store, non-null scope, non-negative revision, compiled fields set together', async () => {
    const s = randomUUID();
    await expect(admin.query('insert into store_manifests (store_id) values ($1)', [s])).resolves.toBeDefined();
    await expect(admin.query('insert into store_manifests (store_id) values ($1)', [s])).rejects.toMatchObject({ code: '23505' });
    await expect(admin.query('insert into store_manifests (store_id) values (null)')).rejects.toMatchObject({ code: '23502' });
    await expect(admin.query('insert into store_manifests (store_id, revision) values ($1, -1)', [randomUUID()])).rejects.toMatchObject({ code: '23514' });
    // A compiled row carries its manifest, size and time; revision 0 (never compiled) carries none of them.
    await expect(admin.query(`insert into store_manifests (store_id, revision, manifest) values ($1, 1, '{}'::jsonb)`, [randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`insert into store_manifests (store_id, revision, manifest, size_gzip_bytes, compiled_at) values ($1, 0, '{}'::jsonb, 1, now())`, [randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`insert into store_manifests (store_id, revision, manifest, size_gzip_bytes, compiled_at) values ($1, 2, '{}'::jsonb, -1, now())`, [randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`insert into store_manifests (store_id, revision, manifest, size_gzip_bytes, compiled_at) values ($1, 2, '{}'::jsonb, 1, now())`, [randomUUID()])).resolves.toBeDefined();
  });
});
