import { useCallback, useState } from 'react';
import type { BoardArrow, BoardHighlight } from '../board/CoachBoard.js';
import { useAnnotationLayer, type AnnotationState } from '../board/AnnotationLayer.js';
import { useBoardDock } from '../../hooks/useBoardDock.js';
import type { CoachToolCall } from '../../hooks/useCoachChat.js';

export interface SessionPosition {
  ply: number;
  fen: string;
}

export type BoardMode = 'answer' | 'peek';

export interface UseSessionBoardStateResult {
  fen: string;
  ply: number;
  mode: BoardMode;
  setMode: (mode: BoardMode) => void;
  arrows: BoardArrow[];
  highlights: BoardHighlight[];
  setAnnotations: (next: AnnotationState) => void;
  isDocked: boolean;
  collapseDock: () => void;
  expandDock: () => void;
  /** Wire directly as useCoachChat's onToolCall. */
  handleToolCall: (toolCall: CoachToolCall) => unknown;
  /** Local-only move-strip/Explore navigation (design.md §5.5) — never sent
   * to the server; the next coach show_position snaps back to answer mode. */
  peekAt: (ply: number) => void;
  /** design.md §5.4: the peek-mode pill's "⟲ back to coach" action — restores
   * answer mode at the last position the coach actually set, not wherever
   * peek/Explore navigation happened to leave the board. */
  backToCoach: () => void;
}

/**
 * Owns the board-facing consequences of the coach's tool calls (architecture
 * §7.1): show_position moves the board and auto-expands a docked mini-board
 * (design.md §5.2), clearing any prior annotations (design.md §5.4);
 * annotate_board sets arrows/highlights. Both are client tools, so their
 * return value here becomes the tool result useCoachChat posts back.
 */
export function useSessionBoardState(positions: SessionPosition[]): UseSessionBoardStateResult {
  const [ply, setPly] = useState(0);
  const [mode, setMode] = useState<BoardMode>('answer');
  const [coachPly, setCoachPly] = useState(0);
  const annotations = useAnnotationLayer();
  const dock = useBoardDock();

  const fen = positions.find((position) => position.ply === ply)?.fen ?? positions[0]?.fen ?? '';

  const handleToolCall = useCallback(
    (toolCall: CoachToolCall): unknown => {
      if (toolCall.toolName === 'show_position') {
        const { ply: newPly } = toolCall.args as { ply: number };
        setPly(newPly);
        setCoachPly(newPly);
        setMode('answer');
        annotations.clear();
        dock.expand();
        return { ply: newPly };
      }
      if (toolCall.toolName === 'annotate_board') {
        annotations.setAnnotations(toolCall.args as AnnotationState);
        dock.expand();
        return { acknowledged: true };
      }
      return undefined;
    },
    [annotations, dock]
  );

  const peekAt = useCallback((newPly: number) => {
    setPly(newPly);
    setMode('peek');
  }, []);

  const backToCoach = useCallback(() => {
    setPly(coachPly);
    setMode('answer');
  }, [coachPly]);

  return {
    fen,
    ply,
    mode,
    setMode,
    arrows: annotations.arrows,
    highlights: annotations.highlights,
    setAnnotations: annotations.setAnnotations,
    isDocked: dock.isCollapsed,
    collapseDock: dock.collapse,
    expandDock: dock.expand,
    handleToolCall,
    peekAt,
    backToCoach
  };
}
