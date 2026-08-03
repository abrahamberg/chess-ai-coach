import { sql, type Kysely } from 'kysely';

/**
 * DB-backed replacement for bootstrap.ts's in-memory fen -> PositionAnalysis
 * cache: analysis is a pure function of a FEN at a fixed depth/multiPv, so
 * `fen` alone is the primary key (no gameId/ply columns needed — a game's
 * FENs are cheaply re-derived from its PGN). Backs both the deepen-analysis
 * background job (which warms this table ply by ply after the fast
 * classify/plan pipeline finishes) and the coach's live analyzePosition
 * dependency (cache-first: read here, only fall back to Stockfish on a miss).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE position_evaluations (
      fen text PRIMARY KEY,
      depth integer NOT NULL,
      multi_pv integer NOT NULL,
      analysis jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE position_evaluations`.execute(db);
}
