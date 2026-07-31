import { sql, type Kysely } from 'kysely';

/**
 * Coach context restructure (docs/superpowers/specs/2026-07-31-coach-context-
 * restructure-design.md §1/§3/§6): tags every session_messages row with the
 * ply that was current when it was written, so a turn's replay can be
 * scoped to one contiguous "episode" instead of the whole transcript.
 * session_move_notes replaces the never-wired-up context_digest/
 * digest_through_message_id columns with per-move rolling notes.
 *
 * Backfill is intentionally crude (pre-launch, low session volume): every
 * existing message is tagged with its session's *current* current_ply,
 * collapsing all pre-migration history into one big episode. Worst case,
 * one old session's first post-migration turn replays more than strictly
 * necessary; it self-corrects from the next episode boundary onward.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE session_messages ADD COLUMN ply int`.execute(db);
  await sql`
    UPDATE session_messages sm
    SET ply = s.current_ply
    FROM sessions s
    WHERE sm.session_id = s.id AND sm.ply IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE session_move_notes (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id  uuid NOT NULL REFERENCES sessions(id),
      ply         int NOT NULL,
      note        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (session_id, ply)
    )
  `.execute(db);

  await sql`ALTER TABLE sessions DROP COLUMN context_digest`.execute(db);
  await sql`ALTER TABLE sessions DROP COLUMN digest_through_message_id`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE sessions ADD COLUMN context_digest text`.execute(db);
  await sql`ALTER TABLE sessions ADD COLUMN digest_through_message_id bigint`.execute(db);
  await sql`DROP TABLE session_move_notes`.execute(db);
  await sql`ALTER TABLE session_messages DROP COLUMN ply`.execute(db);
}
