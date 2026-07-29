import { sql, type Kysely } from 'kysely';

/**
 * Adds the 'abandoned' session status — set when a student explicitly resets
 * an active/paused session from the Games page instead of letting the coach
 * end it naturally (end_session). Distinct from 'completed' so the dashboard's
 * completed-session history (which expects a real summary/homework) doesn't
 * pick up resets that never got a coach wrap-up.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions DROP CONSTRAINT sessions_status_check`.execute(db);
  await sql`
    ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
      CHECK (status IN ('active','completed','paused_no_credits','abandoned'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions DROP CONSTRAINT sessions_status_check`.execute(db);
  await sql`
    ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
      CHECK (status IN ('active','completed','paused_no_credits'))
  `.execute(db);
}
