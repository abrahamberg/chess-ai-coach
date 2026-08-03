import { Chess } from 'chess.js';

export interface ResolvedMove {
  from: string;
  to: string;
}

/**
 * Resolves a single SAN move (e.g. "Nf3", "Rxd5", "O-O") against a FEN to the
 * squares it moves between — used to turn a move the coach mentions in prose
 * into a hoverable board reference. Returns null for anything illegal or
 * malformed in that position rather than throwing, since callers are parsing
 * free-text LLM output that may not always be a legal move from the position
 * currently on screen.
 */
export function resolveSanMove(fen: string, san: string): ResolvedMove | null {
  try {
    const chess = new Chess(fen);
    const move = chess.move(san);
    if (!move) return null;
    return { from: move.from, to: move.to };
  } catch {
    return null;
  }
}
