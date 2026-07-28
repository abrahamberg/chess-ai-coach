import type { ReactNode } from 'react';
import { Chessboard, type ChessboardOptions } from 'react-chessboard';

export interface MiniBoardProps {
  fen: string;
  size: number;
  onExpand: () => void;
}

/** design.md §5.2/§6: collapsed docked board / chat-card thumbnail. Never
 * interactive — tapping it only expands, it never accepts piece drops. */
export function MiniBoard({ fen, size, onExpand }: MiniBoardProps): ReactNode {
  const options: ChessboardOptions = {
    position: fen,
    allowDragging: false
  };

  return (
    <button
      type="button"
      className="mini-board"
      style={{ width: size, height: size }}
      onClick={onExpand}
      aria-label="Expand board"
    >
      <Chessboard options={options} />
    </button>
  );
}
