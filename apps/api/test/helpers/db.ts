import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { createDb } from '../../src/db/index.js';
import { migrateToLatest } from '../../src/db/migrate.js';
import type { Database } from '../../src/db/schema.js';

export interface TestDb {
  db: Kysely<Database>;
  connectionString: string;
  cleanup: () => Promise<void>;
}

/** Spins up a throwaway, migrated Postgres container for a test suite. Call once
 * in `beforeAll` and `cleanup()` in `afterAll` — one container per suite, not per test. */
export async function createTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine'
  ).start();
  const connectionString = container.getConnectionUri();
  const db = createDb(connectionString);
  await migrateToLatest(db);

  return {
    db,
    connectionString,
    cleanup: async () => {
      await db.destroy();
      await container.stop();
    }
  };
}
