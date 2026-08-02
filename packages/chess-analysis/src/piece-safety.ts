import type { Chess, PieceSymbol, Square } from 'chess.js';
import type { PositionFeatures } from '@chess-coach/shared';
import { occupiedSquares, opponentOf, toColorName, type AttackMap, type ColorName } from './attack-map.js';

const CENTER_SQUARES: Square[] = ['d4', 'd5', 'e4', 'e5'];

/**
 * Total squares each side's pieces attack/defend (summed per piece, overlaps
 * counted once per piece) — an attack-based "how active are your pieces"
 * metric, not a legal-move count. A true legal-move count for the side NOT
 * on move isn't a well-defined chess concept (it depends on whose turn it
 * is, e.g. when the side to move is in check), so both sides are scored the
 * same attack-based way for consistency.
 */
export function mobility(chess: Chess, attackMap: AttackMap): PositionFeatures['mobility'] {
  let white = 0;
  let black = 0;
  for (const piece of occupiedSquares(chess)) {
    const count = attackMap.controlledBy.get(piece.square)?.length ?? 0;
    if (piece.color === 'w') white += count;
    else black += count;
  }
  return { white, black };
}

export function controlledSquares(chess: Chess, attackMap: AttackMap): PositionFeatures['controlledSquares'] {
  return occupiedSquares(chess).map((piece) => ({
    square: piece.square,
    piece: piece.type,
    color: toColorName(piece.color),
    squares: attackMap.controlledBy.get(piece.square) ?? []
  }));
}

interface AttackedPieceInfo {
  square: Square;
  piece: PieceSymbol;
  color: ColorName;
  attackers: number;
  defenders: number;
}

/** Every occupied square with attackers > 0, and its attacker/defender
 * counts — the shared basis for piecesUnderAttack/hangingPieces/
 * underDefendedPieces/overloadedDefenders below. */
function attackedPieceInfos(chess: Chess, attackMap: AttackMap): AttackedPieceInfo[] {
  const infos: AttackedPieceInfo[] = [];
  for (const piece of occupiedSquares(chess)) {
    const entry = attackMap.attackersOf.get(piece.square);
    if (!entry) continue;
    const attackerColor = toColorName(opponentOf(piece.color));
    const defenderColor = toColorName(piece.color);
    const attackers = entry[attackerColor].length;
    if (attackers === 0) continue;
    infos.push({
      square: piece.square,
      piece: piece.type,
      color: toColorName(piece.color),
      attackers,
      defenders: entry[defenderColor].length
    });
  }
  return infos;
}

export function piecesUnderAttack(chess: Chess, attackMap: AttackMap): PositionFeatures['piecesUnderAttack'] {
  return attackedPieceInfos(chess, attackMap);
}

export function hangingPieces(chess: Chess, attackMap: AttackMap): PositionFeatures['hangingPieces'] {
  return attackedPieceInfos(chess, attackMap).filter((info) => info.defenders === 0);
}

/** Attacked more times than defended, but not fully hanging (defenders > 0)
 * — hangingPieces already owns the zero-defenders case, so the two lists
 * never overlap. */
export function underDefendedPieces(chess: Chess, attackMap: AttackMap): PositionFeatures['underDefendedPieces'] {
  return attackedPieceInfos(chess, attackMap).filter((info) => info.defenders > 0 && info.attackers > info.defenders);
}

/** A defender that is the SOLE defender of 2+ attacked pieces. */
export function overloadedDefenders(chess: Chess, attackMap: AttackMap): PositionFeatures['overloadedDefenders'] {
  const soleDefenderOf = new Map<Square, Square[]>();
  for (const info of attackedPieceInfos(chess, attackMap)) {
    const entry = attackMap.attackersOf.get(info.square);
    const defenders = entry?.[info.color] ?? [];
    if (defenders.length !== 1) continue;
    const [defender] = defenders;
    if (!defender) continue;
    const defending = soleDefenderOf.get(defender);
    if (defending) defending.push(info.square);
    else soleDefenderOf.set(defender, [info.square]);
  }
  return Array.from(soleDefenderOf.entries())
    .filter(([, defending]) => defending.length >= 2)
    .map(([square, defending]) => ({ square, defending }));
}

export function centerControlScore(attackMap: AttackMap): PositionFeatures['centerControlScore'] {
  let white = 0;
  let black = 0;
  for (const square of CENTER_SQUARES) {
    const entry = attackMap.attackersOf.get(square);
    if (!entry) continue;
    white += entry.white.length;
    black += entry.black.length;
  }
  return { white, black };
}
