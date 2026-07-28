import { Chess } from 'chess.js';
import type { ReactNode } from 'react';
import { Chessboard, type ChessboardOptions, type PieceDropHandlerArgs } from 'react-chessboard';
import './CoachBoard.css';

export interface BoardArrow {
  from: string;
  to: string;
  color: string;
}

export interface BoardHighlight {
  square: string;
  color: string;
}

export interface CoachBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** design.md §5.4: answer mode sends the move as [board_move]; peek mode
   * (move strip / Explore) never sends anything, purely local exploration. */
  mode: 'answer' | 'peek';
  arrows?: BoardArrow[];
  highlights?: BoardHighlight[];
  onUserMove?: (san: string, fen: string) => void;
}

/** Presentational react-chessboard wrapper (AGENTS.md rule 7) — no fetching,
 * no session/turn logic. The parent decides what "answer mode" means (send
 * [board_move], show the undo pill) from onUserMove. */
export function CoachBoard({
  fen,
  orientation,
  mode,
  arrows = [],
  highlights = [],
  onUserMove
}: CoachBoardProps): ReactNode {
  function handlePieceDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;

    const chess = new Chess(fen);
    let move;
    try {
      move = chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
    } catch {
      return false;
    }
    if (!move) return false;

    if (mode === 'answer') {
      onUserMove?.(move.san, chess.fen());
    }
    return true;
  }

  const options: ChessboardOptions = {
    position: fen,
    boardOrientation: orientation,
    onPieceDrop: handlePieceDrop,
    arrows: arrows.map((arrow) => ({ startSquare: arrow.from, endSquare: arrow.to, color: arrow.color })),
    squareStyles: Object.fromEntries(
      highlights.map((highlight) => [highlight.square, { backgroundColor: highlight.color }])
    )
  };

  return (
    <div className={mode === 'peek' ? 'coach-board-frame coach-board-frame--peek' : 'coach-board-frame'}>
      <Chessboard options={options} />
    </div>
  );
}
