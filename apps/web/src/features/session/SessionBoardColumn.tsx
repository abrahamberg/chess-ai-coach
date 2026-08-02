import { useRef, useState, type ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { CoachBoard } from '../board/CoachBoard.js';
import { ExplorePanel } from '../board/ExplorePanel.js';
import { MiniBoard } from '../board/MiniBoard.js';
import { MoveStrip } from '../board/MoveStrip.js';
import { PositionAnalysisPanel } from '../board/PositionAnalysisPanel.js';
import type { ArrowRef } from '../chat/arrowToken.js';
import { describePly, sanForPly } from '../chat/positionDivider.js';
import type { useSessionBoardState } from './useSessionBoardState.js';
import type { useWasmEngine } from '../../hooks/useWasmEngine.js';

const UNDO_PILL_MS = 2000;

export interface SessionBoardColumnProps {
  boardState: ReturnType<typeof useSessionBoardState>;
  orientation: 'white' | 'black';
  showMiniBoard: boolean;
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[] | null | undefined;
  isDesktop: boolean;
  engine: ReturnType<typeof useWasmEngine>;
  showEngineAnalysis: boolean;
  sendMessage: (content: string) => void;
  onArrowsChange: (arrows: ArrowRef[]) => void;
}

/** The board + its overlay pills + the explore/analysis panels below it —
 * self-contained pending-move state (the 2s undo window) lives here since
 * nothing outside this column reads it. */
export function SessionBoardColumn({
  boardState,
  orientation,
  showMiniBoard,
  sanMoves,
  classifiedMoves,
  isDesktop,
  engine,
  showEngineAnalysis,
  sendMessage,
  onArrowsChange
}: SessionBoardColumnProps): ReactNode {
  const [pendingMove, setPendingMove] = useState<{ san: string; fen: string } | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleUserMove(san: string, fen: string): void {
    setPendingMove({ san, fen });
    pendingTimeoutRef.current = setTimeout(() => {
      sendMessage(`[board_move] I played ${san} (position now: ${fen})`);
      setPendingMove(null);
    }, UNDO_PILL_MS);
  }

  function handleUndoMove(): void {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    setPendingMove(null);
    boardState.clearPreview();
  }

  return (
    <div className="session-board-column">
      {showMiniBoard ? (
        <MiniBoard fen={boardState.fen} size={96} onExpand={boardState.expandDock} />
      ) : (
        <CoachBoard
          fen={boardState.fen}
          orientation={orientation}
          mode={boardState.mode}
          arrows={boardState.arrows}
          highlights={boardState.highlights}
          onUserMove={handleUserMove}
          onLocalMove={boardState.previewMove}
          onArrowsChange={onArrowsChange}
        />
      )}
      {pendingMove && (
        <p className="undo-pill">
          Sending {pendingMove.san}…{' '}
          <button type="button" onClick={handleUndoMove}>
            ↩︎ undo
          </button>
        </p>
      )}
      {boardState.mode === 'peek' && (
        <p className="peek-pill">
          exploring —{' '}
          <button type="button" onClick={boardState.backToCoach}>
            ⟲ back to coach
          </button>
        </p>
      )}
      {boardState.isAnchoredPreMove && (
        <p className="played-move-pill">
          {describePly(boardState.ply).color} played {sanForPly(sanMoves, boardState.ply)}{' '}
          <button type="button" onClick={boardState.revealPlayedMove}>
            reveal →
          </button>
        </p>
      )}
      {!isDesktop && (
        <MoveStrip
          sanMoves={sanMoves}
          classifiedMoves={classifiedMoves ?? []}
          currentPly={boardState.ply}
          momentPlies={[]}
          onSelect={boardState.peekAt}
        />
      )}
      <ExplorePanel
        fen={boardState.fen}
        mode={boardState.mode}
        onEnterPeekMode={() => boardState.setMode('peek')}
        engine={engine}
      />
      <PositionAnalysisPanel fen={boardState.fen} enabled={showEngineAnalysis} />
    </div>
  );
}
