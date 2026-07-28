import type { ReactNode } from 'react';
import './MoveStrip.css';

export interface MoveStripProps {
  sanMoves: string[];
  currentPly: number;
  momentPlies: number[];
  onSelect: (ply: number) => void;
}

/** design.md §5.5: horizontal move-number chip list, peek-mode navigation. */
export function MoveStrip({ sanMoves, currentPly, momentPlies, onSelect }: MoveStripProps): ReactNode {
  const momentSet = new Set(momentPlies);

  return (
    <div className="move-strip">
      {sanMoves.map((san, ply) => {
        const isCurrent = ply === currentPly;
        const isMoment = momentSet.has(ply);
        const children = [];
        if (ply % 2 === 0) {
          children.push(
            <span key={`num-${ply}`} className="move-number">
              {ply / 2 + 1}.
            </span>
          );
        }
        children.push(
          <button
            key={ply}
            type="button"
            className={isMoment ? 'moment' : undefined}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onSelect(ply)}
          >
            {san}
          </button>
        );
        return children;
      })}
    </div>
  );
}
