import type { QueryResult, QueryResultRow } from 'pg';

/** Anything with a pg-style `query` (Pool, PoolClient). */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}
