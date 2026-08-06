import { useRef, useState, type ReactNode } from 'react';
import type { ClassifiedMoveDto } from '@chess-coach/shared';
import type { HoverMove } from '../chat/MessageList.js';
import { CoachBoard, type BoardArrow, type BoardHighlight } from '../board/CoachBoard.js';
import { DivergedLinePanel } from '../board/DivergedLinePanel.js';
import { EvalBar } from '../board/EvalBar.js';
import { ExplorePanel } from '../board/ExplorePanel.js';
import { MoveStrip } from '../board/MoveStrip.js';
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
  sanMoves: string[];
  /** ply-indexed positions (ply 0 = game start) — threaded through to
   * MoveStrip for the move analysis inspector's fen lookup. */
  positions: { ply: number; fen: string }[];
  classifiedMoves: ClassifiedMoveDto[] | null | undefined;
  isDesktop: boolean;
  engine: ReturnType<typeof useWasmEngine>;
  autoplayIntervalMs: number;
  onChangeAutoplayInterval: (ms: number) => void;
  sendMessage: (content: string) => void;
  onArrowsChange: (arrows: ArrowRef[]) => void;
  /** The move currently hovered/focused in the chat transcript (design.md
   * §5.3) — drawn on top of the coach's own annotate_board arrows/highlights
   * in a distinct color, cleared on mouse-leave/blur. */
  hoverMove?: HoverMove;
}

/** Distinct from the coach's own annotate_board arrows (--annotate-1) and
 * the last-played-move highlight — a third color reserved for previewing a
 * move mentioned in chat text, design.md §5.3. */
function hoverMoveArrowsFor(hoverMove: HoverMove | undefined): BoardArrow[] {
  if (!hoverMove) return [];
  return [{ from: hoverMove.from, to: hoverMove.to, color: 'var(--annotate-hover)' }];
}

function hoverMoveHighlightsFor(hoverMove: HoverMove | undefined): BoardHighlight[] {
  if (!hoverMove) return [];
  return [
    { square: hoverMove.from, color: 'var(--annotate-hover)' },
    { square: hoverMove.to, color: 'var(--annotate-hover)' }
  ];
}

/** The board + its overlay pills + the explore/analysis panels below it —
 * self-contained pending-move state (the 2s undo window) lives here since
 * nothing outside this column reads it. */
export function SessionBoardColumn({
  boardState,
  divergedLine,
  currentRealPosition,
  orientation,
  sanMoves,
  positions,
  classifiedMoves,
  isDesktop,
  engine,
  autoplayIntervalMs,
  onChangeAutoplayInterval,
  sendMessage,
  onArrowsChange,
  hoverMove
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
      <div className="session-board-row">
        <EvalBar ply={boardState.ply} classifiedMoves={classifiedMoves ?? []} orientation={orientation} />
        <CoachBoard
          fen={fen}
          orientation={orientation}
          mode={boardState.mode}
          arrows={[...boardState.arrows, ...hoverMoveArrowsFor(hoverMove)]}
          highlights={[...boardState.highlights, ...hoverMoveHighlightsFor(hoverMove)]}
          onUserMove={handleUserMove}
          onLocalMove={boardState.previewMove}
          onArrowsChange={onArrowsChange}
        />
      </div>
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
          positions={positions}
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
    </div>
  );
}
