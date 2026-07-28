import { useCallback, useState } from 'react';

export interface UseBoardDockResult {
  isCollapsed: boolean;
  collapse: () => void;
  expand: () => void;
}

/** design.md §5.2 (mobile): the board docks to a 96px mini-board when the
 * student scrolls the chat up, and expands again on tap or whenever the coach
 * calls show_position/annotate_board. Pure UI state — callers decide when to
 * call collapse()/expand() (ChatPane's scroll handler, useCoachChat's
 * onToolCall, a tap handler). */
export function useBoardDock(): UseBoardDockResult {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const collapse = useCallback(() => setIsCollapsed(true), []);
  const expand = useCallback(() => setIsCollapsed(false), []);

  return { isCollapsed, collapse, expand };
}
