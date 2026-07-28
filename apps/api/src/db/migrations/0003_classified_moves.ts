import { sql, type Kysely } from 'kysely';

/**
 * Adds analyses.classifiedMoves — classifyMoves() was already computed for
 * the planner prompt but thrown away afterward, so the move-quality panel
 * (design.md move explorer, color-coded moves) had no data to render. Persist
 * it alongside engineEvals/coachingPlan on the same ready-analysis row.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE analyses ADD COLUMN classified_moves jsonb`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE analyses DROP COLUMN classified_moves`.execute(db);
}
