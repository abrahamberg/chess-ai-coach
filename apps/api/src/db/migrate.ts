import { Migrator, type Kysely, type MigrationProvider } from 'kysely';
import * as initial from './migrations/0001_initial.js';
import * as sessionSummary from './migrations/0002_session_summary.js';
import * as classifiedMoves from './migrations/0003_classified_moves.js';
import * as sessionAbandonedStatus from './migrations/0004_session_abandoned_status.js';
import * as sessionDebugSnapshot from './migrations/0005_session_debug_snapshot.js';
import * as episodeContext from './migrations/0006_episode_context.js';

const provider: MigrationProvider = {
  getMigrations: () =>
    Promise.resolve({
      '0001_initial': initial,
      '0002_session_summary': sessionSummary,
      '0003_classified_moves': classifiedMoves,
      '0004_session_abandoned_status': sessionAbandonedStatus,
      '0005_session_debug_snapshot': sessionDebugSnapshot,
      '0006_episode_context': episodeContext
    })
};

/** Runs all not-yet-applied migrations, in order. Throws if any migration fails. */
export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();

  const failed = results?.find((result) => result.status === 'Error');
  if (failed) throw new Error(`Migration failed: ${failed.migrationName}`);
  if (error) throw error instanceof Error ? error : new Error(String(error));
}
