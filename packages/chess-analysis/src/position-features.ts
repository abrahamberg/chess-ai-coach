import { Chess } from 'chess.js';
import type { PositionFeatures } from '@chess-coach/shared';
import { buildAttackMap, toColorName } from './attack-map.js';
import {
  centerControlScore,
  controlledSquares,
  hangingPieces,
  mobility,
  overloadedDefenders,
  piecesUnderAttack,
  underDefendedPieces
} from './piece-safety.js';
import { pawnStructure } from './pawn-structure.js';
import { captureOpportunities, forks, targetsAttacked } from './tactics.js';

/**
 * Pure, engine-independent static analysis of a single FEN via chess.js —
 * no Stockfish call, safe to run on every interactive position request.
 * Every sub-feature lives in its own small, independently testable module
 * (attack-map.ts, piece-safety.ts, pawn-structure.ts, tactics.ts); this just
 * assembles them.
 */
export function computePositionFeatures(fen: string): PositionFeatures {
  const chess = new Chess(fen);
  const attackMap = buildAttackMap(chess);

  return {
    turn: toColorName(chess.turn()),
    boardState: boardState(chess),
    availableMoves: chess.moves(),
    mobility: mobility(chess, attackMap),
    controlledSquares: controlledSquares(chess, attackMap),
    piecesUnderAttack: piecesUnderAttack(chess, attackMap),
    hangingPieces: hangingPieces(chess, attackMap),
    underDefendedPieces: underDefendedPieces(chess, attackMap),
    overloadedDefenders: overloadedDefenders(chess, attackMap),
    centerControlScore: centerControlScore(attackMap),
    ...pawnStructure(chess),
    targetsAttacked: targetsAttacked(chess, attackMap),
    forks: forks(chess, attackMap),
    captureOpportunities: captureOpportunities(chess, attackMap)
  };
}

function boardState(chess: Chess): PositionFeatures['boardState'] {
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isCheck()) return 'check';
  return 'none';
}
