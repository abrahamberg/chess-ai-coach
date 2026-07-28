import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Kysely } from 'kysely';
import { createDb } from '../../src/db/index.js';
import { migrateToLatest } from '../../src/db/migrate.js';
import type { Database } from '../../src/db/schema.js';

export interface TestDb {
  db: Kysely<Database>;
  cleanup: () => Promise<void>;
}

/** Spins up a throwaway, migrated Postgres container for a test suite. Call once
 * in `beforeAll` and `cleanup()` in `afterAll` — one container per suite, not per test. */
export async function createTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:16-alpine'
  ).start();
  const db = createDb(container.getConnectionUri());
  await migrateToLatest(db);

  return {
    db,
    cleanup: async () => {
      await db.destroy();
      await container.stop();
    }
  };
}
