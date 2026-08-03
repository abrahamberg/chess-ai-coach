import { parsePgn } from '@chess-coach/chess-analysis';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api/client.js';
import { DEFAULT_AUTOPLAY_INTERVAL_MS } from '../board/useLineAutoplay.js';
import { useCoachChat, type CoachToolCall } from '../../hooks/useCoachChat.js';
import { useWasmEngine } from '../../hooks/useWasmEngine.js';
import { lastShowPositionPly, toCoachMessages } from './sessionMessages.js';
import { GameDetailSchema, ResetSessionResponseSchema, SessionDetailSchema } from './sessionPageSchemas.js';
import { useDivergedLine } from './useDivergedLine.js';
import { useSessionBoardState } from './useSessionBoardState.js';

const FALLBACK_POSITION = { ply: 0, fen: '', moveSan: null, moveUci: null, mover: null };

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

  const positions = gameQuery.data ? parsePgn(gameQuery.data.pgn).positions : [];
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

  function peekAt(ply: number): void {
    divergedLine.exit();
    boardState.peekAt(ply);
  }

  const chat = useCoachChat(sessionId, { onToolCall: handleCoachToolCall, initialMessages, sanMoves });

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
    boardState,
    divergedLine,
    currentRealPosition,
    peekAt,
    autoplayIntervalMs,
    setAutoplayIntervalMs,
    engine,
    chat,
    handleReset
  };
}
