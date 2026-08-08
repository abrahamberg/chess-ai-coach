import { sql, type Kysely } from 'kysely';

/**
 * Engine mode selection (pluggable engine backend): users choose between
 * 'native' (server-side Stockfish, the default) or 'browser' (client-side
 * WASM tunneled over WebSocket). All existing users default to 'native'.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ADD COLUMN engineMode text NOT NULL DEFAULT 'native'
      CHECK (engineMode IN ('native','browser'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN engineMode`.execute(db);
}
