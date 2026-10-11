import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, QueryResult, QueryResultRow } from 'pg';

/** Drizzle handle bound to the open transaction of the current store context. */
export type StoreDb = NodePgDatabase;

export interface StoreContext {
  readonly storeId: string;
  readonly db: StoreDb;
  /** Raw parameterised query on the same transaction. */
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/** Thrown when tenant data is touched with no store context (fail closed). */
export class MissingStoreContextError extends Error {
  constructor() {
    super('No store context: tenant data may only be accessed inside withStoreContext()');
    this.name = 'MissingStoreContextError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const storage = new AsyncLocalStorage<StoreContext>();

/** The active store context, or undefined outside one. */
export function currentStoreContext(): StoreContext | undefined {
  return storage.getStore();
}

/** The active store context; throws `MissingStoreContextError` outside one. */
export function requireStoreContext(): StoreContext {
  const ctx = storage.getStore();
  if (!ctx) throw new MissingStoreContextError();
  return ctx;
}

/**
 * THE one place that sets the tenant context (AD-3; lint bans setting it anywhere else). Opens a
 * transaction, applies `app.store_id` transaction-locally (`set_config(..., true)` is `SET LOCAL` with a
 * bound parameter) and runs `fn` inside it. The setting vanishes at COMMIT/ROLLBACK, so a pooled
 * connection never carries a store into its next use. Nested calls for the same store join the open
 * transaction; a nested call for another store throws.
 */
export async function withStoreContext<T>(pool: Pool, storeId: string, fn: (ctx: StoreContext) => Promise<T>): Promise<T> {
  if (!UUID.test(storeId)) throw new Error('withStoreContext: storeId must be a UUID');
  const parent = storage.getStore();
  if (parent) {
    if (parent.storeId.toLowerCase() !== storeId.toLowerCase()) throw new Error('withStoreContext: nested context for a different store');
    return fn(parent);
  }
  const client = await pool.connect();
  let closeCtx = (): void => {};
  let destroy = false;
  try {
    await client.query('BEGIN');
    await client.query("select set_config('app.store_id', $1, true)", [storeId]);
    let closed = false;
    const guard = (): void => {
      if (closed) throw new Error('store context is closed: its transaction has ended');
    };
    const db = drizzle(client);
    const ctx: StoreContext = {
      storeId,
      get db() {
        guard();
        return db;
      },
      query: (text, values) => {
        guard();
        return client.query(text, values);
      },
    };
    closeCtx = () => {
      closed = true;
    };
    const result = await storage.run(ctx, () => fn(ctx));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // never return a client with an unknown transaction state to the pool
      destroy = true;
    }
    throw err;
  } finally {
    closeCtx();
    client.release(destroy);
  }
}

/**
 * Run `fn` with no ambient store context, so a `withStoreContext` inside it opens its OWN transaction instead of
 * joining the caller's. For work that must commit independently of the surrounding transaction (e.g. persisting a
 * rotated single-use token before the outer transaction ends).
 */
export function runOutsideStoreContext<T>(fn: () => T): T {
  return storage.exit(fn);
}
