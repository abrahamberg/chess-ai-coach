import { useRef, useState, type ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import { CoachBoard } from '../board/CoachBoard.js';
import { DivergedLinePanel } from '../board/DivergedLinePanel.js';
import { ExplorePanel } from '../board/ExplorePanel.js';
import { MiniBoard } from '../board/MiniBoard.js';
import { MoveStrip } from '../board/MoveStrip.js';
import { PositionAnalysisPanel } from '../board/PositionAnalysisPanel.js';
import type { ArrowRef } from '../chat/arrowToken.js';
import { encodeDivergedLine } from '../chat/divergedLine.js';
import { describePly, sanForPly } from '../chat/positionDivider.js';
import type { useDivergedLine } from './useDivergedLine.js';
import type { useSessionBoardState } from './useSessionBoardState.js';
import type { useWasmEngine } from '../../hooks/useWasmEngine.js';

const UNDO_PILL_MS = 2000;

export interface SessionBoardColumnProps {
  boardState: ReturnType<typeof useSessionBoardState>;
  divergedLine: ReturnType<typeof useDivergedLine>;
  currentRealPosition: { ply: number; fen: string };
  orientation: 'white' | 'black';
  showMiniBoard: boolean;
  sanMoves: string[];
  classifiedMoves: ClassifiedMoveDto[] | null | undefined;
  isDesktop: boolean;
  engine: ReturnType<typeof useWasmEngine>;
  showEngineAnalysis: boolean;
  autoplayIntervalMs: number;
  onChangeAutoplayInterval: (ms: number) => void;
  sendMessage: (content: string) => void;
  onArrowsChange: (arrows: ArrowRef[]) => void;
}

/** The board + its overlay pills + the explore/analysis panels below it —
 * self-contained pending-move state (the 2s undo window) lives here since
 * nothing outside this column reads it. */
export function SessionBoardColumn({
  boardState,
  divergedLine,
  currentRealPosition,
  orientation,
  showMiniBoard,
  sanMoves,
  classifiedMoves,
  isDesktop,
  engine,
  showEngineAnalysis,
  autoplayIntervalMs,
  onChangeAutoplayInterval,
  sendMessage,
  onArrowsChange
}: SessionBoardColumnProps): ReactNode {
  const [pendingMove, setPendingMove] = useState<{ san: string; fen: string } | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** design.md-adjacent: expect_move (the coach's "I want exactly one move
   * as the answer" signal) preserves today's instant 2s-undo-then-send
   * path — every other answer-mode drop instead silently appends to the
   * diverged line (no send, no pill) until the student hits Send. */
  function handleUserMove(san: string, fen: string, uci: string): void {
    if (divergedLine.expectingMove) {
      setPendingMove({ san, fen });
      pendingTimeoutRef.current = setTimeout(() => {
        divergedLine.consumeExpectingMove();
        const message = divergedLine.line
          ? encodeDivergedLine(divergedLine.appendMove({ san, fen, uci }, currentRealPosition), '')
          : `[board_move] I played ${san} (position now: ${fen})`;
        sendMessage(message);
        setPendingMove(null);
      }, UNDO_PILL_MS);
      return;
    }
    divergedLine.appendMove({ san, fen, uci }, currentRealPosition);
  }

  function handleUndoMove(): void {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    setPendingMove(null);
    boardState.clearPreview();
  }

  const fen = divergedLine.fen ?? boardState.fen;

  function peekAt(ply: number): void {
    divergedLine.exit();
    boardState.peekAt(ply);
  }

  return (
    <div className="session-board-column">
      {showMiniBoard ? (
        <MiniBoard fen={fen} size={96} onExpand={boardState.expandDock} />
      ) : (
        <CoachBoard
          fen={fen}
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
      {!pendingMove && divergedLine.line && (
        <p className="undo-pill">
          <button type="button" onClick={divergedLine.undoLastMove}>
            ↩︎ undo last move
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
          onSelect={peekAt}
        />
      )}
      {!isDesktop && divergedLine.line ? (
        <DivergedLinePanel
          line={divergedLine.line}
          stepIndex={divergedLine.stepIndex}
          onSelectStep={divergedLine.previewStep}
          onExit={divergedLine.exit}
          autoplayIntervalMs={autoplayIntervalMs}
          onChangeAutoplayInterval={onChangeAutoplayInterval}
        />
      ) : (
        <ExplorePanel fen={fen} mode={boardState.mode} onEnterPeekMode={() => boardState.setMode('peek')} engine={engine} />
      )}
      <PositionAnalysisPanel fen={fen} enabled={showEngineAnalysis} />
    </div>
  );
}
