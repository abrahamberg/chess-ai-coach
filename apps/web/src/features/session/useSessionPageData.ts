import { parsePgn, resolveSanMove } from '@chess-coach/chess-analysis';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api/client.js';
import { DEFAULT_AUTOPLAY_INTERVAL_MS } from '../board/useLineAutoplay.js';
import { useCoachChat, type CoachToolCall } from '../../hooks/useCoachChat.js';
import { useWasmEngine } from '../../hooks/useWasmEngine.js';
import { toClassifiedMoves } from './liveMoveQualities.js';
import { lastShowPositionPly, toCoachMessages } from './sessionMessages.js';
import { GameDetailSchema, ResetSessionResponseSchema, SessionDetailSchema } from './sessionPageSchemas.js';
import { useDivergedLine } from './useDivergedLine.js';
import { useLivePositions } from './useLivePositions.js';
import { useSessionBoardState, type UseSessionBoardStateResult } from './useSessionBoardState.js';

const FALLBACK_POSITION = { ply: 0, fen: '', moveSan: null, moveUci: null, mover: null };

interface PlayCoachMoveOutput {
  fen: string;
  san: string;
  ply: number;
}

interface UndoLastMoveOutput {
  fen: string;
  removedPly: number;
}

function isUndoError(output: unknown): boolean {
  return typeof output === 'object' && output !== null && 'error' in output;
}

/** Odd plies are White's (ply 1 = White's 1st move), matching
 * play-moves.ts's `applied.ply % 2 === 1 ? 'white' : 'black'`. */
function moverForPly(ply: number): 'white' | 'black' {
  return ply % 2 === 1 ? 'white' : 'black';
}

/** architecture §14: the coach's own play_coach_move tool result — same
 * board-side consequences as the student's POST /play-move (see
 * SessionBoardColumn's handlePlayMove), but the response has no moveUci of
 * its own, so it's derived from the position right before this move. */
function applyPlayCoachMove(
  boardState: UseSessionBoardStateResult,
  livePositions: ReturnType<typeof useLivePositions>,
  fenBeforeMove: string,
  output: PlayCoachMoveOutput
): void {
  const resolved = resolveSanMove(fenBeforeMove, output.san);
  const moveUci = resolved ? `${resolved.from}${resolved.to}` : null;
  livePositions.append({
    ply: output.ply,
    fen: output.fen,
    moveSan: output.san,
    moveUci,
    mover: moverForPly(output.ply)
  });
  boardState.applyServerMove(output.ply, output.fen, moveUci);
}

/** architecture §14: undo_last_move pops the game's last move — trims the
 * positions array back down rather than appending. `removedPly` names the
 * ply the game is left AT after the undo (see play-moves.ts's UndoResult),
 * not the ply that was removed. */
function applyUndoLastMove(
  boardState: UseSessionBoardStateResult,
  livePositions: ReturnType<typeof useLivePositions>,
  output: UndoLastMoveOutput
): void {
  livePositions.truncateTo(output.removedPly);
  boardState.applyServerMove(output.removedPly, output.fen);
}

/** All fetching + derived state for the session page (AGENTS.md rule 7) —
 * SessionPage itself stays a presentational composer over this. */
