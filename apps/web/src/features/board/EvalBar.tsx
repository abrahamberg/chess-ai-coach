import type { CSSProperties, ReactNode } from 'react';
import { expectedPoints } from '@chess-coach/chess-analysis';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import './EvalBar.css';

export interface EvalBarProps {
  ply: number;
  classifiedMoves: ClassifiedMoveDto[];
  orientation: 'white' | 'black';
}

/** lichess/chess.com-style vertical evaluation bar next to the board. Reads
 * straight from classifiedMoves (already loaded with the game, white-
 * perspective cp, mate pre-clamped to +-1000 — see classify.ts), so it needs
 * no fetch of its own: ply 0 has no classified move yet and defaults to an
 * even 0cp start. Presentational only (AGENTS.md rule 7) — the parent owns
 * which ply/classifiedMoves to pass in. */
export function EvalBar({ ply, classifiedMoves, orientation }: EvalBarProps): ReactNode {
  const cp = classifiedMoves.find((move) => move.ply === ply)?.evalAfterCp ?? 0;
  const whitePercent = expectedPoints(cp) * 100;
  // The white-fill segment tracks the board flip: white's pieces sit at the
  // bottom when orientation is 'white' (unflipped), at the top when it's
  // 'black' (flipped) — so the bar always fills from whichever edge white
  // actually occupies.
  const fillStyle: CSSProperties =
    orientation === 'white'
      ? { height: `${whitePercent}%`, bottom: 0 }
      : { height: `${whitePercent}%`, top: 0 };

  return (
    <div className="eval-bar-wrap">
      <div className="eval-bar" aria-label={`Evaluation: ${formatEval(cp)}`}>
        <div className="eval-bar__fill" style={fillStyle} />
      </div>
      <span className="eval-bar__label">{formatEval(cp)}</span>
    </div>
  );
}

function formatEval(cp: number): string {
  const pawns = cp / 100;
  return pawns > 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
}
