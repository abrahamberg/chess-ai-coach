import { parsePgn } from '@chess-coach/chess-analysis';
import { UserProfileSchema } from '@chess-coach/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api/client.js';
import { useCoachChat } from '../../hooks/useCoachChat.js';
import { useWasmEngine } from '../../hooks/useWasmEngine.js';
import { lastShowPositionPly, toCoachMessages } from './sessionMessages.js';
import { GameDetailSchema, ResetSessionResponseSchema, SessionDetailSchema } from './sessionPageSchemas.js';
import { useSessionBoardState } from './useSessionBoardState.js';

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

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: ({ signal }) => apiGet('/api/users/me', UserProfileSchema, signal)
  });

  const positions = gameQuery.data ? parsePgn(gameQuery.data.pgn).positions : [];
  const sanMoves = positions.filter((position) => position.moveSan !== null).map((position) => position.moveSan as string);

  const initialPly = sessionQuery.data ? lastShowPositionPly(sessionQuery.data.messages) : undefined;
  const boardState = useSessionBoardState(positions, initialPly);
  const engine = useWasmEngine();
  const initialMessages =
    sessionQuery.data && gameQuery.data ? toCoachMessages(sessionQuery.data.messages, sanMoves) : undefined;
  const chat = useCoachChat(sessionId, { onToolCall: boardState.handleToolCall, initialMessages, sanMoves });

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

  return { sessionQuery, gameQuery, profileQuery, sanMoves, boardState, engine, chat, handleReset };
}
