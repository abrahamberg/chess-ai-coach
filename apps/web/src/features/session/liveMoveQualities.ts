import type { ClassifiedMoveDto } from '@chess-coach/shared';
import type { LiveMoveQuality } from './sessionPageSchemas.js';

/**
 * architecture §14: play mode's liveMoveQualities and analyze mode's
 * classifiedMoves render through the same EvalBar/MoveStrip/MoveExplorer
 * components (SessionBoardColumn's `classifiedMoves` prop) — this adapts
 * play mode's leaner row shape (GameMoveQualityRow, minus isUserMove/
 * hangsPiece, which nothing downstream reads) up to ClassifiedMoveDto's
 * shape so callers never need a mode branch.
 */
export function toClassifiedMoves(liveMoveQualities: LiveMoveQuality[]): ClassifiedMoveDto[] {
  return liveMoveQualities.map((row) => ({ ...row, isUserMove: false, hangsPiece: false }));
}
