import { moveRefToPly } from '@chess-coach/chess-analysis';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardArrow, BoardHighlight } from '../board/CoachBoard.js';
import { useAnnotationLayer, type AnnotationState } from '../board/AnnotationLayer.js';
import { useBoardDock } from '../../hooks/useBoardDock.js';
import type { CoachToolCall } from '../../hooks/useCoachChat.js';

export interface SessionPosition {
  ply: number;
  fen: string;
  moveUci?: string | null;
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
  /** True while the board is showing the position BEFORE the move currently
   * being discussed, with a red arrow for the move that was actually played
   * (universal default — not gated behind showEngineAnalysis). False once
   * revealPlayedMove() has been called, while peeking, or at the game's
   * starting position (nothing to anchor before). */
  isAnchoredPreMove: boolean;
  /** Shows the actual post-move position in place of the pre-move anchor —
   * purely a display flag, does not touch ply/coachPly/mode. */
  revealPlayedMove: () => void;
  /** Immediately reflects a locally-dropped move (react-chessboard is a
   * fully-controlled component with no optimistic state of its own — see
   * CoachBoard's onLocalMove doc comment). Superseded by the next
   * show_position or peekAt navigation, and cleared by clearPreview (undo). */
  previewMove: (fen: string) => void;
  clearPreview: () => void;
  /** Wire directly as useCoachChat's onToolCall. */
  handleToolCall: (toolCall: CoachToolCall) => unknown;
  /** Local-only move-strip/Explore navigation (design.md §5.5) — never sent
   * to the server; the next coach show_position snaps back to answer mode. */
  peekAt: (ply: number) => void;
  /** design.md §5.4: the peek-mode pill's "⟲ back to coach" action — restores
   * answer mode at the last position the coach actually set, not wherever
   * peek/Explore navigation happened to leave the board. */
  backToCoach: () => void;
  /** Clicking a chat PositionDivider while peeking and then sending a message
   * promotes the peeked position to the new coach position in place — unlike
   * backToCoach, this does not move the board back to the old coachPly. */
  anchorHere: () => void;
}

/** UCI encodes a move as `<from><to>[promotion]` (chess-analysis's parsePgn),
 * so the last move's squares are derived from position data directly — no
 * coach tool call required. */
function lastMoveHighlightsFor(moveUci: string | null | undefined): BoardHighlight[] {
  if (!moveUci) return [];
  const from = moveUci.slice(0, 2);
  const to = moveUci.slice(2, 4);
  return [
    { square: from, color: 'var(--last-move)' },
    { square: to, color: 'var(--last-move)' }
  ];
}

/** Same from/to slicing as lastMoveHighlightsFor, drawn as a red arrow
 * instead of square highlights — used while anchored one position before
 * the move being discussed (design decision: universal default, see
 * useSessionBoardState's isAnchoredPreMove). */
function playedMoveArrowFor(moveUci: string | null | undefined): BoardArrow[] {
  if (!moveUci) return [];
  return [{ from: moveUci.slice(0, 2), to: moveUci.slice(2, 4), color: 'var(--played-move)' }];
}

/**
 * Owns the board-facing consequences of the coach's tool calls (architecture
 * §7.1): show_position moves the board and auto-expands a docked mini-board
 * (design.md §5.2), clearing any prior annotations (design.md §5.4);
 * annotate_board sets arrows/highlights. Both are client tools, so their
 * return value here becomes the tool result useCoachChat posts back.
 */
export function useSessionBoardState(
  positions: SessionPosition[],
  initialPly?: number
): UseSessionBoardStateResult {
  const [ply, setPly] = useState(0);
  const [mode, setMode] = useState<BoardMode>('answer');
  const [coachPly, setCoachPly] = useState(0);
  const [previewFen, setPreviewFen] = useState<string | null>(null);
  // Universal default (not gated behind showEngineAnalysis): a fresh
  // show_position anchors the board one ply BEFORE the move being discussed,
  // with a red arrow for the move actually played — see isAnchoredPreMove.
  const [revealResult, setRevealResult] = useState(true);
  const annotations = useAnnotationLayer();
  const dock = useBoardDock();

  // initialPly arrives after the session fetch resolves (a later render, not
  // mount), so it must be seeded via effect rather than useState's initial
  // value — mirrors useCoachChat's initialMessages seeding for the same
  // reason (SessionPage.tsx).
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && initialPly !== undefined) {
      seededRef.current = true;
      setPly(initialPly);
      setCoachPly(initialPly);
      setRevealResult(initialPly === 0);
    }
  }, [initialPly]);

  const currentPosition = positions.find((position) => position.ply === ply) ?? positions[0];
  const isAnchoredPreMove = mode === 'answer' && !revealResult && ply > 0 && Boolean(currentPosition?.moveUci);
  const displayPosition = isAnchoredPreMove
    ? (positions.find((position) => position.ply === ply - 1) ?? currentPosition)
    : currentPosition;
  const fen = previewFen ?? displayPosition?.fen ?? '';
  const lastMoveHighlights = isAnchoredPreMove ? [] : lastMoveHighlightsFor(currentPosition?.moveUci);
  const playedMoveArrows = isAnchoredPreMove ? playedMoveArrowFor(currentPosition?.moveUci) : [];

  const previewMove = useCallback((newFen: string) => {
    setPreviewFen(newFen);
  }, []);

  const clearPreview = useCallback(() => {
    setPreviewFen(null);
  }, []);

  const handleToolCall = useCallback(
    (toolCall: CoachToolCall): unknown => {
      if (toolCall.toolName === 'show_position') {
        const { moveNumber, color } = toolCall.input as { moveNumber: number; color: 'white' | 'black' | null };
        const newPly = moveRefToPly(moveNumber, color);
        setPly(newPly);
        setCoachPly(newPly);
        setMode('answer');
        setPreviewFen(null);
        setRevealResult(newPly === 0);
        annotations.clear();
        dock.expand();
        return { moveNumber, color, ply: newPly };
      }
      if (toolCall.toolName === 'annotate_board') {
        annotations.setAnnotations(toolCall.input as AnnotationState);
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
    setPreviewFen(null);
  }, []);

  const backToCoach = useCallback(() => {
    setPly(coachPly);
    setMode('answer');
    setPreviewFen(null);
    // Re-anchor pre-move for the coach's position, same as a fresh
    // show_position would — not whatever reveal state peeking left behind.
    setRevealResult(coachPly === 0);
  }, [coachPly]);

  const anchorHere = useCallback(() => {
    setCoachPly(ply);
    setMode('answer');
    // The student navigated here directly (peek/move-list/drag) and already
    // saw this exact position — promoting it shouldn't suddenly swap the
    // board to one move earlier behind their back.
    setRevealResult(true);
  }, [ply]);

  const revealPlayedMove = useCallback(() => {
    setRevealResult(true);
  }, []);

  return {
    fen,
    ply,
    mode,
    setMode,
    arrows: [...playedMoveArrows, ...annotations.arrows],
    highlights: [...lastMoveHighlights, ...annotations.highlights],
    setAnnotations: annotations.setAnnotations,
    isAnchoredPreMove,
    revealPlayedMove,
    isDocked: dock.isCollapsed,
    collapseDock: dock.collapse,
    expandDock: dock.expand,
    previewMove,
    clearPreview,
    handleToolCall,
    peekAt,
    backToCoach,
    anchorHere
  };
}
