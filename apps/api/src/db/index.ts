import { CamelCasePlugin, Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export type { Database } from './schema.js';

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString })
    }),
    plugins: [new CamelCasePlugin()]
  });
}

/** Used by /readyz: a trivial round-trip that fails fast if Postgres is unreachable. */
export async function pingDb(db: Kysely<Database>): Promise<boolean> {
  try {
    await sql`select 1`.execute(db);
    return true;
  } catch {
    return false;
  }
}
