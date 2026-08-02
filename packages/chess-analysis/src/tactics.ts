import type { Chess, PieceSymbol } from 'chess.js';
import type { PositionFeatures } from '@chess-coach/shared';
import { occupiedSquares, opponentOf, toColorName, type AttackMap } from './attack-map.js';

/** Same static piece-value table classify.ts uses for its sacrifice/hangs
 * heuristics — not engine-precise, just enough for "worth more than" checks. */
const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function targetsAttacked(chess: Chess, attackMap: AttackMap): PositionFeatures['targetsAttacked'] {
  const mover = chess.turn();
  const opponent = opponentOf(mover);
  const opponentSquares = new Set(
    occupiedSquares(chess)
      .filter((piece) => piece.color === opponent)
      .map((piece) => piece.square)
  );

  const result: PositionFeatures['targetsAttacked'] = [];
  for (const piece of occupiedSquares(chess).filter((p) => p.color === mover)) {
    const controlled = attackMap.controlledBy.get(piece.square) ?? [];
    const targets = controlled.filter((square) => opponentSquares.has(square));
    if (targets.length > 0) result.push({ from: piece.square, piece: piece.type, targets });
  }
  return result;
}

/**
 * A non-king piece attacking 2+ enemy pieces at once, where at least one
 * fork victim is worth more than the forker or is undefended — otherwise
 * every double-attack (common, usually harmless) would qualify.
 */
export function forks(chess: Chess, attackMap: AttackMap): PositionFeatures['forks'] {
  const result: PositionFeatures['forks'] = [];
  for (const piece of occupiedSquares(chess)) {
    if (piece.type === 'k') continue;
    const opponent = opponentOf(piece.color);
    const controlled = attackMap.controlledBy.get(piece.square) ?? [];
    const enemyTargets = controlled.filter((square) => chess.get(square)?.color === opponent);
    if (enemyTargets.length < 2) continue;

    const forkerValue = PIECE_VALUES[piece.type];
    const qualifies = enemyTargets.some((square) => {
      const target = chess.get(square);
      if (!target) return false;
      const defenders = attackMap.attackersOf.get(square)?.[toColorName(opponent)].length ?? 0;
      return PIECE_VALUES[target.type] > forkerValue || defenders === 0;
    });
    if (qualifies) result.push({ square: piece.square, piece: piece.type, forkedSquares: enemyTargets });
  }
  return result;
}

/**
 * Legal captures for the side to move, flagged favorable when the captured
 * piece is worth at least as much as the capturer, or the destination has no
 * defenders at all. One ply deep only — like classify.ts's isSacrifice/
 * hangsPiece, this ignores X-ray/discovered recaptures through the captured
 * piece.
 */
export function captureOpportunities(chess: Chess, attackMap: AttackMap): PositionFeatures['captureOpportunities'] {
  return chess
    .moves({ verbose: true })
    .filter((move) => move.captured !== undefined)
    .map((move) => {
      const capturedPiece = move.captured as PieceSymbol;
      const capturerValue = PIECE_VALUES[move.piece];
      const capturedValue = PIECE_VALUES[capturedPiece];
      const defenders = attackMap.attackersOf.get(move.to)?.[toColorName(opponentOf(move.color))].length ?? 0;
      return {
        moveSan: move.san,
        from: move.from,
        to: move.to,
        capturedPiece,
        favorable: capturedValue >= capturerValue || defenders === 0
      };
    });
}
