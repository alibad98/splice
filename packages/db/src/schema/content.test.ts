// Live-Postgres tests for the content tables: RLS convention, ownership, cross-tenant isolation, constraints (Story 3.1).
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
const APP_URL = process.env.TEST_APP_URL ?? `postgres://slips_it_content:it_content_pw@127.0.0.1:${process.env.TEST_DATABASE_PORT ?? '5433'}/slips`;
const TENANT_TABLES = ['content_items', 'content_product_links', 'slides', 'placements'];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
let app: pg.Pool;

beforeAll(async () => {
  await runMigrations(admin);
  await ensureTestAppRole(admin, 'slips_it_content', 'it_content_pw');
  app = new pg.Pool({ connectionString: APP_URL, max: 1 });
});
afterAll(async () => {
  await app?.end();
  await admin.end();
});

describe('content tables', () => {
  it('follow the tenant convention', async () => {
    expect((await findTenantViolations(admin)).filter((v) => TENANT_TABLES.includes(v.table))).toEqual([]);
  });

  it('are owned by content and the schema has no unowned table', () => {
    for (const t of TENANT_TABLES) expect(tableOwners().get(t)).toBe('content');
    expect(findUnownedTables(schemaTableNames(schema))).toEqual([]);
  });

  it('every content tenant table registers with the cross-tenant harness', () => {
    registerTenantTable({ table: 'placements', seed: async (c, s) => (await c.query<{ id: string }>("insert into placements (store_id, content_id, type) values ($1, gen_random_uuid(), 'home') returning id::text as id", [s])).rows[0]!.id });
    registerTenantTable({
      table: 'content_items',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into content_items (store_id, title, format, cta_label, cta_action)
             values ($1, 'Story 1', 'story', 'Buy now', 'add_to_cart') returning id::text as id`,
            [s],
          )
        ).rows[0]!.id,
    });
    registerTenantTable({
      table: 'content_product_links',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into content_product_links (store_id, content_id, product_id) values ($1, gen_random_uuid(), gen_random_uuid()) returning id::text as id`,
            [s],
          )
        ).rows[0]!.id,
    });
    registerTenantTable({
      table: 'slides',
      seed: async (c: pg.PoolClient, s: string) =>
        (
          await c.query<{ id: string }>(
            `insert into slides (store_id, content_id, media_asset_id, kind, position) values ($1, gen_random_uuid(), gen_random_uuid(), 'image', 0) returning id::text as id`,
            [s],
          )
        ).rows[0]!.id,
    });
    expect(findUnregisteredTenantTables(TENANT_TABLES)).toEqual([]);
    expect(registeredTenantTables().some((r) => r.table === 'content_items')).toBe(true);
  });

  it.each(TENANT_TABLES)('%s: store A can not read, change or write store B rows', async (table) => {
    const reg = registeredTenantTables().find((r) => r.table === table);
    expect(reg).toBeDefined();
    await assertCrossTenantIsolation({ admin, app, storeA: randomUUID(), storeB: randomUUID() }, reg!);
  });

  it('enforces format, status, cta_action and cta_url iff open_link constraints', async () => {
    const s = randomUUID();
    const ins = (format: string, status: string, ctaAction: string, ctaUrl: string | null) =>
      admin.query(
        `insert into content_items (store_id, title, format, cta_label, cta_action, cta_url, status)
         values ($1, 'Item', $2, 'CTA', $3, $4, $5)`,
        [s, format, ctaAction, ctaUrl, status],
      );
    await expect(ins('carousel', 'draft', 'add_to_cart', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('story', 'ready', 'add_to_cart', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('story', 'draft', 'buy_now', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('story', 'draft', 'open_link', null)).rejects.toMatchObject({ code: '23514' });
    await expect(ins('story', 'draft', 'add_to_cart', 'https://example.com')).rejects.toMatchObject({ code: '23514' });
    await expect(ins('reel', 'draft', 'open_link', 'https://example.com/item')).resolves.toBeDefined();
    expect(schema.CONTENT_STATUSES).toEqual(['draft', 'processing', 'failed', 'scheduled', 'published', 'ended', 'archived', 'deactivated']);
  });
});

describe('content_product_links', () => {
  it('holds one link per content item and allows an unlinked (null product) row', async () => {
    const s = randomUUID();
    const content = randomUUID();
    await admin.query(`insert into content_product_links (store_id, content_id, product_id) values ($1, $2, gen_random_uuid())`, [s, content]);
    await expect(admin.query(`insert into content_product_links (store_id, content_id, product_id) values ($1, $2, gen_random_uuid())`, [s, content])).rejects.toMatchObject({
      code: '23505',
    });
    await expect(admin.query(`update content_product_links set product_id = null where store_id = $1 and content_id = $2`, [s, content])).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('placements', () => {
  it('allows one Home per item and rejects unsupported placements and missing tenant scope', async () => {
    const store = randomUUID(); const content = randomUUID();
    const insert = (type: string, storeId: string | null = store) => admin.query('insert into placements (store_id, content_id, type) values ($1, $2, $3)', [storeId, content, type]);
    await insert('home');
    await expect(insert('home')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('category')).rejects.toMatchObject({ code: '23514' });
    await expect(insert('home', null)).rejects.toMatchObject({ code: '23502' });
  });

  it('defaults layout to ring and rejects other or missing layouts (Story 4.2 pilot)', async () => {
    const store = randomUUID();
    const row = await admin.query<{ layout: string }>("insert into placements (store_id, content_id, type) values ($1, gen_random_uuid(), 'home') returning layout", [store]);
    expect(row.rows[0]!.layout).toBe('ring');
    for (const layout of ['bar', 'strip', 'carousel', 'Ring', '']) {
      await expect(admin.query("insert into placements (store_id, content_id, type, layout) values ($1, gen_random_uuid(), 'home', $2)", [store, layout])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(admin.query("insert into placements (store_id, content_id, type, layout) values ($1, gen_random_uuid(), 'home', null)", [store])).rejects.toMatchObject({ code: '23502' });
  });
});

describe('slides', () => {
  it('keeps one live slide per asset per item, allows soft-deleted duplicates and checks kind/position', async () => {
    const s = randomUUID();
    const content = randomUUID();
    const asset = randomUUID();
    const ins = (kind = 'image', position = 0) =>
      admin.query(`insert into slides (store_id, content_id, media_asset_id, kind, position) values ($1, $2, $3, $4, $5)`, [s, content, asset, kind, position]);
    await ins();
    await expect(ins()).rejects.toMatchObject({ code: '23505' });
    await admin.query(`update slides set deleted_at = now() where store_id = $1 and content_id = $2`, [s, content]);
    await expect(ins()).resolves.toBeDefined();
    await expect(admin.query(`insert into slides (store_id, content_id, media_asset_id, kind, position) values ($1, $2, gen_random_uuid(), 'gif', 0)`, [s, content])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`insert into slides (store_id, content_id, media_asset_id, kind, position) values ($1, $2, gen_random_uuid(), 'video', -1)`, [s, content])).rejects.toMatchObject({ code: '23514' });
  });
});
