import type { Pool, PoolClient } from 'pg';
import { withStoreContext } from '../tenant/context.js';

export interface TenantTableRegistration {
  /** Table name (must match the schema). */
  table: string;
  /** Primary key column used to address rows. Default `id`. */
  idColumn?: string;
  /**
   * Insert one row for `storeId` with `PoolClient` (a privileged connection that bypasses RLS) and
   * return its id. Called once per store.
   */
  seed(client: PoolClient, storeId: string): Promise<string>;
}

const registry = new Map<string, TenantTableRegistration>();

/** Every tenant table registers here (AD-3) and is exercised by `assertCrossTenantIsolation`. */
export function registerTenantTable(reg: TenantTableRegistration): void {
  if (registry.has(reg.table)) throw new Error(`tenant table ${reg.table} is already registered`);
  registry.set(reg.table, reg);
}

export function registeredTenantTables(): TenantTableRegistration[] {
  return [...registry.values()];
}

/** Names from `tenantTableNames` (tables with a `store_id`) that did not register with the harness. */
export function findUnregisteredTenantTables(tenantTableNames: readonly string[], registered: readonly string[] = [...registry.keys()]): string[] {
  const have = new Set(registered);
  return tenantTableNames.filter((t) => !have.has(t));
}

const q = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe SQL identifier: ${name}`);
  return `"${name}"`;
};

export interface CrossTenantPools {
  /** Privileged pool (owner or superuser) used only to seed rows and read them back. */
  admin: Pool;
  /** Pool connected as the NON-superuser, NON-owner app role. */
  app: Pool;
  storeA: string;
  storeB: string;
}

function expect(cond: boolean, message: string): void {
  if (!cond) throw new Error(`cross-tenant isolation failed: ${message}`);
}

/**
 * Seeds one row for store A and one for store B, then proves that, inside store A's context, store B's
 * row can not be read, updated or deleted, that inserting a row for store B is rejected, and that a raw
 * query with no context errors instead of returning rows. Throws on the first breach.
 */
export async function assertCrossTenantIsolation(pools: CrossTenantPools, reg: TenantTableRegistration): Promise<void> {
  const t = q(reg.table);
  const who = await pools.app.query<{ user: string; super: boolean; bypass: boolean; owner: string | null }>(
    `select current_user as "user", r.rolsuper as super, r.rolbypassrls as bypass,
            (select tableowner from pg_tables where tablename = $1 and schemaname = current_schema()) as owner
       from pg_roles r where r.rolname = current_user`,
    [reg.table],
  );
  const me = who.rows[0]!;
  expect(!me.super && !me.bypass && me.owner !== me.user, `app pool must be a non-superuser, non-bypassrls, non-owner role (is ${me.user})`);
  const id = q(reg.idColumn ?? 'id');
  const { admin, app, storeA, storeB } = pools;
  const seeded = await admin.connect();
  let idA: string;
  let idB: string;
  try {
    idA = await reg.seed(seeded, storeA);
    idB = await reg.seed(seeded, storeB);
  } finally {
    seeded.release();
  }

  const readIds = (store: string) =>
    withStoreContext(app, store, async (ctx) => (await ctx.query<{ id: string; store_id: string }>(`select ${id}::text as id, store_id::text as store_id from ${t}`)).rows as { id: string; store_id: string }[]);

  const rowsA = await readIds(storeA);
  expect(rowsA.some((r) => r.id === idA), `${reg.table}: store A cannot read its own row`);
  expect(!rowsA.some((r) => r.id === idB) && rowsA.every((r) => r.store_id.toLowerCase() === storeA.toLowerCase()), `${reg.table}: store A read store B's row`);
  const rowsB = await readIds(storeB);
  expect(!rowsB.some((r) => r.id === idA), `${reg.table}: store B read store A's row`);

  await withStoreContext(app, storeA, async (ctx) => {
    const upd = await ctx.query(`update ${t} set store_id = store_id where ${id}::text = $1`, [idB]);
    expect(upd.rowCount === 0, `${reg.table}: store A updated store B's row`);
    const del = await ctx.query(`delete from ${t} where ${id}::text = $1`, [idB]);
    expect(del.rowCount === 0, `${reg.table}: store A deleted store B's row`);
  });

  const stillThere = await admin.query(`select 1 from ${t} where ${id}::text = $1`, [idB]);
  expect(stillThere.rowCount === 1, `${reg.table}: store B's row is gone or changed`);

  // Writing a row into another tenant must be rejected by WITH CHECK.
  let crossInsertRejected = false;
  try {
    await withStoreContext(app, storeA, async (ctx) => {
      await ctx.query(`update ${t} set store_id = $1 where ${id}::text = $2`, [storeB, idA]);
    });
  } catch {
    crossInsertRejected = true;
  }
  expect(crossInsertRejected, `${reg.table}: store A moved a row into store B`);

  // INSERT carrying another store's id must be rejected by WITH CHECK (42501); the same insert for store A works.
  const asClient = (ctx: { query: PoolClient['query'] }) => ({ query: ctx.query }) as unknown as PoolClient;
  await withStoreContext(app, storeA, async (ctx) => {
    await ctx.query('savepoint own');
    await reg.seed(asClient(ctx as never), storeA);
    await ctx.query('rollback to savepoint own');
  });
  let insertCode: string | undefined;
  try {
    await withStoreContext(app, storeA, (ctx) => reg.seed(asClient(ctx as never), storeB));
  } catch (err) {
    insertCode = (err as { code?: string }).code;
  }
  expect(insertCode === '42501', `${reg.table}: store A inserted a row for store B (error ${insertCode ?? 'none'})`);

  // Fail closed: no context at all must error, never return rows.
  let failedClosed = false;
  const bare = await app.connect();
  try {
    await bare.query(`select * from ${t}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    failedClosed = code === '22P02' || code === '42704';
  } finally {
    bare.release();
  }
  expect(failedClosed, `${reg.table}: a query with no store context returned rows`);
}
