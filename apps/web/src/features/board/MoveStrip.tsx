import { useState, type ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { useLongPress } from '../../hooks/useLongPress.js';
import { MoveAnalysisModal } from './MoveAnalysisModal.js';
import { MoveQualityBadge } from './MoveQualityBadge.js';
import './MoveStrip.css';

export interface MoveStripProps {
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[];
  /** ply-indexed positions (ply 0 = game start) — used, offset by one like
   * the quality lookup below, for the move analysis inspector's fen. */
  positions: { ply: number; fen: string }[];
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
export function MoveStrip({ sanMoves, classifiedMoves, positions, currentPly, momentPlies, onSelect }: MoveStripProps): ReactNode {
  const [inspecting, setInspecting] = useState<{ fen: string; label: string } | null>(null);
  const momentSet = new Set(momentPlies);
  const qualityByPly = new Map(classifiedMoves.map((move) => [move.ply, move.quality]));
  const fenByPly = new Map(positions.map((position) => [position.ply, position.fen]));

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
        const fen = fenByPly.get(ply + 1);
        const label = `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'} ${san}`;
        children.push(
          <MoveChip
            key={ply}
            ply={ply}
            san={san}
            className={className || undefined}
            isCurrent={isCurrent}
            quality={quality}
            onSelect={onSelect}
            onInspect={fen ? () => setInspecting({ fen, label }) : undefined}
          />
        );
        return children;
      })}
      {inspecting && (
        <MoveAnalysisModal fen={inspecting.fen} moveLabel={inspecting.label} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
}

interface MoveChipProps {
  ply: number;
  san: string;
  className: string | undefined;
  isCurrent: boolean;
  quality: ClassifiedMoveDto['quality'] | undefined;
  onSelect: (ply: number) => void;
  /** Opens the move-analysis inspector on long-press; undefined when the
   * fen isn't known yet, so a press is a no-op instead of throwing. */
  onInspect: (() => void) | undefined;
}

/** There's no native long-press event and no right-click on touch, so this
 * is the mobile equivalent of MoveExplorer's onContextMenu — press and hold
 * (useLongPress) opens the same inspector modal. */
function MoveChip({ ply, san, className, isCurrent, quality, onSelect, onInspect }: MoveChipProps): ReactNode {
  const longPress = useLongPress(onInspect ?? (() => {}));

  return (
    <button
      type="button"
      className={className}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={() => onSelect(ply)}
      onContextMenu={(event) => {
        if (!onInspect) return;
        event.preventDefault();
        onInspect();
      }}
      {...longPress}
    >
      <MoveQualityBadge quality={quality} size="sm" />
      {san}
    </button>
  );
}
