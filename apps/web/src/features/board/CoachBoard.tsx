import { Chess } from 'chess.js';
import type { ReactNode } from 'react';
import { Chessboard, type Arrow, type ChessboardOptions, type PieceDropHandlerArgs } from 'react-chessboard';
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
  onUserMove?: (san: string, fen: string, uci: string) => void;
  /** Fired with the student's own right-click-drawn arrows (react-chessboard's
   * built-in drawing, separate from the coach-controlled `arrows` prop) —
   * design.md §5.4/§5.7: lets the composer turn a drawn arrow into an inline
   * chip the student can send. */
  onArrowsChange?: (arrows: BoardArrow[]) => void;
  /** Fired for every legal drop regardless of mode — keeps the displayed
   * position in sync with the drag immediately. react-chessboard is a fully
   * controlled component: its own internal position only updates via an
   * effect keyed on the `fen` prop, so without this the dropped piece snaps
   * back on the next render (most visible on castling, whose two-piece move
   * only animates through that same prop-driven path). Separate from
   * onUserMove, which is answer-mode-only and drives the chat side-effect —
   * peek mode must keep updating the display without notifying the coach. */
  onLocalMove?: (fen: string) => void;
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
  onUserMove,
  onLocalMove,
  onArrowsChange
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

    onLocalMove?.(chess.fen());
    if (mode === 'answer') {
      onUserMove?.(move.san, chess.fen(), `${move.from}${move.to}${move.promotion ?? ''}`);
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
    ),
    allowDrawingArrows: true,
    clearArrowsOnPositionChange: true,
    onArrowsChange: ({ arrows: drawn }: { arrows: Arrow[] }) => {
      onArrowsChange?.(drawn.map((arrow) => ({ from: arrow.startSquare, to: arrow.endSquare, color: arrow.color })));
    }
  };

  return (
    <div className={mode === 'peek' ? 'coach-board-frame coach-board-frame--peek' : 'coach-board-frame'}>
      <Chessboard options={options} />
    </div>
  );
}
