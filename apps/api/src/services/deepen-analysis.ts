import { parsePgn } from '@chess-coach/chess-analysis';
import type { PositionAnalysis } from '@chess-coach/shared';
import type { Kysely } from 'kysely';
import * as gamesRepo from '../db/repositories/games.js';
import * as positionEvaluationsRepo from '../db/repositories/position-evaluations.js';
import type { Database } from '../db/schema.js';

export interface DeepenAnalysisJobDependencies {
  /** Wraps `POST engine/analyze-position` (architecture §4). */
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
}

/** How many newly-computed positions accumulate before a batch DB write —
 * a durability checkpoint (a crash mid-job doesn't lose everything already
 * computed) and a way to keep write volume low on long games. */
const BATCH_SIZE = 10;

/**
 * Follow-up pass after the fast classify/plan pipeline (runAnalyzeGameJob,
 * services/analysis.ts): walks every ply of the game, skipping positions
 * position_evaluations already has cached (from this game or any other —
 * the table is keyed by fen alone), computes the rest via Stockfish, and
 * persists them in batches of BATCH_SIZE. Purely additive — never touches
 * analyses/classifiedMoves/the coaching plan, so a failure here can't
 * regress the fast pipeline's output.
 */
export async function runDeepenAnalysisJob(
  db: Kysely<Database>,
  deps: DeepenAnalysisJobDependencies,
  gameId: string
): Promise<void> {
  const game = await gamesRepo.findById(db, gameId);
  if (!game) throw new Error(`Game ${gameId} not found`);

  const fens = parsePgn(game.pgn).positions.map((position) => position.fen);
  const cached = await positionEvaluationsRepo.findManyByFens(db, fens);
  const uncachedFens = fens.filter((fen) => !cached.has(fen));

  let buffer: positionEvaluationsRepo.PositionEvaluationEntry[] = [];
  for (const fen of uncachedFens) {
    const analysis = await deps.analyzePosition(fen);
    buffer.push({ fen, depth: analysis.depth, multiPv: analysis.multiPv, analysis });
    if (buffer.length >= BATCH_SIZE) {
      await positionEvaluationsRepo.upsertMany(db, buffer);
      buffer = [];
    }
  }
  await positionEvaluationsRepo.upsertMany(db, buffer);
}
