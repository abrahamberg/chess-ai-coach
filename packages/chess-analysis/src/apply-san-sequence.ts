import { Chess } from 'chess.js';

export interface AppliedMove {
  san: string;
  fen: string;
  uci: string;
}

export interface ApplySanSequenceResult {
  moves: AppliedMove[];
  error: string | null;
}

/**
 * Replays a sequence of SAN moves from an arbitrary starting FEN — used for
 * hypothetical/diverged lines, unlike buildPositions (pgn.ts) which only
 * ever replays a game's actual mainline. Stops at the first illegal SAN
 * instead of throwing, returning everything applied up to that point plus
 * an error describing the failure.
 */
export function applySanSequence(startFen: string, sanMoves: string[]): ApplySanSequenceResult {
  const chess = new Chess(startFen);
  const moves: AppliedMove[] = [];

  for (const san of sanMoves) {
    const move = tryMove(chess, san);
    if (!move) return { moves, error: `Illegal move: ${san}` };
    moves.push({ san: move.san, fen: chess.fen(), uci: `${move.from}${move.to}${move.promotion ?? ''}` });
  }

  return { moves, error: null };
}

function tryMove(chess: Chess, san: string): ReturnType<Chess['move']> | null {
  try {
    return chess.move(san);
  } catch {
    return null;
  }
}
