import type { Queryable } from './queryable.js';

const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe SQL identifier: ${name}`);
  return `"${name}"`;
};

/**
 * Migration convention for a tenant table: paste these statements after its CREATE TABLE. The policy reads
 * `current_setting('app.store_id')` WITHOUT `missing_ok`, so a missing context raises an error (fail closed),
 * and FORCE makes the rule apply even to the table owner. Pass `storeIdType` for non-uuid keys.
 */
export function tenantTableStatements(table: string, opts: { storeIdType?: 'uuid' | 'text' } = {}): string[] {
  const t = ident(table);
  const type = opts.storeIdType ?? 'uuid';
  const expr = `store_id = current_setting('app.store_id')::${type}`;
  return [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON ${t} USING (${expr}) WITH CHECK (${expr})`,
  ];
}

export interface TenantViolation {
  table: string;
  problem: string;
}

/**
 * Audit a live schema: every table with a `store_id` column must have it NOT NULL, RLS enabled and forced,
 * and a policy on `current_setting('app.store_id')` without `missing_ok`.
 */
export async function findTenantViolations(db: Queryable, schema = 'public'): Promise<TenantViolation[]> {
  const { rows } = await db.query<{
    table: string;
    notnull: boolean;
    rls: boolean;
    forced: boolean;
    good_policies: string;
    bad_policies: string;
  }>(
    `select c.relname as "table", a.attnotnull as notnull, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
            (select count(*) from pg_policy p where p.polrelid = c.oid
               and pg_get_expr(p.polqual, p.polrelid) like '%current_setting(''app.store_id''::text)%'
               and pg_get_expr(p.polqual, p.polrelid) not like '%, true)%')::text as good_policies,
            (select count(*) from pg_policy p where p.polrelid = c.oid
               and pg_get_expr(p.polqual, p.polrelid) like '%, true)%')::text as bad_policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped
      where n.nspname = $1 and c.relkind in ('r', 'p')`,
    [schema],
  );
  const out: TenantViolation[] = [];
  for (const r of rows) {
    if (!r.notnull) out.push({ table: r.table, problem: 'store_id is nullable' });
    if (!r.rls) out.push({ table: r.table, problem: 'row level security is not enabled' });
    if (!r.forced) out.push({ table: r.table, problem: 'row level security is not forced' });
    if (Number(r.good_policies) === 0) out.push({ table: r.table, problem: "no policy on current_setting('app.store_id') without missing_ok" });
    if (Number(r.bad_policies) > 0) out.push({ table: r.table, problem: 'a policy uses missing_ok (fails open)' });
  }
  return out;
}

/** Tables in `schema` owned by `role`. The app role must own none. */
export async function tablesOwnedBy(db: Queryable, role: string, schema = 'public'): Promise<string[]> {
  const { rows } = await db.query<{ tablename: string }>('select tablename from pg_tables where schemaname = $1 and tableowner = $2', [schema, role]);
  return rows.map((r) => r.tablename);
}
