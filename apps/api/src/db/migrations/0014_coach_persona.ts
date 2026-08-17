import { sql, type Kysely } from 'kysely';

/**
 * Coach persona selection (coaches.md): a purely cosmetic voice/tone pick
 * for the coach agent (packages/prompts/src/coach-persona.ts) — never
 * changes chess judgment or method. All existing users default to
 * 'general', the coach exactly as it was before this column existed.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE users ADD COLUMN coach_persona text NOT NULL DEFAULT 'general'
      CHECK (coach_persona IN ('general','commander','scholar','huntress','shark','sunzi','gambler'))
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN coach_persona`.execute(db);
}
