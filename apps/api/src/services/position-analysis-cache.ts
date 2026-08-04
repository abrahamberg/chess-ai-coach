import type { Kysely } from 'kysely';
import type { PositionAnalysis } from '@chess-coach/shared';
import * as positionEvaluationsRepo from '../db/repositories/position-evaluations.js';
import type { Database } from '../db/schema.js';
import { analyzePositionViaEngine } from './engine-client.js';

/**
 * Cache-first position analysis: reads `position_evaluations` first, only
 * falling back to a live Stockfish call (and persisting the result) on a
 * miss. Replaces bootstrap.ts's old process-local `Map` cache — same
 * `(fen) => Promise<PositionAnalysis>` shape, but shared across every
 * user/process/game via Postgres instead of being lost on restart. This is
 * also the exact primitive the deepen-analysis background job warms ahead of
 * time, so a position it already reached resolves instantly here instead of
 * re-running Stockfish.
 */
export async function getOrComputePositionAnalysis(
  db: Kysely<Database>,
  engineUrl: string,
  fen: string
): Promise<PositionAnalysis> {
  const cached = await positionEvaluationsRepo.findByFen(db, fen);
  if (cached) {
    console.log(`position-analysis-cache: hit for ${fen}`);
    return cached;
  }

  const startedAt = Date.now();
  const analysis = await analyzePositionViaEngine(engineUrl, fen);
  console.log(`position-analysis-cache: miss for ${fen} — computed live in ${Date.now() - startedAt}ms`);
  await positionEvaluationsRepo.upsertMany(db, [
    { fen, depth: analysis.depth, multiPv: analysis.multiPv, analysis }
  ]);
  return analysis;
}
