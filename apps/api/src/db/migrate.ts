import { Migrator, type Kysely, type MigrationProvider } from 'kysely';
import * as initial from './migrations/0001_initial.js';

const provider: MigrationProvider = {
  getMigrations: () => Promise.resolve({ '0001_initial': initial })
};

/** Runs all not-yet-applied migrations, in order. Throws if any migration fails. */
export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();

  const failed = results?.find((result) => result.status === 'Error');
  if (failed) throw new Error(`Migration failed: ${failed.migrationName}`);
  if (error) throw error instanceof Error ? error : new Error(String(error));
}
