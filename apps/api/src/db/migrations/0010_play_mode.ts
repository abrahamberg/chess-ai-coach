import { sql, type Kysely } from 'kysely';

/**
 * Play mode (architecture.md §14): a live sparring game against the coach,
 * reusing games/sessions rather than a parallel schema. `games.source` gains
 * 'coach_play' (a play-mode game's PGN starts header-only and grows move by
 * move via games.updatePgn — see game-move-mutation service). `sessions.mode`
 * distinguishes a play session from today's only mode, 'analyze', which
 * every pre-existing row backfills to. `game_move_qualities` is play mode's
 * live equivalent of analyses.classified_moves — one row per move (not a
 * growing jsonb array) so undo is a single `DELETE ... WHERE ply = $1`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE games DROP CONSTRAINT games_source_check`.execute(db);
  await sql`
    ALTER TABLE games ADD CONSTRAINT games_source_check
      CHECK (source IN ('paste','upload','lichess','coach_play'))
  `.execute(db);

  await sql`
    ALTER TABLE sessions ADD COLUMN mode text NOT NULL DEFAULT 'analyze'
      CHECK (mode IN ('analyze','play'))
  `.execute(db);

  await sql`
    CREATE TABLE game_move_qualities (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      game_id       uuid NOT NULL REFERENCES games(id),
      ply           int NOT NULL,
      move_san      text NOT NULL,
      mover         text NOT NULL CHECK (mover IN ('white','black')),
      quality       text NOT NULL,
      cp_loss       int NOT NULL,
      best_line_san jsonb NOT NULL,
      eval_after_cp int NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (game_id, ply)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE game_move_qualities`.execute(db);
  await sql`ALTER TABLE sessions DROP COLUMN mode`.execute(db);
  await sql`ALTER TABLE games DROP CONSTRAINT games_source_check`.execute(db);
  await sql`
    ALTER TABLE games ADD CONSTRAINT games_source_check
      CHECK (source IN ('paste','upload','lichess'))
  `.execute(db);
}
