import { useState, type ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { GameEvalChart } from './GameEvalChart.js';
import { MoveAnalysisModal } from './MoveAnalysisModal.js';
import { MoveQualityBadge } from './MoveQualityBadge.js';
import './MoveExplorer.css';

export interface MoveExplorerProps {
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[];
  /** ply-indexed positions (ply 0 = game start) — only `.ply`/`.fen` are
   * read, used to look up the fen for the move analysis inspector modal. */
  positions: { ply: number; fen: string }[];
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
export function MoveExplorer({ sanMoves, classifiedMoves, positions, currentPly, onSelect }: MoveExplorerProps): ReactNode {
  const [notesVisible, setNotesVisible] = useState(false);
  const [inspecting, setInspecting] = useState<{ fen: string; label: string } | null>(null);
  const qualityByPly = new Map(classifiedMoves.map((move) => [move.ply, move]));
  const fenByPly = new Map(positions.map((position) => [position.ply, position.fen]));
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
        {pairs.map((pair) => {
          const { moveNumber, white, black } = pair;
          const whiteFen = fenByPly.get(white.ply);
          const blackFen = black ? fenByPly.get(black.ply) : undefined;
          return (
            <li key={moveNumber}>
              <span className="move-explorer__number">{moveNumber}.</span>
              <MoveCell
                ply={white.ply}
                san={white.san}
                quality={qualityByPly.get(white.ply)?.quality}
                isCurrent={currentPly === white.ply}
                onSelect={onSelect}
                onInspect={whiteFen ? () => setInspecting({ fen: whiteFen, label: `${moveNumber}. ${white.san}` }) : undefined}
              />
              {black && (
                <MoveCell
                  ply={black.ply}
                  san={black.san}
                  quality={qualityByPly.get(black.ply)?.quality}
                  isCurrent={currentPly === black.ply}
                  onSelect={onSelect}
                  onInspect={blackFen ? () => setInspecting({ fen: blackFen, label: `${moveNumber}... ${black.san}` }) : undefined}
                />
              )}
            </li>
          );
        })}
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
      {inspecting && (
        <MoveAnalysisModal fen={inspecting.fen} moveLabel={inspecting.label} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
}

interface MoveCellProps {
  ply: number;
  san: string;
  quality: ClassifiedMoveDto['quality'] | undefined;
  isCurrent: boolean;
  onSelect: (ply: number) => void;
  /** Opens the move-analysis inspector for this move's position; undefined
   * when the fen isn't known yet (shouldn't happen once positions load, but
   * keeps the right-click a no-op instead of throwing). */
  onInspect: (() => void) | undefined;
}

function MoveCell({ ply, san, quality, isCurrent, onSelect, onInspect }: MoveCellProps): ReactNode {
  return (
    <button
      type="button"
      className={quality ? `move-quality-${quality}` : undefined}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={() => onSelect(ply)}
      onContextMenu={(event) => {
        if (!onInspect) return;
        event.preventDefault();
        onInspect();
      }}
    >
      <MoveQualityBadge quality={quality} size="md" />
      {san}
    </button>
  );
}
