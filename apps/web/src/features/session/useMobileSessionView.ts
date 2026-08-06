import { useCallback, useEffect, useRef, useState } from 'react';

export type SessionView = 'board' | 'coach';

/** Deliberately not keyed by session id: the student's preference is about
 * how they like to work, not about one game. */
const STORAGE_KEY = 'chess-coach:session-view';

export interface UseMobileSessionViewResult {
  view: SessionView;
  showBoard: () => void;
  showCoach: () => void;
  select: (view: SessionView) => void;
  /** True when coach messages arrived while the board panel was showing;
   * clears as soon as the coach panel is on screen. */
  hasUnread: boolean;
}

function readStoredView(): SessionView {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'board' ? 'board' : 'coach';
  } catch {
    // Safari private mode throws on localStorage access.
    return 'coach';
  }
}

function storeView(view: SessionView): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Preference is a nicety — never let it break the switch itself.
  }
}

/** Which of the two mobile panels is showing, remembered across sessions,
 * plus the unread signal for the Coach tab. The hook is unconditional (hooks
 * always are); only the mobile layout consumes its result. */
export function useMobileSessionView(messageCount: number): UseMobileSessionViewResult {
  const [view, setView] = useState<SessionView>(readStoredView);
  const [seenCount, setSeenCount] = useState(messageCount);
  const hasHydratedRef = useRef(messageCount > 0);

  // Reading the coach panel is what marks messages seen — so the dot only
  // ever reports what arrived behind the student's back. The transcript
  // itself arrives one render after mount (the session fetch resolves), and
  // a whole history landing at once is not "new": it is where the student
  // left off, so it never raises the dot.
  useEffect(() => {
    if (view === 'coach' || !hasHydratedRef.current) setSeenCount(messageCount);
    if (messageCount > 0) hasHydratedRef.current = true;
  }, [view, messageCount]);

  const select = useCallback((next: SessionView) => {
    setView(next);
    storeView(next);
  }, []);

  const showBoard = useCallback(() => select('board'), [select]);
  const showCoach = useCallback(() => select('coach'), [select]);

  return { view, showBoard, showCoach, select, hasUnread: messageCount > seenCount };
}
