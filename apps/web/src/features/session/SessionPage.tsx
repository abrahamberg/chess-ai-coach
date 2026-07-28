import { parsePgn } from '@chess-coach/chess-analysis';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { apiGet } from '../../api/client.js';
import { useCoachChat } from '../../hooks/useCoachChat.js';
import { useIsDesktop } from '../../hooks/useIsDesktop.js';
import { useWasmEngine } from '../../hooks/useWasmEngine.js';
import { CoachBoard } from '../board/CoachBoard.js';
import { ExplorePanel } from '../board/ExplorePanel.js';
import { MiniBoard } from '../board/MiniBoard.js';
import { MoveStrip } from '../board/MoveStrip.js';
import { ChatPane } from '../chat/ChatPane.js';
import { SessionSummaryCard } from '../chat/SessionSummaryCard.js';
import { useSessionBoardState } from './useSessionBoardState.js';

const UNDO_PILL_MS = 2000;

const SessionDetailSchema = z.object({
  id: z.string(),
  gameId: z.string(),
  status: z.enum(['active', 'completed', 'paused_no_credits']),
  summary: z.string().nullable(),
  homework: z.string().nullable()
});

const GameDetailSchema = z.object({
  id: z.string(),
  pgn: z.string(),
  userColor: z.enum(['white', 'black'])
});

/** design.md §5: composes board + chat for an active coaching session.
 * Owns all fetching (AGENTS.md rule 7) — every child below is presentational. */
export function SessionPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const sessionQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => apiGet(`/api/sessions/${sessionId}`, SessionDetailSchema),
    enabled: sessionId !== ''
  });

  const gameId = sessionQuery.data?.gameId;
  const gameQuery = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => apiGet(`/api/games/${gameId}`, GameDetailSchema),
    enabled: gameId !== undefined
  });

  const positions = gameQuery.data ? parsePgn(gameQuery.data.pgn).positions : [];
  const sanMoves = positions.filter((position) => position.moveSan !== null).map((position) => position.moveSan as string);

  const boardState = useSessionBoardState(positions);
  const engine = useWasmEngine();
  const chat = useCoachChat(sessionId, { onToolCall: boardState.handleToolCall });

  const [pendingMove, setPendingMove] = useState<{ san: string; fen: string } | null>(null);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (sessionQuery.isLoading || gameQuery.isLoading) return <p>Loading…</p>;
  if (sessionQuery.isError || !sessionQuery.data) return <p>Could not load this session.</p>;

  const session = sessionQuery.data;

  if (session.status === 'completed') {
    return (
      <SessionSummaryCard
        summary={session.summary ?? ''}
        homework={session.homework}
        onBackToGames={() => navigate('/games')}
        onViewProgress={() => navigate('/dashboard')}
      />
    );
  }

  function handleUserMove(san: string, fen: string): void {
    setPendingMove({ san, fen });
    pendingTimeoutRef.current = setTimeout(() => {
      void chat.sendMessage(`[board_move] I played ${san} (position now: ${fen})`);
      setPendingMove(null);
    }, UNDO_PILL_MS);
  }

  function handleUndoMove(): void {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    setPendingMove(null);
  }

  const orientation = gameQuery.data?.userColor ?? 'white';
  const showMiniBoard = !isDesktop && boardState.isDocked;

  return (
    <div className={isDesktop ? 'session-page desktop' : 'session-page mobile'}>
      <div className="session-board-column">
        {showMiniBoard ? (
          <MiniBoard fen={boardState.fen} size={96} onExpand={boardState.expandDock} />
        ) : (
          <CoachBoard
            fen={boardState.fen}
            orientation={orientation}
            mode={boardState.mode}
            arrows={boardState.arrows}
            highlights={boardState.highlights}
            onUserMove={handleUserMove}
          />
        )}
        {pendingMove && (
          <p className="undo-pill">
            Sending {pendingMove.san}…{' '}
            <button type="button" onClick={handleUndoMove}>
              ↩︎ undo
            </button>
          </p>
        )}
        <MoveStrip sanMoves={sanMoves} currentPly={boardState.ply} momentPlies={[]} onSelect={boardState.peekAt} />
        <ExplorePanel fen={boardState.fen} onEnterPeekMode={() => boardState.setMode('peek')} engine={engine} />
      </div>
      {session.status === 'paused_no_credits' ? (
        <div className="session-paused-card">
          <p>The session is saved. Add credits or your own API key to continue.</p>
          <button type="button" onClick={() => navigate('/settings')}>
            Add credits
          </button>
        </div>
      ) : (
        <ChatPane
          messages={chat.messages}
          activeToolName={null}
          onSend={(content) => void chat.sendMessage(content)}
          onScrollUp={boardState.collapseDock}
        />
      )}
    </div>
  );
}
