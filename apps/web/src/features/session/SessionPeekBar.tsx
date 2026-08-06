import type { ReactNode } from 'react';
import { MiniBoard } from '../board/MiniBoard.js';
import { describePly } from '../chat/positionDivider.js';
import type { BoardMode } from './useSessionBoardState.js';

const PEEK_BOARD_PX = 72;

export interface BoardContext {
  mode: BoardMode;
  ply: number;
  san: string | null;
  hasDivergedLine: boolean;
  /** The board is parked one ply before the move under discussion (the
   * "reveal →" state) — so the thumbnail is showing the position *before* it,
   * not after. */
  isAnchoredPreMove: boolean;
}

/** One line naming what the board is currently showing — the whole reason the
 * peek bar earns its space in the coach panel. */
export function boardContextLabel({ mode, ply, san, hasDivergedLine, isAnchoredPreMove }: BoardContext): string {
  if (hasDivergedLine) return 'your line';
  if (mode === 'peek') return 'exploring';
  if (ply <= 0 || !san) return 'start position';
  const { moveNumber, color } = describePly(ply);
  const move = `${moveNumber}${color === 'white' ? '.' : '…'}${san}`;
  return isAnchoredPreMove ? `before ${move}` : `after ${move}`;
}

/** True once the board is showing something worth previewing from the chat —
 * a move the coach brought up, an explored position, or the student's own
 * line. At the starting position there is nothing to preview yet. */
export function hasBoardContext({ mode, ply, hasDivergedLine }: BoardContext): boolean {
  return hasDivergedLine || mode === 'peek' || ply > 0;
}

export interface SessionPeekBarProps {
  fen: string;
  label: string;
  onShowBoard: () => void;
}

/** Mobile coach panel: a small live board thumbnail plus what it is showing,
 * so position context survives while reading, and one tap reaches the board
 * itself. */
export function SessionPeekBar({ fen, label, onShowBoard }: SessionPeekBarProps): ReactNode {
  return (
    <button type="button" className="session-peek-bar" onClick={onShowBoard} aria-label={`Show board — ${label}`}>
      <MiniBoard fen={fen} size={PEEK_BOARD_PX} />
      <span className="session-peek-bar__label">{label}</span>
      <span className="session-peek-bar__cue" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
