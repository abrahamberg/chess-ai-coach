import { createDb } from './index.js';
import { migrateToLatest } from './migrate.js';

/** Task 7.2: standalone migration entrypoint — mirrors the Helm chart's
 * pre-upgrade/pre-install migrate-job hook (architecture.md §11) for local
 * dev-parity compose, where it runs once before api/worker start. */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Missing required env var: DATABASE_URL');

  const db = createDb(connectionString);
  try {
    await migrateToLatest(db);
    console.log('Migrations applied.');
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
