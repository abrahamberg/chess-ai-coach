import { sql, type Kysely } from 'kysely';

/**
 * Cache correctness tracking for position_evaluations (engine-backend-boundary
 * design doc, §7-8):
 *
 * - `is_external_eval`: distinguishes browser-computed rows from native ones,
 *   so a native-mode reader never silently trusts browser compute as
 *   authoritative. Native writes always heal a row back to `false`; browser
 *   writes never overwrite an existing row (see the repository rewrite).
 * - `last_accessed_at`: touched on every cache-hit read, backing the
 *   LRU-style eviction job added in a later task — the table has had no
 *   TTL/row cap since it was introduced.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE position_evaluations
      ADD COLUMN is_external_eval boolean NOT NULL DEFAULT false,
      ADD COLUMN last_accessed_at timestamptz NOT NULL DEFAULT now()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE position_evaluations
      DROP COLUMN is_external_eval,
      DROP COLUMN last_accessed_at
  `.execute(db);
}
