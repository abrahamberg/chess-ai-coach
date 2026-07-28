import type { ReactNode } from 'react';

export interface PositionDividerProps {
  ply: number;
  san: string;
}

/** design.md §5.3: a thin centered divider marking a coach show_position jump
 * — "— move 14, after Bg4 —" — so the transcript reads like an annotated game. */
export function PositionDivider({ ply, san }: PositionDividerProps): ReactNode {
  return (
    <p className="position-divider">
      — move {ply}, after <code className="san">{san}</code> —
    </p>
  );
}
