import { sql, type Kysely } from 'kysely';

/**
 * Adds sessions.summary/homework, needed by the summarize-session job (Task 5.4)
 * to persist the progress-summarizer's SessionOutcome — a column pair the
 * original architecture §3 sessions table didn't list, even though Task 5.4's
 * plan text says "summary+homework stored on session".
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN summary text`.execute(db);
  await sql`ALTER TABLE sessions ADD COLUMN homework text`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions DROP COLUMN homework`.execute(db);
  await sql`ALTER TABLE sessions DROP COLUMN summary`.execute(db);
}
