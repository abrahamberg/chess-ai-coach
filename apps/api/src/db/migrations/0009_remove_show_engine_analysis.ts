import { sql, type Kysely } from 'kysely';

/**
 * Reverts 0007: engine visibility is no longer a per-student opt-in — every
 * student always gets full engine analysis in the coach's context and the
 * coach may always cite raw numbers. The column (and the setting it backed)
 * is gone.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN show_engine_analysis`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN show_engine_analysis boolean NOT NULL DEFAULT false`.execute(db);
}
