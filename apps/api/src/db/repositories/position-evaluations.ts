import { sql, type Kysely } from 'kysely';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface PositionEvaluationEntry {
  fen: string;
  depth: number;
  multiPv: number;
  analysis: PositionAnalysis;
}

/** Governs the read-time trust filter (engine-backend-boundary design §7):
 * `allowExternal: false` (native-mode caller) only accepts rows computed
 * natively; `allowExternal: true` (browser-mode caller) accepts any row,
 * since a native result is always equal-or-better quality than a browser one. */
export interface ReadTrustOptions {
  allowExternal: boolean;
}

/** Governs the write-time upsert strategy (see upsertMany doc comment):
 * `isExternalEval: false` (native writer) always heals the cache;
 * `isExternalEval: true` (browser writer) never overwrites an existing row. */
export interface WriteTrustOptions {
  isExternalEval: boolean;
}

/** Single cache-first read — the live coach/eval path (bootstrap.ts's
 * analyzePosition dependency). Applies the read trust filter and, on a hit,
 * touches lastAccessedAt for LRU-based pruning (see pruneOverCap). */
export async function findByFen(
  db: Kysely<Database>,
  fen: string,
  options: ReadTrustOptions
): Promise<PositionAnalysis | undefined> {
  const row = await selectReadable(db, options)
    .select('analysis')
    .where('fen', '=', fen)
    .executeTakeFirst();
  if (!row) return undefined;

  await touchLastAccessed(db, [fen]);
  return row.analysis as PositionAnalysis;
}

/** Batch read — the deepen-analysis job's "what's already cached" check
 * before spending engine time on a game's plies. Applies the read trust
 * filter and touches lastAccessedAt for every fen that hit. */
export async function findManyByFens(
  db: Kysely<Database>,
  fens: string[],
  options: ReadTrustOptions
): Promise<Map<string, PositionAnalysis>> {
  if (fens.length === 0) return new Map();

  const rows = await selectReadable(db, options)
    .select(['fen', 'analysis'])
    .where('fen', 'in', fens)
    .execute();
  if (rows.length === 0) return new Map();

  await touchLastAccessed(db, rows.map((row) => row.fen));
  return new Map(rows.map((row) => [row.fen, row.analysis as PositionAnalysis]));
}

function selectReadable(db: Kysely<Database>, options: ReadTrustOptions) {
  const query = db.selectFrom('positionEvaluations');
  return options.allowExternal ? query : query.where('isExternalEval', '=', false);
}

function touchLastAccessed(db: Kysely<Database>, fens: string[]): Promise<void> {
  return db
    .updateTable('positionEvaluations')
    .set({ lastAccessedAt: sql<Date>`now()` })
    .where('fen', 'in', fens)
    .execute()
    .then(() => undefined);
}

/**
 * Content is a pure function of `fen` at a fixed depth/multiPv, so a
 * conflicting write is never a correction of *content* — but it can differ in
 * *trust*. Two asymmetric strategies, chosen by `options.isExternalEval`:
 *
 * - Native write (`isExternalEval: false`): `ON CONFLICT DO UPDATE` — always
 *   overwrites any existing row, healing it back to native quality even if a
 *   browser-tunnel result was there before.
 * - Browser write (`isExternalEval: true`): `ON CONFLICT DO NOTHING` — never
 *   overwrites, so an existing row (native or browser) is preserved as
 *   "at least as trustworthy" as what this write would add.
 *
 * Used both by the deepen job's batch-of-10 flush and the live single-lookup
 * path (called with a 1-element array).
 */
export async function upsertMany(
  db: Kysely<Database>,
  entries: PositionEvaluationEntry[],
  options: WriteTrustOptions
): Promise<void> {
  if (entries.length === 0) return;

  const values = entries.map((entry) => ({
    fen: entry.fen,
    depth: entry.depth,
    multiPv: entry.multiPv,
    analysis: JSON.stringify(entry.analysis),
    isExternalEval: options.isExternalEval
  }));

  if (options.isExternalEval) {
    await db
      .insertInto('positionEvaluations')
      .values(values)
      .onConflict((oc) => oc.column('fen').doNothing())
      .execute();
    return;
  }

  await db
    .insertInto('positionEvaluations')
    .values(values)
    .onConflict((oc) =>
      oc.column('fen').doUpdateSet((eb) => ({
        depth: eb.ref('excluded.depth'),
        multiPv: eb.ref('excluded.multiPv'),
        analysis: eb.ref('excluded.analysis'),
        isExternalEval: eb.ref('excluded.isExternalEval'),
        lastAccessedAt: sql<Date>`now()`
      }))
    )
    .execute();
}

export interface PruneOverCapOptions {
  /** Total row cap for the table; a no-op if the table isn't over it. */
  maxRows: number;
  /** Rows younger than this (by createdAt) are never eviction candidates,
   * even if the table is over cap — protects positions a game-import or
   * deepen-analysis pass just wrote and may re-read shortly after. */
  minAgeDays: number;
}

/**
 * LRU-style cache eviction (wired into a scheduled job in a later task): if
 * the table is over `maxRows`, deletes the least-recently-accessed rows
 * first, but only from rows old enough to clear the `minAgeDays` floor.
 * Returns the number of rows deleted.
 */
export async function pruneOverCap(db: Kysely<Database>, options: PruneOverCapOptions): Promise<number> {
  const result = await sql<{ fen: string }>`
    WITH eligible AS (
      SELECT fen
      FROM position_evaluations
      WHERE created_at < now() - make_interval(days => ${options.minAgeDays})
      ORDER BY last_accessed_at ASC
      LIMIT GREATEST((SELECT count(*)::int FROM position_evaluations) - ${options.maxRows}, 0)
    )
    DELETE FROM position_evaluations
    WHERE fen IN (SELECT fen FROM eligible)
    RETURNING fen
  `.execute(db);

  return result.rows.length;
}
