import type { ReactNode } from 'react';
import { describePly } from './positionDivider.js';
import { formatDivergedSanSequence } from './divergedLine.js';

export interface DivergedLineStartProps {
  basePly: number;
  sanMoves: string[];
}

/** Announces a coach-initiated hypothetical_line — "↳ hypothetical from
 * move 13 (black): 13...a3 14.f6" — analogous to PositionDivider marking a
 * show_position jump, but for a line that doesn't exist in the real game.
 * A transcript record only; the interactive line lives in the Diverged Line
 * sidebar panel while it's active. */
export function DivergedLineStart({ basePly, sanMoves }: DivergedLineStartProps): ReactNode {
  const { moveNumber, color } = describePly(basePly + 1);
  const sanText = formatDivergedSanSequence(
    basePly,
    sanMoves.map((san) => ({ san }))
  );
  return (
    <p className="diverged-line-start">
      ↳ hypothetical from move {moveNumber} ({color}): <code className="san">{sanText}</code>
    </p>
  );
}
