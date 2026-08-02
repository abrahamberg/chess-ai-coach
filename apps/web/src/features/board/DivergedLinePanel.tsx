import type { ReactNode } from 'react';
import { describePly } from '../chat/positionDivider.js';
import { DEFAULT_AUTOPLAY_INTERVAL_MS, useLineAutoplay } from './useLineAutoplay.js';
import './DivergedLinePanel.css';

export interface DivergedLinePanelLine {
  basePly: number;
  moves: { san: string }[];
}

export interface DivergedLinePanelProps {
  line: DivergedLinePanelLine;
  stepIndex: number;
  onSelectStep: (index: number) => void;
  onExit: () => void;
  autoplayIntervalMs: number;
  onChangeAutoplayInterval: (ms: number) => void;
}

interface DivergedPair {
  moveNumber: number;
  white?: { stepIndex: number; san: string };
  black?: { stepIndex: number; san: string };
}

function pairDivergedMoves(basePly: number, moves: { san: string }[]): DivergedPair[] {
  const pairs: DivergedPair[] = [];
  moves.forEach((move, index) => {
    const ply = basePly + index + 1;
    const { moveNumber, color } = describePly(ply);
    const stepIndex = index + 1;
    const currentPair = pairs.at(-1);
    const pair = currentPair && currentPair.moveNumber === moveNumber ? currentPair : { moveNumber };
    if (pair !== currentPair) pairs.push(pair);
    if (color === 'white') pair.white = { stepIndex, san: move.san };
    else pair.black = { stepIndex, san: move.san };
  });
  return pairs;
}

/**
 * The sidebar panel for an active hypothetical/diverged line — mounted in
 * place of MoveExplorer while one is open (SessionPage.tsx), mirroring its
 * paired move-list layout but numbered continuing from the real branch
 * point instead of from ply 0.
 */
export function DivergedLinePanel({
  line,
  stepIndex,
  onSelectStep,
  onExit,
  autoplayIntervalMs,
  onChangeAutoplayInterval
}: DivergedLinePanelProps): ReactNode {
  const { moveNumber, color } = describePly(line.basePly + 1);
  const pairs = pairDivergedMoves(line.basePly, line.moves);
  const autoplay = useLineAutoplay(line.moves.length, stepIndex, autoplayIntervalMs, onSelectStep);

  return (
    <div className="diverged-line-panel">
      <div className="diverged-line-panel__header">
        <span>
          Diverged line — from move {moveNumber} ({color})
        </span>
        <button type="button" onClick={onExit}>
          ⟲ back to game
        </button>
      </div>
      <ol className="diverged-line-panel__list">
        {pairs.map((pair) => (
          <li key={pair.moveNumber}>
            <span className="diverged-line-panel__number">{pair.moveNumber}.</span>
            {pair.white && <MoveStep {...pair.white} isCurrent={stepIndex === pair.white.stepIndex} onSelect={onSelectStep} />}
            {pair.black && <MoveStep {...pair.black} isCurrent={stepIndex === pair.black.stepIndex} onSelect={onSelectStep} />}
          </li>
        ))}
      </ol>
      <div className="diverged-line-panel__autoplay">
        <button type="button" onClick={autoplay.toggle} disabled={line.moves.length === 0}>
          {autoplay.isPlaying ? '⏸ pause' : '▶ autoplay'}
        </button>
        <label>
          interval (ms)
          <input
            type="number"
            min={100}
            step={100}
            value={autoplayIntervalMs}
            onChange={(event) => onChangeAutoplayInterval(Number(event.target.value) || DEFAULT_AUTOPLAY_INTERVAL_MS)}
          />
        </label>
      </div>
    </div>
  );
}

interface MoveStepProps {
  stepIndex: number;
  san: string;
  isCurrent: boolean;
  onSelect: (index: number) => void;
}

function MoveStep({ stepIndex, san, isCurrent, onSelect }: MoveStepProps): ReactNode {
  return (
    <button type="button" aria-current={isCurrent ? 'true' : undefined} onClick={() => onSelect(stepIndex)}>
      {san}
    </button>
  );
}
