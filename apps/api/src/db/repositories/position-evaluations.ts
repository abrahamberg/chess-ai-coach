import type { Kysely } from 'kysely';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Database } from '../schema.js';

export interface PositionEvaluationEntry {
  fen: string;
  depth: number;
  multiPv: number;
  analysis: PositionAnalysis;
}

/** Single cache-first read — the live coach/eval path (bootstrap.ts's
 * analyzePosition dependency). */
export function findByFen(db: Kysely<Database>, fen: string): Promise<PositionAnalysis | undefined> {
  return db
    .selectFrom('positionEvaluations')
    .select('analysis')
    .where('fen', '=', fen)
    .executeTakeFirst()
    .then((row) => row?.analysis as PositionAnalysis | undefined);
}

/** Batch read — the deepen-analysis job's "what's already cached" check
 * before spending engine time on a game's plies. */
export async function findManyByFens(
  db: Kysely<Database>,
  fens: string[]
): Promise<Map<string, PositionAnalysis>> {
  if (fens.length === 0) return new Map();
  const rows = await db
    .selectFrom('positionEvaluations')
    .select(['fen', 'analysis'])
    .where('fen', 'in', fens)
    .execute();
  return new Map(rows.map((row) => [row.fen, row.analysis as PositionAnalysis]));
}

/** Content is a pure function of `fen` at a fixed depth/multiPv, so a
 * conflicting write is always redundant, never a correction — used both by
 * the deepen job's batch-of-10 flush and the live single-lookup path
 * (called with a 1-element array). */
export async function upsertMany(db: Kysely<Database>, entries: PositionEvaluationEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await db
    .insertInto('positionEvaluations')
    .values(
      entries.map((entry) => ({
        fen: entry.fen,
        depth: entry.depth,
        multiPv: entry.multiPv,
        analysis: JSON.stringify(entry.analysis)
      }))
    )
    .onConflict((oc) => oc.column('fen').doNothing())
    .execute();
}
