import { sql, type Kysely } from 'kysely';

/**
 * Engine mode selection (pluggable engine backend): users choose between
 * 'native' (server-side Stockfish, the default) or 'browser' (client-side
 * WASM tunneled over WebSocket). All existing users default to 'native'.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ADD COLUMN engine_mode text NOT NULL DEFAULT 'native'
      CHECK (engine_mode IN ('native','browser'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN engine_mode`.execute(db);
}
