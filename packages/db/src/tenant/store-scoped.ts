import { requireStoreContext, type StoreDb } from './context.js';

/**
 * Base class for every repository over tenant tables. Data access goes through `db`, which exists only
 * inside `withStoreContext()`; with no context it throws instead of querying. Postgres RLS is the
 * second fence behind it.
 */
export abstract class StoreScoped {
  /** Drizzle handle on the current store's transaction. Throws `MissingStoreContextError` without one. */
  protected get db(): StoreDb {
    return requireStoreContext().db;
  }

  /** Id of the current store. Throws `MissingStoreContextError` without a context. */
  protected get storeId(): string {
    return requireStoreContext().storeId;
  }
}
