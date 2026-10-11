import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

/** Table ownership map from ARCHITECTURE-SPINE (AD-2): exactly one owning module per table. */
export const OWNERSHIP = {
  session: ['merchant_sessions'],
  integration: ['stores', 'store_settings', 'store_settings_history', 'platform_tokens', 'token_access_log', 'store_locator', 'merchant_accounts', 'webhook_inbox', 'orders', 'order_lines', 'store_data_jobs', 'lifecycle_audit', 'store_purge_schedule'],
  catalog: ['products', 'categories'],
  content: ['content_items', 'slides', 'placements', 'schedules', 'content_product_links'],
  media: ['media_assets', 'renditions'],
  publishing: ['store_manifests', 'store_keys'],
  analytics: ['events_raw', 'daily_rollups'],
  attribution: ['cart_adds', 'attributed_lines'],
  billing: ['subscriptions', 'usage_meters'],
  admin: ['admin_users', 'admin_audit_log', 'reconciliation_runs'],
} as const satisfies Record<string, readonly string[]>;

export type OwnerModule = keyof typeof OWNERSHIP;

/** table name -> owning module. */
export function tableOwners(map: Readonly<Record<string, readonly string[]>> = OWNERSHIP): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [owner, tables] of Object.entries(map)) {
    for (const table of tables) {
      const prior = owners.get(table);
      if (prior) throw new Error(`table ${table} has two owners: ${prior} and ${owner}`);
      owners.set(table, owner);
    }
  }
  return owners;
}

/** Names from `tableNames` that no module declares. */
export function findUnownedTables(tableNames: readonly string[], map: Readonly<Record<string, readonly string[]>> = OWNERSHIP): string[] {
  const owners = tableOwners(map);
  return tableNames.filter((t) => !owners.has(t));
}

/** Names of every Drizzle table exported from a schema namespace. */
export function schemaTableNames(schema: Record<string, unknown>): string[] {
  return Object.values(schema)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => getTableName(t));
}
