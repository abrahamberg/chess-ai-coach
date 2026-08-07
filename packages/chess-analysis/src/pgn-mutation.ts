import { Chess } from 'chess.js';

export interface AppendedMove {
  pgn: string;
  fen: string;
  san: string;
  uci: string;
  ply: number;
}

export interface RemovedMove {
  pgn: string;
  fen: string;
}

/**
 * Applies a single SAN move to a full PGN (headers + movetext), unlike
 * applySanSequence (apply-san-sequence.ts) which replays from a bare FEN and
 * has no headers/PGN text to preserve. Uses chess.js's loadPgn + move so an
 * empty or header-only PGN (no moves yet, e.g. movetext just `*`) works the
 * same as one with existing moves.
 */
export function appendMoveToPgn(pgn: string, san: string): AppendedMove | { error: string } {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const move = tryMove(chess, san);
  if (!move) return { error: `Illegal move: ${san}` };

  return {
    pgn: chess.pgn(),
    fen: chess.fen(),
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ''}`,
    ply: chess.history().length
  };
}

/**
 * Rewinds a full PGN by one ply via chess.js's `.undo()` — a genuine
 * position rewind (legal-move generation, castling/en-passant rights, etc.
 * all revert), not just trimming the movetext string. Works even when the
 * PGN's last move ended the game (checkmate/stalemate).
 */
export function removeLastMoveFromPgn(pgn: string): RemovedMove | { error: string } {
  const chess = new Chess();
  chess.loadPgn(pgn);

  const undone = chess.undo();
  if (!undone) return { error: 'no move to undo' };

  return { pgn: chess.pgn(), fen: chess.fen() };
}

function tryMove(chess: Chess, san: string): ReturnType<Chess['move']> | null {
  try {
    return chess.move(san);
  } catch {
    return null;
  }
}
