import { useState, type ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { GameEvalChart } from './GameEvalChart.js';
import { MoveQualityBadge } from './MoveQualityBadge.js';
import './MoveExplorer.css';

export interface MoveExplorerProps {
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[];
  currentPly: number;
  onSelect: (ply: number) => void;
}

interface MovePair {
  moveNumber: number;
  white: { ply: number; san: string };
  black?: { ply: number; san: string };
}

function pairMoves(sanMoves: string[]): MovePair[] {
  const pairs: MovePair[] = [];
  for (let index = 0; index < sanMoves.length; index += 2) {
    const whiteSan = sanMoves[index];
    if (whiteSan === undefined) continue;
    const blackSan = sanMoves[index + 1];
    pairs.push({
      moveNumber: index / 2 + 1,
      white: { ply: index + 1, san: whiteSan },
      black: blackSan === undefined ? undefined : { ply: index + 2, san: blackSan }
    });
  }
  return pairs;
}

/** design.md-adjacent move explorer (not yet in design.md — Daniel requested
 * a chess.com/lichess-style panel): paired move list, NAG symbols and
 * quality color-coding from the persisted classification, nav pills, and a
 * collapsible plain-language note for the current move. Sidelines/PGN
 * comments are out of scope here — parsePgn only produces a mainline. */
export function MoveExplorer({ sanMoves, classifiedMoves, currentPly, onSelect }: MoveExplorerProps): ReactNode {
  const [notesVisible, setNotesVisible] = useState(false);
  const qualityByPly = new Map(classifiedMoves.map((move) => [move.ply, move]));
  const pairs = pairMoves(sanMoves);
  const totalPlies = sanMoves.length;
  const currentMove = qualityByPly.get(currentPly);

  function goTo(ply: number): void {
    onSelect(Math.min(Math.max(ply, 0), totalPlies));
  }

  return (
    <div className="move-explorer">
      <div className="move-explorer__nav">
        <button type="button" aria-label="first move" onClick={() => goTo(0)}>
          ⏮
        </button>
        <button type="button" aria-label="previous move" onClick={() => goTo(currentPly - 1)}>
          ◀
        </button>
        <span className="move-explorer__position">
          move {currentPly} of {totalPlies}
        </span>
        <button type="button" aria-label="next move" onClick={() => goTo(currentPly + 1)}>
          ▶
        </button>
        <button type="button" aria-label="last move" onClick={() => goTo(totalPlies)}>
          ⏭
        </button>
      </div>
      <button
        type="button"
        className="move-explorer__notes-toggle"
        aria-pressed={notesVisible}
        onClick={() => setNotesVisible((visible) => !visible)}
      >
        {notesVisible ? 'Hide notes' : 'Show notes'}
      </button>
      <ol className="move-explorer__list">
        {pairs.map((pair) => (
          <li key={pair.moveNumber}>
            <span className="move-explorer__number">{pair.moveNumber}.</span>
            <MoveCell ply={pair.white.ply} san={pair.white.san} quality={qualityByPly.get(pair.white.ply)?.quality} isCurrent={currentPly === pair.white.ply} onSelect={onSelect} />
            {pair.black && (
              <MoveCell ply={pair.black.ply} san={pair.black.san} quality={qualityByPly.get(pair.black.ply)?.quality} isCurrent={currentPly === pair.black.ply} onSelect={onSelect} />
            )}
          </li>
        ))}
      </ol>
      {notesVisible &&
        currentMove &&
        currentMove.quality !== 'good' &&
        currentMove.quality !== 'best' &&
        currentMove.bestLineSan.length > 0 && (
          <p className="move-explorer__note">
            {currentMove.quality}: better was {currentMove.bestLineSan.join(' ')}
          </p>
        )}
      <GameEvalChart classifiedMoves={classifiedMoves} currentPly={currentPly} onSelect={onSelect} />
    </div>
  );
}

interface MoveCellProps {
  ply: number;
  san: string;
  quality: ClassifiedMoveDto['quality'] | undefined;
  isCurrent: boolean;
  onSelect: (ply: number) => void;
}

function MoveCell({ ply, san, quality, isCurrent, onSelect }: MoveCellProps): ReactNode {
  return (
    <button
      type="button"
      className={quality ? `move-quality-${quality}` : undefined}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={() => onSelect(ply)}
    >
      <MoveQualityBadge quality={quality} size="md" />
      {san}
    </button>
  );
}
