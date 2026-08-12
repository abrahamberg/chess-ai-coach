import { sql, type Kysely } from 'kysely';

/**
 * Splits the single `sessions.current_ply` into two concepts (episode-
 * boundary fix): `current_ply` keeps meaning "what the board/analysis
 * currently shows" (updates on every show_position, including a flashback);
 * the new `subject_ply` means "what the conversation is actually about" —
 * episodes (lib/episodes.ts's currentEpisode) and session_messages.ply
 * tagging now key off this instead. A "flashback" show_position (coach
 * glancing at an earlier/later move to make a point, without changing the
 * subject) moves current_ply but leaves subject_ply — and the ongoing
 * episode — untouched; a "subject" show_position (today's only behavior)
 * moves both together, same as before this migration.
 *
 * Backfill: subject_ply starts equal to current_ply for every existing
 * session — every session's most recent episode is, by construction,
 * already scoped to whatever ply its messages carry, so this is exact, not
 * an approximation (unlike 0006's ply backfill).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN subject_ply int NOT NULL DEFAULT 0`.execute(db);
  await sql`UPDATE sessions SET subject_ply = current_ply`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions DROP COLUMN subject_ply`.execute(db);
}
