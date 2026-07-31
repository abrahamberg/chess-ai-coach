import { sql, type Kysely } from 'kysely';

/**
 * Coach debug mode (docs/superpowers/specs/2026-07-31-coach-debug-mode-design.md):
 * the latest-turn debug snapshot was originally an in-memory, per-process
 * Map — broken the moment the API runs as more than one pod (k8s pods don't
 * share memory), since a debug request can land on a different pod than the
 * one that produced the turn. Moving it to the same latest-state-on-the-row
 * pattern `threads` already uses fixes that: one nullable JSONB column,
 * overwritten every turn, null until the first turn completes.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN debug_snapshot jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions DROP COLUMN debug_snapshot`.execute(db);
}
