// Live-Postgres tests for the media tables: RLS convention, ownership, cross-tenant isolation, constraints (Story 3.5).
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
const APP_URL = process.env.TEST_APP_URL ?? 'postgres://slips_it_media:it_media_pw@127.0.0.1:5433/slips';
const TENANT_TABLES = ['media_assets', 'media_upload_grants'];
const SHA = 'a'.repeat(64);

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_media', 'it_media_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 1 });
});
afterAll(async () => {
  await app?.end();
  await admin.end();
});

describe('media tables', () => {
  it('follow the tenant convention', async () => {
    expect((await findTenantViolations(admin)).filter((v) => TENANT_TABLES.includes(v.table))).toEqual([]);
  });

  it('are owned by media and the schema has no unowned table', () => {
    for (const t of TENANT_TABLES) expect(tableOwners().get(t)).toBe('media');
    expect(findUnownedTables(schemaTableNames(schema))).toEqual([]);
  });

  it('every media tenant table registers with the cross-tenant harness', () => {
    registerTenantTable({
      table: 'media_assets',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into media_assets (store_id, kind, content_type, size_bytes, sha256, upload_key)
             values ($1, 'image', 'image/jpeg', 1024, $2, $3) returning id::text as id`,
            [s, SHA, `stores/${s}/uploads/${SHA}`],
          )
        ).rows[0]!.id,
    });
    registerTenantTable({
      table: 'media_upload_grants',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into media_upload_grants (store_id, kind, content_type, size_bytes, sha256, storage_key, expires_at)
             values ($1, 'video', 'video/mp4', 2048, $2, $3, now() + interval '15 minutes') returning id::text as id`,
            [s, SHA, `stores/${s}/uploads/${SHA}`],
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

  it('enforces kind, size, sha256, status and failure_reason iff failed', async () => {
    const s = randomUUID();
    const ins = (kind: string, size: number, sha: string, status: string, reason: string | null) =>
      admin.query(
        `insert into media_assets (store_id, kind, content_type, size_bytes, sha256, upload_key, status, failure_reason)
         values ($1, $2, 'image/png', $3, $4, 'k', $5, $6)`,
        [s, kind, size, sha, status, reason],
      );
    await expect(ins('audio', 1, SHA, 'uploaded', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('image', 0, SHA, 'uploaded', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('image', 1, 'A'.repeat(64), 'uploaded', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('image', 1, SHA, 'ready', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('image', 1, SHA, 'failed', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('image', 1, SHA, 'scanned', 'malware')).rejects.toMatchObject({ code: '23514' });
    await expect(ins('image', 1, SHA, 'failed', 'malware')).resolves.toBeDefined();
    await expect(ins('video', 200 * 1024 * 1024, SHA, 'processed', null)).resolves.toBeDefined();
    expect(schema.MEDIA_ASSET_STATUSES).toEqual(['uploaded', 'scanned', 'processed', 'failed']);
  });
});
