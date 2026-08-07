import type { Kysely } from 'kysely';
import { classifyLiveMove, type ClassifiedMove } from '@chess-coach/chess-analysis';
import type { EngineEval, PositionAnalysis } from '@chess-coach/shared';
import * as gameMoveQualitiesRepo from '../db/repositories/game-move-qualities.js';
import type { Database } from '../db/schema.js';

export interface ClassifyAndRecordMoveArgs {
  gameId: string;
  ply: number;
  moveSan: string;
  mover: 'white' | 'black';
  fenBefore: string;
  fenAfter: string;
  userColor: 'white' | 'black';
}

/**
 * Play mode's live equivalent of the batch pipeline's classifyMoves +
 * analyses.classified_moves: two engine calls (before/after the move, via
 * the cache-first `analyzePosition` dependency) feed the exact same
 * classification code path the batch pipeline uses (classifyLiveMove
 * delegates to classify.ts's private classifyMove), then the result is
 * persisted as one game_move_qualities row. Synchronous, not enqueued — the
 * feedback is needed in the very next coach turn.
 */
export async function classifyAndRecordMove(
  db: Kysely<Database>,
  analyzePosition: (fen: string) => Promise<PositionAnalysis>,
  args: ClassifyAndRecordMoveArgs
): Promise<ClassifiedMove> {
  const [analysisBefore, analysisAfter] = await Promise.all([
    analyzePosition(args.fenBefore),
    analyzePosition(args.fenAfter)
  ]);

  const classified = classifyLiveMove({
    ply: args.ply,
    moveSan: args.moveSan,
    mover: args.mover,
    fenBefore: args.fenBefore,
    evalBefore: toEngineEval(args.fenBefore, analysisBefore),
    evalAfter: toEngineEval(args.fenAfter, analysisAfter),
    userColor: args.userColor
  });

  await gameMoveQualitiesRepo.insert(db, {
    gameId: args.gameId,
    ply: classified.ply,
    moveSan: classified.moveSan,
    mover: classified.mover,
    quality: classified.quality,
    cpLoss: classified.cpLoss,
    bestLineSan: classified.bestLineSan,
    evalAfterCp: classified.evalAfterCp
  });

  return classified;
}

/** classifyLiveMove only reads `.lines` off the eval it's given — `ply` is
 * set to 0 since nothing downstream reads it here. */
function toEngineEval(fen: string, analysis: PositionAnalysis): EngineEval {
  return {
    ply: 0,
    fen,
    depth: analysis.depth,
    lines: analysis.lines.map((line) => ({
      moveUci: line.moveUci,
      moveSan: line.moveSan,
      cp: line.cp,
      mateIn: line.mateIn
    }))
  };
}