export function useSessionPageData(sessionId: string) {
  const navigate = useNavigate();

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: ({ signal }) => apiGet(`/api/sessions/${sessionId}`, SessionDetailSchema, signal),
    enabled: sessionId !== ''
  });

  const gameId = sessionQuery.data?.gameId;
  const gameQuery = useQuery({
    queryKey: ['game', gameId],
    queryFn: ({ signal }) => apiGet(`/api/games/${gameId}`, GameDetailSchema, signal),
    enabled: gameId !== undefined
  });

  const isPlayMode = sessionQuery.data?.mode === 'play';
  const basePositions = gameQuery.data ? parsePgn(gameQuery.data.pgn).positions : [];
  // architecture §14: play mode's positions grow move-by-move instead of
  // coming once from the (mostly-empty) PGN a fresh play game starts with.
  // Seed is withheld (undefined) until gameQuery.data actually resolves —
  // useLivePositions seeds itself exactly once, so passing `[]` while the
  // game is still loading would permanently strand the board with no
  // starting position once the real one arrives.
  const livePositions = useLivePositions(isPlayMode && gameQuery.data ? basePositions : undefined);
  const positions = isPlayMode ? livePositions.positions : basePositions;
  const classifiedMoves = gameQuery.data?.liveMoveQualities
    ? toClassifiedMoves(gameQuery.data.liveMoveQualities)
    : (gameQuery.data?.classifiedMoves ?? null);
  const sanMoves = positions.filter((position) => position.moveSan !== null).map((position) => position.moveSan as string);

  const initialPly = sessionQuery.data ? lastShowPositionPly(sessionQuery.data.messages) : undefined;
  const boardState = useSessionBoardState(positions, initialPly);
  const divergedLine = useDivergedLine();
  const [autoplayIntervalMs, setAutoplayIntervalMs] = useState(DEFAULT_AUTOPLAY_INTERVAL_MS);
  const currentRealPosition =
    positions.find((position) => position.ply === boardState.ply) ?? positions[0] ?? FALLBACK_POSITION;
  const engine = useWasmEngine();
  const initialMessages =
    sessionQuery.data && gameQuery.data ? toCoachMessages(sessionQuery.data.messages, sanMoves) : undefined;

  // Disjoint tool ownership — divergedLine owns expect_move/hypothetical_line
  // and exits on a real show_position; boardState owns show_position/
  // annotate_board — so exactly one of these ever returns a defined result.
  function handleCoachToolCall(toolCall: CoachToolCall): unknown {
    const real = { ply: currentRealPosition.ply, fen: currentRealPosition.fen };
    const hypotheticalResult = divergedLine.handleToolCall(toolCall, real);
    const boardResult = boardState.handleToolCall(toolCall);
    return boardResult ?? hypotheticalResult;
  }

  // architecture §14: play_coach_move/undo_last_move resolve mid-stream with
  // no client round-trip (see useCoachChat's onServerToolResult) — this is
  // their board-side consequence, symmetric with handlePlayMoveCommitted
  // below for the student's own move.
  function handleServerToolResult(toolName: string, output: unknown): void {
    if (toolName === 'play_coach_move') {
      applyPlayCoachMove(boardState, livePositions, currentRealPosition.fen, output as PlayCoachMoveOutput);
      return;
    }
    if (toolName === 'undo_last_move' && !isUndoError(output)) {
      applyUndoLastMove(boardState, livePositions, output as UndoLastMoveOutput);
    }
  }

  // architecture §14: the student's own move, committed via POST
  // /play-move (SessionBoardColumn) before the follow-up chat turn starts.
  function handlePlayMoveCommitted(result: { fen: string; san: string; ply: number }, uci: string): void {
    livePositions.append({
      ply: result.ply,
      fen: result.fen,
      moveSan: result.san,
      moveUci: uci,
      mover: moverForPly(result.ply)
    });
    boardState.applyServerMove(result.ply, result.fen, uci);
  }

  function peekAt(ply: number): void {
    divergedLine.exit();
    boardState.peekAt(ply);
  }

  const chat = useCoachChat(sessionId, {
    onToolCall: handleCoachToolCall,
    onServerToolResult: handleServerToolResult,
    initialMessages,
    sanMoves
  });

  // A fresh session has only the internal [session_start] marker persisted
  // at creation (coach-agent.ts) — nothing has ever triggered a model turn
  // on it, so the coach otherwise never speaks until the student does.
  const kickedOffRef = useRef(false);
  useEffect(() => {
    const messages = sessionQuery.data?.messages;
    if (!kickedOffRef.current && messages && sessionQuery.data?.status === 'active') {
      if (!messages.some((message) => message.role === 'assistant')) {
        kickedOffRef.current = true;
        void chat.kickoff();
      }
    }
  }, [sessionQuery.data, chat]);

  const resetMutation = useMutation({
    mutationFn: () => apiPost(`/api/sessions/${sessionId}/reset`, {}, ResetSessionResponseSchema),
    onSuccess: (freshSession) => navigate(`/session/${freshSession.id}`)
  });

  function handleReset(): void {
    if (window.confirm('Reset this session? This ends the current conversation and starts a fresh one for this game.')) {
      resetMutation.mutate();
    }
  }

  return {
    sessionQuery,
    gameQuery,
    sanMoves,
    positions,
    classifiedMoves,
    boardState,
    divergedLine,
    currentRealPosition,
    peekAt,
    autoplayIntervalMs,
    setAutoplayIntervalMs,
    engine,
    chat,
    handleReset,
    handlePlayMoveCommitted
  };
}
