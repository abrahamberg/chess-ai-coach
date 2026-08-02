import { SQUARES, type Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export type ColorName = 'white' | 'black';

export interface OccupiedSquare {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

/** square -> attacking squares, by attacker color. Built once per position and
 * shared by every feature below — 128 chess.js `attackers()` calls (2 colors
 * x 64 squares) instead of each feature re-scanning the board itself. */
export interface AttackMap {
  attackersOf: Map<Square, { white: Square[]; black: Square[] }>;
  /** Inverse of attackersOf: piece square -> squares it attacks/defends. */
  controlledBy: Map<Square, Square[]>;
}

export function buildAttackMap(chess: Chess): AttackMap {
  const attackersOf: AttackMap['attackersOf'] = new Map();
  const controlledBy: AttackMap['controlledBy'] = new Map();

  for (const square of SQUARES) {
    const white = chess.attackers(square, 'w');
    const black = chess.attackers(square, 'b');
    attackersOf.set(square, { white, black });
    for (const attacker of white) addControlled(controlledBy, attacker, square);
    for (const attacker of black) addControlled(controlledBy, attacker, square);
  }
  return { attackersOf, controlledBy };
}

function addControlled(map: Map<Square, Square[]>, from: Square, to: Square): void {
  const existing = map.get(from);
  if (existing) existing.push(to);
  else map.set(from, [to]);
}

export function toColorName(color: Color): ColorName {
  return color === 'w' ? 'white' : 'black';
}

export function opponentOf(color: Color): Color {
  return color === 'w' ? 'b' : 'w';
}

export function occupiedSquares(chess: Chess): OccupiedSquare[] {
  return chess
    .board()
    .flat()
    .filter((piece): piece is OccupiedSquare => piece !== null);
}
