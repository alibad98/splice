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
const TENANT_TABLES = ['store_manifests', 'manifest_deliveries'];

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
    registerTenantTable({ table: 'manifest_deliveries', seed: async (c, storeId) => (await c.query<{ id: string }>(`insert into manifest_deliveries (store_id,install_epoch,platform_store_id,revision,content_hash) values ($1,1,'test',1,repeat('a',64)) on conflict (store_id) do update set revision=manifest_deliveries.revision+1 returning id::text as id`, [storeId])).rows[0]!.id });
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

describe('manifest delivery constraints', () => {
  it('requires valid scope, epoch, revision and canonical hashes', async () => {
    for (const [epoch, revision, hash] of [[0,1,'a'.repeat(64)],[1,0,'a'.repeat(64)],[1,1,'bad']] as const) {
      await expect(admin.query('insert into manifest_deliveries (store_id,install_epoch,platform_store_id,revision,content_hash) values ($1,$2,$3,$4,$5)', [randomUUID(),epoch,'123',revision,hash])).rejects.toMatchObject({ code:'23514' });
    }
    await expect(admin.query("insert into manifest_deliveries (store_id,install_epoch,platform_store_id,revision,content_hash) values (null,1,'123',1,repeat('a',64))")).rejects.toMatchObject({code:'23502'});
  });
});

describe('manifest delivery operational aggregate boundary', () => {
  it('returns counts and age only to the app role, with fixed search path and no public grant', async () => {
    const result = await app.query('select * from manifest_delivery_stats()');
    expect(Object.keys(result.rows[0]).sort()).toEqual(['failed','oldest_seconds','pending']);
    for (const value of Object.values(result.rows[0])) expect(Number(value)).toBeGreaterThanOrEqual(0);
    const metadata=await admin.query(`select p.prosecdef,p.proconfig,array_to_string(p.proacl,',') as acl from pg_proc p where p.oid='manifest_delivery_stats()'::regprocedure`);
    expect(metadata.rows[0].prosecdef).toBe(true);
    expect(metadata.rows[0].proconfig).toContain('search_path=pg_catalog, public');
    expect(metadata.rows[0].acl).toContain('slips_app=X/');
    expect(metadata.rows[0].acl).not.toMatch(/(^|,)=/);
  });
});
