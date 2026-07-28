import type { ReactNode } from 'react';
import { describePly } from './positionDivider.js';

export interface PositionDividerProps {
  ply: number;
  san: string;
  /** Clicking the divider jumps the board there (peek mode) — the same
   * navigation MoveExplorer offers, but from the transcript. */
  onSelect?: (ply: number) => void;
}

/** design.md §5.3: a thin centered divider marking a coach show_position jump
 * — "— move 18 (White), after bxc3 —" — so the transcript reads like an
 * annotated game. Shows standard chess move-pair notation, matching
 * MoveExplorer's paired list, not the raw ply passed to show_position. */
export function PositionDivider({ ply, san, onSelect }: PositionDividerProps): ReactNode {
  const { moveNumber, color } = describePly(ply);
  return (
    <p className="position-divider">
      —{' '}
      <button type="button" className="position-divider__jump" onClick={() => onSelect?.(ply)}>
        move {moveNumber} ({color}), after <code className="san">{san}</code>
      </button>{' '}
      —
    </p>
  );
}
