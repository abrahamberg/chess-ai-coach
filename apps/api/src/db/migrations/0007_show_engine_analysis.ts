import { sql, type Kysely } from 'kysely';

/**
 * Opt-in toggle (design doc principle 4 override): students can enable raw
 * engine analysis (evaluations, principal variations, hanging pieces, etc.)
 * for their own account. Defaults to false — the pedagogical
 * engine-invisible experience is unchanged unless a student opts in.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN show_engine_analysis boolean NOT NULL DEFAULT false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN show_engine_analysis`.execute(db);
}
