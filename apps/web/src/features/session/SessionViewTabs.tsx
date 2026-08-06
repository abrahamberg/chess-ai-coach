import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { SessionView } from './useMobileSessionView.js';

export const TAB_IDS: Record<SessionView, string> = { board: 'session-tab-board', coach: 'session-tab-coach' };
export const PANEL_IDS: Record<SessionView, string> = { board: 'session-panel-board', coach: 'session-panel-coach' };

export interface SessionViewTabsProps {
  view: SessionView;
  onSelect: (view: SessionView) => void;
  hasUnread: boolean;
}

/** The mobile session's two-view switch: Board and Coach are two views of the
 * same game, so a segmented control (not bottom navigation, which is for
 * top-level destinations). The indicator behind the labels is positioned from
 * --session-view-progress, the same value the panel track uses, so it tracks
 * a swipe as it happens instead of jumping after it. */
export function SessionViewTabs({ view, onSelect, hasUnread }: SessionViewTabsProps): ReactNode {
  const boardTabRef = useRef<HTMLButtonElement>(null);
  const coachTabRef = useRef<HTMLButtonElement>(null);

  function moveTo(next: SessionView): void {
    onSelect(next);
    (next === 'board' ? boardTabRef : coachTabRef).current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'ArrowRight') return moveTo('coach');
    if (event.key === 'ArrowLeft') return moveTo('board');
  }

  return (
    <div className="session-view-tabs" role="tablist" aria-label="Session view" onKeyDown={handleKeyDown}>
      <span className="session-view-tabs__indicator" aria-hidden="true" />
      <button
        ref={boardTabRef}
        type="button"
        role="tab"
        id={TAB_IDS.board}
        aria-selected={view === 'board'}
        aria-controls={PANEL_IDS.board}
        tabIndex={view === 'board' ? 0 : -1}
        onClick={() => onSelect('board')}
      >
        Board
      </button>
      <button
        ref={coachTabRef}
        type="button"
        role="tab"
        id={TAB_IDS.coach}
        aria-selected={view === 'coach'}
        aria-controls={PANEL_IDS.coach}
        tabIndex={view === 'coach' ? 0 : -1}
        onClick={() => onSelect('coach')}
      >
        Coach
        {hasUnread && (
          <>
            <span className="session-view-tabs__dot" aria-hidden="true" />
            <span className="visually-hidden">new message</span>
          </>
        )}
      </button>
    </div>
  );
}
