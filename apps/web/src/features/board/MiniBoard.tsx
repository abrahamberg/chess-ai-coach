import type { ReactNode } from 'react';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';

export interface MiniBoardProps {
  fen: string;
  size: number;
  /** Omit when the thumbnail sits inside another button (the chat peek bar) —
   * a button inside a button is invalid, so the wrapper owns the tap. */
  onExpand?: () => void;
}

/** design.md §5.2/§6: collapsed board thumbnail / chat-card thumbnail. Never
 * interactive — tapping it only expands, it never accepts piece drops.
 *
 * The explicit id is load-bearing, not cosmetic: react-chessboard derives its
 * DOM ids and dnd-kit registrations from it and defaults every instance to
 * "chessboard", so a thumbnail mounted alongside the full board (the mobile
 * peek bar) collides with it and renders its own pieces off-square. */
export function MiniBoard({ fen, size, onExpand }: MiniBoardProps): ReactNode {
  const options: ChessboardOptions = {
    id: 'mini-board',
    position: fen,
    allowDragging: false,
    // Also load-bearing: the file/rank labels are laid out at a fixed 13px,
    // which is taller than a square at thumbnail size — leaving them on
    // pushes every piece out of its square and off the board.
    showNotation: false
  };
  const style = { width: size, height: size };

  if (!onExpand) {
    return (
      <span className="mini-board" style={style}>
        <Chessboard options={options} />
      </span>
    );
  }

  return (
    <button type="button" className="mini-board" style={style} onClick={onExpand} aria-label="Expand board">
      <Chessboard options={options} />
    </button>
  );
}
