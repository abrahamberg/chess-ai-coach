import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useHorizontalSwipe } from '../../hooks/useHorizontalSwipe.js';
import { boardContextLabel, hasBoardContext, SessionPeekBar, type BoardContext } from './SessionPeekBar.js';
import { PANEL_IDS, SessionViewTabs, TAB_IDS } from './SessionViewTabs.js';
import type { SessionView, UseMobileSessionViewResult } from './useMobileSessionView.js';

/** Piece dragging owns the board and the move strip owns its own horizontal
 * scroll; a drag anywhere else switches panels. */
const SWIPE_RESERVED_SELECTOR = '.coach-board-frame, .move-strip';

export interface MobileSessionBodyProps {
  board: ReactNode;
  chat: ReactNode;
  /** The position on the board right now — drawn in the coach panel's peek. */
  fen: string;
  boardContext: BoardContext;
  viewState: UseMobileSessionViewResult;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function progressFor(view: SessionView, dragPx: number, width: number): number {
  const base = view === 'coach' ? 1 : 0;
  if (dragPx === 0 || width === 0) return base;
  return clampProgress(base - dragPx / width);
}

/** Below the side-by-side breakpoint the board and the coach each own the
 * full screen, switched by the segmented control or a horizontal swipe. Both
 * panels stay mounted and laid out side by side inside the track — hiding one
 * with `display: none` would remount nothing but would zero its height, which
 * silently breaks the chat's scroll-to-bottom and the board's sizing. */
export function MobileSessionBody({ board, chat, fen, boardContext, viewState }: MobileSessionBodyProps): ReactNode {
  const { view, select, showBoard, showCoach, hasUnread } = viewState;
  const viewportRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const [dragPx, setDragPx] = useState(0);

  const handleDrag = useCallback((dx: number) => {
    if (dx === 0) widthRef.current = 0;
    else if (widthRef.current === 0) widthRef.current = viewportRef.current?.offsetWidth ?? 0;
    setDragPx(dx);
  }, []);

  const swipeHandlers = useHorizontalSwipe({
    onSwipeLeft: showCoach,
    onSwipeRight: showBoard,
    reservedSelector: SWIPE_RESERVED_SELECTOR,
    onDrag: handleDrag
  });

  const progress = progressFor(view, dragPx, widthRef.current);
  const style = { '--session-view-progress': progress } as CSSProperties;

  return (
    <div
      className="session-body mobile"
      style={style}
      data-view={view}
      data-dragging={dragPx === 0 ? undefined : 'true'}
    >
      <SessionViewTabs view={view} onSelect={select} hasUnread={hasUnread} />
      <div className="session-views" ref={viewportRef} {...swipeHandlers}>
        <div className="session-views__track">
          <section
            className="session-view"
            id={PANEL_IDS.board}
            role="tabpanel"
            aria-labelledby={TAB_IDS.board}
            aria-hidden={view !== 'board'}
            inert={view !== 'board'}
          >
            {board}
          </section>
          <section
            className="session-view"
            id={PANEL_IDS.coach}
            role="tabpanel"
            aria-labelledby={TAB_IDS.coach}
            aria-hidden={view !== 'coach'}
            inert={view !== 'coach'}
          >
            {hasBoardContext(boardContext) && (
              <SessionPeekBar fen={fen} label={boardContextLabel(boardContext)} onShowBoard={showBoard} />
            )}
            {chat}
          </section>
        </div>
      </div>
    </div>
  );
}
