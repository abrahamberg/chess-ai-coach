import type { ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { MoveQualityBadge } from './MoveQualityBadge.js';
import './MoveStrip.css';

export interface MoveStripProps {
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[];
  currentPly: number;
  momentPlies: number[];
  onSelect: (ply: number) => void;
}

/** design.md §5.5: horizontal move-number chip list, peek-mode navigation.
 * Quality badges mirror MoveExplorer (design spec
 * 2026-07-29-move-quality-badges) — note ClassifiedMoveDto.ply is 1-based
 * while this component's own `ply` (the sanMoves array index, used for
 * onSelect/aria-current/moment — pre-existing convention) is 0-based, so the
 * quality lookup is offset by one. `isMoment` (from `momentPlies`), right
 * next to that same quality lookup, is NOT offset — it's checked against the
 * raw 0-based local `ply` — so a future caller wiring up `momentPlies` with
 * real 1-based ply data will find the moment dot one chip off from the
 * badge it should line up with. */
export function MoveStrip({ sanMoves, classifiedMoves, currentPly, momentPlies, onSelect }: MoveStripProps): ReactNode {
  const momentSet = new Set(momentPlies);
  const qualityByPly = new Map(classifiedMoves.map((move) => [move.ply, move.quality]));

  return (
    <div className="move-strip">
      {sanMoves.map((san, ply) => {
        const isCurrent = ply === currentPly;
        const isMoment = momentSet.has(ply);
        const quality = qualityByPly.get(ply + 1);
        const className = [isMoment ? 'moment' : null, quality ? `move-quality-${quality}` : null]
          .filter(Boolean)
          .join(' ');
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
            className={className || undefined}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onSelect(ply)}
          >
            <MoveQualityBadge quality={quality} size="sm" />
            {san}
          </button>
        );
        return children;
      })}
    </div>
  );
}
